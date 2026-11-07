//! Runtime configuration, read once from the environment.
use rand::RngCore;

pub(crate) struct Config {
    /// HMAC key used to derive one-time email tokens (never stored). Set `APP_SECRET` in production.
    pub(crate) secret: Vec<u8>,
    pub(crate) production: bool,
    pub(crate) cookie_secure: bool,
    pub(crate) trust_proxy: bool,
    /// Base URL used in emailed links (the web app).
    pub(crate) public_url: String,
    pub(crate) mail_from: String,
    pub(crate) smtp_url: Option<String>,
    pub(crate) session_ttl_hours: i32,
    pub(crate) refresh_ttl_days: i32,
    pub(crate) auth_per_min: u32,
    pub(crate) global_per_min: u32,
}

fn env_num<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
fn env_bool(key: &str) -> bool {
    matches!(
        std::env::var(key).as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

impl Config {
    pub(crate) fn from_env() -> Config {
        let production = std::env::var("APP_ENV").as_deref() == Ok("production");
        let secret = match std::env::var("APP_SECRET") {
            Ok(s) if s.len() >= 32 => s.into_bytes(),
            _ => {
                assert!(
                    !production,
                    "APP_SECRET (at least 32 characters) is required when APP_ENV=production"
                );
                tracing::warn!("APP_SECRET not set: using a random per-process secret; emailed links issued before a restart will stop working");
                let mut b = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut b);
                hex::encode(b).into_bytes()
            }
        };
        Config {
            secret,
            production,
            cookie_secure: env_bool("COOKIE_SECURE") || production,
            trust_proxy: env_bool("TRUST_PROXY"),
            public_url: std::env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into())
                .trim_end_matches('/')
                .to_string(),
            mail_from: std::env::var("MAIL_FROM")
                .unwrap_or_else(|_| "Meridian <no-reply@meridian.local>".into()),
            smtp_url: std::env::var("SMTP_URL").ok().filter(|s| !s.is_empty()),
            session_ttl_hours: env_num("SESSION_TTL_HOURS", 8),
            refresh_ttl_days: env_num("REFRESH_TTL_DAYS", 30),
            auth_per_min: env_num("RATE_LIMIT_AUTH_PER_MIN", 30),
            global_per_min: env_num("RATE_LIMIT_GLOBAL_PER_MIN", 1200),
        }
    }
}
