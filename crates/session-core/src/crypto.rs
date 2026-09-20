//! 直连端到端：X25519 协商 + HKDF + ChaCha20-Poly1305。
//! 密钥只留在两端。中继路径不要用这套密钥去包一层再给中继拆。

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey};
use zeroize::{Zeroize, ZeroizeOnDrop};

const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const INFO_CONTROLLER_TO_HOST: &[u8] = b"desktop-sharing/session-core/v1/controller-to-host";
const INFO_HOST_TO_CONTROLLER: &[u8] = b"desktop-sharing/session-core/v1/host-to-controller";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointRole {
    Controller,
    Host,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HandshakeError {
    PeerKeyInvalid,
    DecryptFailed,
    EncryptFailed,
    CounterExhausted,
}

/// 本端一次性私钥 + 公钥。用完即丢，换会话再生成。
pub struct HandshakeOffer {
    secret: EphemeralSecret,
    public: PublicKey,
}

impl HandshakeOffer {
    pub fn generate() -> Self {
        let secret = EphemeralSecret::random();
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_bytes(&self) -> [u8; 32] {
        self.public.to_bytes()
    }

    /// 用对端公钥完成协商。完成后本结构不可再复用。
    pub fn finish(self, peer_public: &[u8; 32], role: EndpointRole) -> Result<SessionKeys, HandshakeError> {
        let peer = PublicKey::from(*peer_public);
        let shared = self.secret.diffie_hellman(&peer);
        SessionKeys::from_shared(shared.as_bytes(), role)
    }
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionKeys {
    send_key: [u8; KEY_BYTES],
    recv_key: [u8; KEY_BYTES],
}

impl SessionKeys {
    fn from_shared(shared: &[u8], role: EndpointRole) -> Result<Self, HandshakeError> {
        let hk = Hkdf::<Sha256>::new(None, shared);
        let mut controller_to_host = [0u8; KEY_BYTES];
        let mut host_to_controller = [0u8; KEY_BYTES];
        hk.expand(INFO_CONTROLLER_TO_HOST, &mut controller_to_host)
            .map_err(|_| HandshakeError::PeerKeyInvalid)?;
        hk.expand(INFO_HOST_TO_CONTROLLER, &mut host_to_controller)
            .map_err(|_| HandshakeError::PeerKeyInvalid)?;
        let (send_key, recv_key) = match role {
            EndpointRole::Controller => (controller_to_host, host_to_controller),
            EndpointRole::Host => (host_to_controller, controller_to_host),
        };
        Ok(Self { send_key, recv_key })
    }

    pub fn into_cipher(self) -> DirectCipher {
        DirectCipher {
            send: ChaCha20Poly1305::new_from_slice(&self.send_key).expect("key length"),
            recv: ChaCha20Poly1305::new_from_slice(&self.recv_key).expect("key length"),
            send_counter: 0,
        }
    }
}

pub struct DirectCipher {
    send: ChaCha20Poly1305,
    recv: ChaCha20Poly1305,
    send_counter: u64,
}

impl DirectCipher {
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, HandshakeError> {
        if self.send_counter == u64::MAX {
            return Err(HandshakeError::CounterExhausted);
        }
        let nonce = counter_nonce(self.send_counter);
        self.send_counter += 1;
        let mut packet = Vec::with_capacity(NONCE_BYTES + plaintext.len() + 16);
        packet.extend_from_slice(&nonce);
        let ciphertext = self
            .send
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .map_err(|_| HandshakeError::EncryptFailed)?;
        packet.extend_from_slice(&ciphertext);
        Ok(packet)
    }

    pub fn open(&mut self, packet: &[u8]) -> Result<Vec<u8>, HandshakeError> {
        if packet.len() < NONCE_BYTES + 16 {
            return Err(HandshakeError::DecryptFailed);
        }
        let (nonce_bytes, ciphertext) = packet.split_at(NONCE_BYTES);
        self.recv
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| HandshakeError::DecryptFailed)
    }
}

fn counter_nonce(counter: u64) -> [u8; NONCE_BYTES] {
    let mut nonce = [0u8; NONCE_BYTES];
    nonce[4..12].copy_from_slice(&counter.to_be_bytes());
    nonce
}
