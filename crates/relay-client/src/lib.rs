//! 连自家中继。画面字节只走内存，不落盘。

mod tls_mode;

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, Error as TlsError, RootCertStore, SignatureScheme, StreamOwned};
use session_core::{
    decode_frame, encode_frame, encode_relay_hello, ticket_looks_usable, Frame, FrameError, FrameKind, HelloError,
    RelayRole, TicketError,
};

use tls_mode::{host_from_address, resolve_tls_verify_mode, TlsVerifyMode};

const HEADER_BYTES: usize = 12;
const READ_CHUNK: usize = 16 * 1024;

#[derive(Debug)]
pub enum RelayError {
    Address,
    Ticket(TicketError),
    Hello(HelloError),
    Frame(FrameError),
    Connect,
    Tls,
    Closed,
    Io,
}

pub struct RelaySession {
    stream: StreamOwned<ClientConnection, TcpStream>,
    buffer: Vec<u8>,
}

impl RelaySession {
    /// 连上中继并送出 hello。环回默认接受自签；非环回默认用公共根证书校验。
    /// `RELAY_TLS_INSECURE=1` 强制跳过，`=0` 强制严格。
    pub fn connect(address: &str, ticket: &str, role: RelayRole, fingerprint: &str) -> Result<Self, RelayError> {
        ticket_looks_usable(ticket).map_err(RelayError::Ticket)?;
        let hello = encode_relay_hello(ticket, role, fingerprint).map_err(RelayError::Hello)?;
        let host = host_from_address(address);
        let insecure_env = std::env::var("RELAY_TLS_INSECURE").ok();
        let mode = resolve_tls_verify_mode(host, insecure_env.as_deref());
        let tcp = TcpStream::connect(address).map_err(|_| RelayError::Connect)?;
        tcp.set_nodelay(true).ok();
        tcp.set_read_timeout(Some(Duration::from_millis(200))).ok();
        tcp.set_write_timeout(Some(Duration::from_secs(5))).ok();
        let server_name = ServerName::try_from(host.to_string()).map_err(|_| RelayError::Address)?;
        let config = client_config(mode);
        let connection = ClientConnection::new(Arc::new(config), server_name).map_err(|_| RelayError::Tls)?;
        let mut stream = StreamOwned::new(connection, tcp);
        stream.write_all(&hello).map_err(|_| RelayError::Io)?;
        stream.flush().map_err(|_| RelayError::Io)?;
        Ok(Self {
            stream,
            buffer: Vec::new(),
        })
    }

    pub fn send_frame(&mut self, frame: &Frame) -> Result<(), RelayError> {
        let bytes = encode_frame(frame).map_err(RelayError::Frame)?;
        self.stream.write_all(&bytes).map_err(|_| RelayError::Io)?;
        self.stream.flush().map_err(|_| RelayError::Io)?;
        Ok(())
    }

    pub fn send_placeholder_video(&mut self) -> Result<(), RelayError> {
        self.send_frame(&Frame {
            kind: FrameKind::Video,
            flags: 0,
            payload: b"placeholder".to_vec(),
        })
    }

    /// 读到完整一帧则返回；暂时没有数据则 Ok(None)。
    pub fn try_recv_frame(&mut self) -> Result<Option<Frame>, RelayError> {
        let mut chunk = [0u8; READ_CHUNK];
        match self.stream.read(&mut chunk) {
            Ok(0) => return Err(RelayError::Closed),
            Ok(count) => self.buffer.extend_from_slice(&chunk[..count]),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => return Err(RelayError::Io),
        }
        if self.buffer.len() < HEADER_BYTES {
            return Ok(None);
        }
        let payload_length = u32::from_be_bytes([
            self.buffer[8],
            self.buffer[9],
            self.buffer[10],
            self.buffer[11],
        ]) as usize;
        let total = HEADER_BYTES + payload_length;
        if self.buffer.len() < total {
            return Ok(None);
        }
        let frame_bytes: Vec<u8> = self.buffer.drain(..total).collect();
        let frame = decode_frame(&frame_bytes).map_err(RelayError::Frame)?;
        Ok(Some(frame))
    }
}

fn client_config(mode: TlsVerifyMode) -> ClientConfig {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("tls versions");
    match mode {
        TlsVerifyMode::InsecureSkip => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyRelayCert))
            .with_no_client_auth(),
        TlsVerifyMode::Strict => {
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            builder.with_root_certificates(roots).with_no_client_auth()
        }
    }
}

#[derive(Debug)]
struct AcceptAnyRelayCert;

impl ServerCertVerifier for AcceptAnyRelayCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}
