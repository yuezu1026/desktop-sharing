use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::{ServerConfig, ServerConnection, StreamOwned};
use serde::Deserialize;

const HELLO_LIMIT: usize = 4096;
const CHUNK_BYTES: usize = 16 * 1024;
const PAIR_WAIT: Duration = Duration::from_secs(20);

struct App {
    control_plane_origin: String,
    relay_secret: String,
    heartbeat_every: Duration,
    pending: Mutex<HashMap<String, PendingSide>>,
    tls: Arc<ServerConfig>,
}

struct PendingSide {
    role: String,
    sender: Sender<IncomingSide>,
}

struct IncomingSide {
    stream: StreamOwned<ServerConnection, TcpStream>,
    fingerprint: String,
}

#[derive(Deserialize)]
struct Hello {
    ticket: String,
    role: String,
    fingerprint: String,
}

#[derive(Deserialize)]
struct AdmitBody {
    ok: Option<bool>,
    #[serde(rename = "bitrateKbps")]
    bitrate_kbps: Option<u32>,
    code: Option<String>,
}

#[derive(Deserialize)]
struct HeartbeatBody {
    ok: Option<bool>,
    directive: Option<String>,
    #[serde(rename = "bitrateKbps")]
    bitrate_kbps: Option<u32>,
    ticket: Option<String>,
}

struct Bucket {
    bytes_per_second: f64,
    tokens: f64,
    updated: Instant,
}

fn main() {
    let secret = std::env::var("RELAY_SHARED_SECRET").unwrap_or_default();
    if secret.is_empty() {
        eprintln!("RELAY_SHARED_SECRET is required");
        std::process::exit(1);
    }
    let port = std::env::var("RELAY_PORT").unwrap_or_else(|_| "8443".to_string());
    let origin = std::env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
    let heartbeat_seconds = std::env::var("HEARTBEAT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(30);
    let tls = Arc::new(build_tls());
    let app = Arc::new(App {
        control_plane_origin: origin.trim_end_matches('/').to_string(),
        relay_secret: secret,
        heartbeat_every: Duration::from_secs(heartbeat_seconds),
        pending: Mutex::new(HashMap::new()),
        tls,
    });
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).expect("bind");
    for incoming in listener.incoming() {
        let Ok(stream) = incoming else { continue };
        stream.set_nodelay(true).ok();
        let app = Arc::clone(&app);
        thread::spawn(move || {
            if let Err(error) = accept_side(stream, &app) {
                eprintln!("relay side closed: {error}");
            }
        });
    }
}

fn build_tls() -> ServerConfig {
    let key_pair = rcgen::KeyPair::generate().expect("relay key");
    let params = rcgen::CertificateParams::new(vec!["localhost".to_string()]).expect("relay name");
    let certificate = params.self_signed(&key_pair).expect("relay cert");
    let cert_der = CertificateDer::from(certificate.der().to_vec());
    let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_pair.serialize_der()));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])
        .expect("tls versions")
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .expect("tls config")
}

fn accept_side(tcp: TcpStream, app: &App) -> std::io::Result<()> {
    let connection = ServerConnection::new(Arc::clone(&app.tls)).map_err(io_other)?;
    let mut stream = StreamOwned::new(connection, tcp);
    let hello = read_hello(&mut stream)?;
    if hello.role != "controller" && hello.role != "host" {
        return Err(io_other("role"));
    }
    if hello.ticket.len() < 20 || hello.fingerprint.len() < 8 {
        return Err(io_other("hello"));
    }
    let (sender, receiver) = mpsc::channel();
    {
        let mut pending = app.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(waiting) = pending.remove(&hello.ticket) {
            if waiting.role == hello.role {
                pending.insert(hello.ticket, waiting);
                return Err(io_other("same side"));
            }
            waiting
                .sender
                .send(IncomingSide {
                    stream,
                    fingerprint: hello.fingerprint,
                })
                .map_err(|_| io_other("peer gone"))?;
            return Ok(());
        }
            pending.insert(
                hello.ticket.clone(),
                PendingSide {
                    role: hello.role.clone(),
                    sender,
                },
            );
    }
    let peer = match receiver.recv_timeout(PAIR_WAIT) {
        Ok(side) => side,
        Err(_) => {
            let mut pending = app.pending.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            pending.remove(&hello.ticket);
            return Err(io_other("peer timeout"));
        }
    };
    let (controller_fingerprint, host_fingerprint, controller, host) = if hello.role == "controller" {
        (hello.fingerprint, peer.fingerprint, stream, peer.stream)
    } else {
        (peer.fingerprint, hello.fingerprint, peer.stream, stream)
    };
    let admitted = admit(app, &hello.ticket, &controller_fingerprint, &host_fingerprint).map_err(io_other)?;
    if admitted.ok != Some(true) {
        return Err(io_other(admitted.code.unwrap_or_else(|| "admit".to_string())));
    }
    let Some(bitrate) = admitted.bitrate_kbps else {
        return Err(io_other("bitrate"));
    };
    pump(controller, host, hello.ticket, bitrate, app);
    Ok(())
}

fn pump(
    mut controller: StreamOwned<ServerConnection, TcpStream>,
    mut host: StreamOwned<ServerConnection, TcpStream>,
    mut ticket: String,
    bitrate_kbps: u32,
    app: &App,
) {
    controller.sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
    host.sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
    let mut bucket = Bucket::new(bitrate_kbps);
    let mut forwarded: u64 = 0;
    let mut next_heartbeat = Instant::now() + app.heartbeat_every;
    let mut window_started = Instant::now();
    let mut buffer = vec![0u8; CHUNK_BYTES];
    loop {
        if Instant::now() >= next_heartbeat {
            let duration = window_started.elapsed().as_secs().min(120) as u32;
            match report(app, &ticket, forwarded, duration) {
                Ok(body) if body.directive.as_deref() == Some("stop_relay") || body.ok == Some(false) => break,
                Ok(body) => {
                    if let Some(next_ticket) = body.ticket {
                        ticket = next_ticket;
                    }
                    if let Some(next_bitrate) = body.bitrate_kbps {
                        bucket.set_bitrate(next_bitrate);
                    }
                }
                Err(error) => {
                    eprintln!("relay heartbeat failed: {error}");
                    break;
                }
            }
            forwarded = 0;
            window_started = Instant::now();
            next_heartbeat = Instant::now() + app.heartbeat_every;
        }
        let controller_bytes = copy_chunk(&mut controller, &mut host, &mut buffer, &mut bucket);
        let host_bytes = copy_chunk(&mut host, &mut controller, &mut buffer, &mut bucket);
        if controller_bytes.is_err() || host_bytes.is_err() {
            break;
        }
        forwarded += controller_bytes.unwrap_or(0) + host_bytes.unwrap_or(0);
    }
    controller.sock.shutdown(Shutdown::Both).ok();
    host.sock.shutdown(Shutdown::Both).ok();
}

fn copy_chunk(
    from: &mut StreamOwned<ServerConnection, TcpStream>,
    to: &mut StreamOwned<ServerConnection, TcpStream>,
    buffer: &mut [u8],
    bucket: &mut Bucket,
) -> Result<u64, ()> {
    match from.read(buffer) {
        Ok(0) => Err(()),
        Ok(read_count) => {
            bucket.wait(read_count);
            to.write_all(&buffer[..read_count]).map_err(|_| ())?;
            Ok(read_count as u64)
        }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut || error.kind() == std::io::ErrorKind::WouldBlock => Ok(0),
        Err(_) => Err(()),
    }
}

impl Bucket {
    fn new(bitrate_kbps: u32) -> Self {
        let bytes_per_second = bitrate_kbps as f64 * 1000.0 / 8.0;
        Self {
            bytes_per_second,
            tokens: bytes_per_second,
            updated: Instant::now(),
        }
    }

    fn set_bitrate(&mut self, bitrate_kbps: u32) {
        self.bytes_per_second = bitrate_kbps as f64 * 1000.0 / 8.0;
        self.tokens = self.tokens.min(self.bytes_per_second);
    }

    fn wait(&mut self, byte_count: usize) {
        let needed = byte_count as f64;
        loop {
            self.refill();
            if self.tokens >= needed {
                self.tokens -= needed;
                return;
            }
            let missing = needed - self.tokens;
            let seconds = if self.bytes_per_second <= 0.0 {
                0.05
            } else {
                (missing / self.bytes_per_second).clamp(0.001, 0.05)
            };
            thread::sleep(Duration::from_secs_f64(seconds));
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.updated).as_secs_f64();
        self.updated = now;
        self.tokens = (self.tokens + elapsed * self.bytes_per_second).min(self.bytes_per_second.max(1.0));
    }
}

fn read_hello(stream: &mut StreamOwned<ServerConnection, TcpStream>) -> std::io::Result<Hello> {
    let mut length_bytes = [0u8; 4];
    stream.read_exact(&mut length_bytes)?;
    let length = u32::from_be_bytes(length_bytes) as usize;
    if length == 0 || length > HELLO_LIMIT {
        return Err(io_other("hello length"));
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body)?;
    serde_json::from_slice(&body).map_err(|_| io_other("hello json"))
}

fn admit(app: &App, ticket: &str, controller_fingerprint: &str, host_fingerprint: &str) -> Result<AdmitBody, String> {
    let payload = serde_json::json!({
        "ticket": ticket,
        "controllerFingerprint": controller_fingerprint,
        "hostFingerprint": host_fingerprint,
    });
    let body = post_json(app, "/v1/relay/tickets/admit", &payload.to_string())?;
    serde_json::from_str(&body).map_err(|_| "admit parse".to_string())
}

fn report(app: &App, ticket: &str, bytes: u64, duration_seconds: u32) -> Result<HeartbeatBody, String> {
    let payload = serde_json::json!({
        "ticket": ticket,
        "heartbeatId": new_uuid(),
        "bytes": bytes,
        "durationSeconds": duration_seconds,
        "acceptDegrade": true,
    });
    let body = post_json(app, "/v1/relay/heartbeats", &payload.to_string())?;
    serde_json::from_str(&body).map_err(|_| "heartbeat parse".to_string())
}

fn post_json(app: &App, path: &str, payload: &str) -> Result<String, String> {
    let (host, port) = split_origin(&app.control_plane_origin).ok_or_else(|| "控制面地址不正确".to_string())?;
    let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| "控制面不可达".to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let request = format!(
        "POST {path} HTTP/1.1\r\nhost: {host}\r\ncontent-type: application/json\r\nx-relay-secret: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
        app.relay_secret,
        payload.len()
    );
    stream.write_all(request.as_bytes()).map_err(|_| "控制面不可达".to_string())?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).map_err(|_| "控制面不可达".to_string())?;
    let text = String::from_utf8_lossy(&buffer);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
    if body.is_empty() {
        return Err("控制面返回空".to_string());
    }
    Ok(body)
}

fn split_origin(origin: &str) -> Option<(&str, u16)> {
    let rest = origin.strip_prefix("http://")?;
    let (host, port_text) = rest.split_once(':')?;
    let port = port_text.parse().ok()?;
    if host.is_empty() { None } else { Some((host, port)) }
}

fn new_uuid() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("random");
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10],
        bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn io_other(message: impl ToString) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, message.to_string())
}
