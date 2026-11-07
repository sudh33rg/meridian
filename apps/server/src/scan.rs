//! Malware scanning through a clamd daemon (INSTREAM protocol over TCP).
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::{timeout, Duration},
};

pub(crate) enum Verdict {
    Clean,
    Infected(String),
}

/// Stream `data` to clamd and return its verdict. Errors mean "could not decide".
pub(crate) async fn clamd_scan(addr: &str, data: &[u8]) -> Result<Verdict, String> {
    let work = async {
        let mut s = TcpStream::connect(addr)
            .await
            .map_err(|e| format!("connect: {e}"))?;
        s.write_all(b"zINSTREAM\0")
            .await
            .map_err(|e| e.to_string())?;
        for chunk in data.chunks(64 * 1024) {
            s.write_all(&(chunk.len() as u32).to_be_bytes())
                .await
                .map_err(|e| e.to_string())?;
            s.write_all(chunk).await.map_err(|e| e.to_string())?;
        }
        s.write_all(&0u32.to_be_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let mut reply = Vec::new();
        s.read_to_end(&mut reply).await.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&reply)
            .trim_matches('\0')
            .trim()
            .to_string();
        if text.ends_with("OK") {
            Ok(Verdict::Clean)
        } else if let Some(sig) = text.strip_suffix("FOUND") {
            Ok(Verdict::Infected(
                sig.trim().trim_start_matches("stream:").trim().to_string(),
            ))
        } else {
            Err(format!("unexpected clamd reply: {text}"))
        }
    };
    timeout(Duration::from_secs(60), work)
        .await
        .map_err(|_| "scan timed out".to_string())?
}
