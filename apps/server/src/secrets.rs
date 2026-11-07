//! Sealing of secrets that must be recoverable (TOTP seeds, webhook signing secrets, SSO client
//! secrets): AES-256-GCM with a key derived from `APP_SECRET`, a random nonce per value and an
//! associated-data label so a sealed value cannot be moved to another row or purpose.
use crate::config::Config;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

fn cipher(cfg: &Config) -> Aes256Gcm {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(&cfg.secret).expect("HMAC accepts any key length");
    mac.update(b"meridian/at-rest/v1");
    let key = mac.finalize().into_bytes();
    Aes256Gcm::new_from_slice(&key).expect("32-byte key")
}

/// `base64(nonce || ciphertext+tag)`.
pub(crate) fn seal(cfg: &Config, aad: &str, plain: &[u8]) -> String {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher(cfg)
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: aad.as_bytes(),
            },
        )
        .expect("AES-GCM encryption does not fail for in-memory inputs");
    let mut out = nonce.to_vec();
    out.extend(ct);
    B64.encode(out)
}

/// `None` if the value was tampered with, sealed for another purpose, or under another key.
pub(crate) fn open(cfg: &Config, aad: &str, sealed: &str) -> Option<Vec<u8>> {
    let raw = B64.decode(sealed).ok()?;
    if raw.len() < 13 {
        return None;
    }
    let (nonce, ct) = raw.split_at(12);
    cipher(cfg)
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ct,
                aad: aad.as_bytes(),
            },
        )
        .ok()
}
