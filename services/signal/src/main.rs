use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde::Serialize;

const MAX_CANDIDATES: usize = 8;
const MAX_CANDIDATE_CHARS: usize = 120;
const ROOM_TTL: Duration = Duration::from_secs(120);

struct Offer {
    candidates: Vec<String>,
    seen_at: Instant,
}

struct Room {
    controller: Option<Offer>,
    host: Option<Offer>,
}

struct App {
    control_plane_origin: String,
    signal_secret: String,
    rooms: Mutex<HashMap<String, Room>>,
}

#[derive(Deserialize)]
struct JoinBody {
    ticket: String,
    role: String,
    fingerprint: String,
    candidates: Vec<String>,
}

#[derive(Deserialize)]
struct InspectBody {
    ok: bool,
    #[serde(rename = "remoteSessionId")]
    remote_session_id: Option<String>,
    #[serde(rename = "controllerFingerprint")]
    controller_fingerprint: Option<String>,
    #[serde(rename = "hostFingerprint")]
    host_fingerprint: Option<String>,
    code: Option<String>,
}

#[derive(Serialize)]
struct JoinOk {
    ok: bool,
    #[serde(rename = "remoteSessionId")]
    remote_session_id: String,
    #[serde(rename = "peerCandidates")]
    peer_candidates: Vec<String>,
}

fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let origin = std::env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
    let secret = std::env::var("SIGNAL_SHARED_SECRET").unwrap_or_default();
    if secret.is_empty() {
        eprintln!("SIGNAL_SHARED_SECRET is required");
        std::process::exit(1);
    }
    let app = Arc::new(App {
        control_plane_origin: origin.trim_end_matches('/').to_string(),
        signal_secret: secret,
        rooms: Mutex::new(HashMap::new()),
    });
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).expect("bind");
    for incoming in listener.incoming() {
        let Ok(stream) = incoming else { continue };
        let app = Arc::clone(&app);
        thread::spawn(move || {
            if let Err(error) = handle(stream, &app) {
                eprintln!("connection failed: {error}");
            }
        });
    }
}

fn handle(mut stream: TcpStream, app: &App) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let request = read_request(&mut stream)?;
    let (status, body) = route(app, &request);
    let response = format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    Ok(())
}

struct Request {
    method: String,
    path: String,
    body: String,
}

fn route(app: &App, request: &Request) -> (u16, String) {
    if request.method == "GET" && request.path == "/health" {
        return (200, "{\"ok\":true}".to_string());
    }
    if request.method == "POST" && request.path == "/v1/candidates" {
        return join(app, &request.body);
    }
    (404, "{\"ok\":false,\"code\":\"not_found\",\"message\":\"路径不存在\"}".to_string())
}

fn join(app: &App, raw: &str) -> (u16, String) {
    let body: JoinBody = match serde_json::from_str(raw) {
        Ok(parsed) => parsed,
        Err(_) => return (400, "{\"ok\":false,\"code\":\"invalid_json\",\"message\":\"请求体不是 JSON\"}".to_string()),
    };
    if body.role != "controller" && body.role != "host" {
        return (400, "{\"ok\":false,\"code\":\"role_invalid\",\"message\":\"角色不正确\"}".to_string());
    }
    if body.candidates.len() > MAX_CANDIDATES || body.candidates.iter().any(|item| item.is_empty() || item.chars().count() > MAX_CANDIDATE_CHARS) {
        return (400, "{\"ok\":false,\"code\":\"candidates_invalid\",\"message\":\"候选地址不正确\"}".to_string());
    }
    let inspected = match inspect(app, &body.ticket) {
        Ok(value) => value,
        Err(message) => return (401, format!("{{\"ok\":false,\"code\":\"ticket_invalid\",\"message\":\"{message}\"}}")),
    };
    if !inspected.ok {
        let code = inspected.code.unwrap_or_else(|| "ticket_invalid".to_string());
        return (401, format!("{{\"ok\":false,\"code\":\"{code}\",\"message\":\"票据无效\"}}"));
    }
    let remote_session_id = inspected.remote_session_id.unwrap_or_default();
    let expected = if body.role == "controller" {
        inspected.controller_fingerprint.unwrap_or_default()
    } else {
        inspected.host_fingerprint.unwrap_or_default()
    };
    if remote_session_id.is_empty() || expected != body.fingerprint {
        return (401, "{\"ok\":false,\"code\":\"ticket_invalid\",\"message\":\"票据无效\"}".to_string());
    }

    let mut rooms = app.rooms.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    rooms.retain(|_session_id, room| room_fresh(room, now));
    let room = rooms.entry(remote_session_id.clone()).or_insert(Room { controller: None, host: None });
    let offer = Offer { candidates: body.candidates, seen_at: now };
    if body.role == "controller" {
        room.controller = Some(offer);
    } else {
        room.host = Some(offer);
    }
    let peer = if body.role == "controller" { room.host.as_ref() } else { room.controller.as_ref() };
    let peer_candidates = peer
        .filter(|item| now.duration_since(item.seen_at) < ROOM_TTL)
        .map(|item| item.candidates.clone())
        .unwrap_or_default();
    let payload = JoinOk { ok: true, remote_session_id, peer_candidates };
    (200, serde_json::to_string(&payload).unwrap_or_else(|_| "{\"ok\":false}".to_string()))
}

fn room_fresh(room: &Room, now: Instant) -> bool {
    let controller_fresh = room.controller.as_ref().is_some_and(|offer| now.duration_since(offer.seen_at) < ROOM_TTL);
    let host_fresh = room.host.as_ref().is_some_and(|offer| now.duration_since(offer.seen_at) < ROOM_TTL);
    controller_fresh || host_fresh
}

fn inspect(app: &App, ticket: &str) -> Result<InspectBody, String> {
    let payload = serde_json::json!({ "ticket": ticket }).to_string();
    let (host, port) = split_origin(&app.control_plane_origin).ok_or_else(|| "控制面地址不正确".to_string())?;
    let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| "控制面不可达".to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    let request = format!(
        "POST /v1/relay/tickets/inspect HTTP/1.1\r\nhost: {host}\r\ncontent-type: application/json\r\nx-signal-secret: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
        app.signal_secret,
        payload.len()
    );
    stream.write_all(request.as_bytes()).map_err(|_| "控制面不可达".to_string())?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).map_err(|_| "控制面不可达".to_string())?;
    let text = String::from_utf8_lossy(&buffer);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
    serde_json::from_str(body).map_err(|_| "控制面返回无法解析".to_string())
}

fn split_origin(origin: &str) -> Option<(&str, u16)> {
    let rest = origin.strip_prefix("http://")?;
    let (host, port_text) = rest.split_once(':')?;
    let port = port_text.parse().ok()?;
    if host.is_empty() { None } else { Some((host, port)) }
}

fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        if buffer.len() > 65536 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "too large"));
        }
    }
    let text = String::from_utf8_lossy(&buffer);
    let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((text.as_ref(), ""));
    let mut lines = head.lines();
    let start = lines.next().unwrap_or("");
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    let mut body = rest.to_string();
    while body.len() < length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        body.push_str(&String::from_utf8_lossy(&chunk[..read]));
    }
    body.truncate(length);
    Ok(Request { method, path, body })
}
