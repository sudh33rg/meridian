//! Runtime configuration, read once from the environment.

pub(crate) struct Config {
    /// HMAC key used to derive one-time email tokens (never stored). Set `APP_SECRET` in production.
    pub(crate) secret: Vec<u8>,
    pub(crate) production: bool,
    pub(crate) cookie_secure: bool,
    pub(crate) trust_proxy: bool,
    /// Base URL used in emailed links (the web app).
    pub(crate) public_url: String,
    /// Browser origins allowed to make cookie-authenticated unsafe requests (PUBLIC_URL, CORS_ORIGIN).
    pub(crate) allowed_origins: Vec<String>,
    pub(crate) mail_from: String,
    pub(crate) smtp_url: Option<String>,
    pub(crate) session_ttl_hours: i32,
    pub(crate) refresh_ttl_days: i32,
    /// Development only: let outbound requests (webhooks, SSO discovery) reach private/loopback
    /// addresses over plain http so they can be tested against local services.
    pub(crate) allow_private_outbound: bool,
    pub(crate) stripe_secret_key: Option<String>,
    pub(crate) stripe_webhook_secret: Option<String>,
    /// Outbound email (daily digests). Off unless EMAIL_NOTIFICATIONS=true, and it also needs SMTP_URL.
    /// The production sender domain is an owner decision (see IMPLEMENTATION_STATUS).
    pub(crate) email_notifications: bool,
    /// AI summaries and triage (Phase M1). Needs ANTHROPIC_API_KEY on the server and a workspace admin's
    /// opt-in. The model and endpoint can be changed with AI_MODEL and AI_API_URL.
    pub(crate) ai_api_key: Option<String>,
    pub(crate) ai_model: String,
    pub(crate) ai_base_url: String,
    pub(crate) stripe_price_team: Option<String>,
    pub(crate) stripe_price_business: Option<String>,
    /// Webhook deliveries per workspace per minute (excess is deferred, never dropped).
    pub(crate) webhook_per_min: u32,
    pub(crate) s3_bucket: Option<String>,
    pub(crate) s3_endpoint: Option<String>,
    pub(crate) s3_region: Option<String>,
    pub(crate) s3_access_key: Option<String>,
    pub(crate) s3_secret_key: Option<String>,
    pub(crate) attachments_dir: String,
    pub(crate) max_attachment_mb: usize,
    /// host:port of a clamd daemon; uploads are scanned through its INSTREAM protocol.
    pub(crate) clamav_addr: Option<String>,
    /// Only files that scanned clean can be downloaded (default on in production).
    pub(crate) scan_required: bool,
    pub(crate) auth_per_min: u32,
    pub(crate) global_per_min: u32,
    /// Count requests per client in PostgreSQL, so every replica shares one limit (Phase N, Constitution IV).
    /// Off by default: the in-process limiter is used alone, which is cheaper and fine for one instance.
    pub(crate) shared_rate_limit: bool,
}

fn env_num<T: std::str::FromStr>(key: &str, default: T) -> T {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}
fn opt_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.is_empty())
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
                tracing::warn!("APP_SECRET not set: using the fixed DEVELOPMENT secret. Never run shared or production environments like this");
                b"meridian-development-secret-not-for-production-0001".to_vec()
            }
        };
        let public_url = std::env::var("PUBLIC_URL")
            .unwrap_or_else(|_| "http://localhost:9991".into())
            .trim_end_matches('/')
            .to_string();
        let mut allowed_origins = vec![public_url.clone()];
        if let Ok(o) = std::env::var("CORS_ORIGIN") {
            allowed_origins.extend(
                o.split(',')
                    .map(|x| x.trim().trim_end_matches('/').to_string()),
            );
        }
        Config {
            secret,
            production,
            cookie_secure: env_bool("COOKIE_SECURE") || production,
            trust_proxy: env_bool("TRUST_PROXY"),
            public_url,
            allowed_origins,
            mail_from: std::env::var("MAIL_FROM")
                .unwrap_or_else(|_| "Meridian <no-reply@meridian.local>".into()),
            smtp_url: std::env::var("SMTP_URL").ok().filter(|s| !s.is_empty()),
            session_ttl_hours: env_num("SESSION_TTL_HOURS", 8),
            refresh_ttl_days: env_num("REFRESH_TTL_DAYS", 30),
            allow_private_outbound: env_bool("ALLOW_PRIVATE_OUTBOUND") && !production,
            stripe_secret_key: opt_env("STRIPE_SECRET_KEY"),
            stripe_webhook_secret: opt_env("STRIPE_WEBHOOK_SECRET"),
            email_notifications: env_bool("EMAIL_NOTIFICATIONS"),
            ai_api_key: opt_env("ANTHROPIC_API_KEY"),
            ai_model: std::env::var("AI_MODEL").unwrap_or_else(|_| "claude-haiku-5-5".into()),
            ai_base_url: std::env::var("AI_API_URL").unwrap_or_else(|_| "https://api.anthropic.com".into()),
            stripe_price_team: opt_env("STRIPE_PRICE_TEAM"),
            stripe_price_business: opt_env("STRIPE_PRICE_BUSINESS"),
            webhook_per_min: env_num("WEBHOOK_RATE_PER_MIN", 600),
            s3_bucket: opt_env("S3_BUCKET"),
            s3_endpoint: opt_env("S3_ENDPOINT"),
            s3_region: opt_env("S3_REGION"),
            s3_access_key: opt_env("S3_ACCESS_KEY_ID"),
            s3_secret_key: opt_env("S3_SECRET_ACCESS_KEY"),
            attachments_dir: std::env::var("ATTACHMENTS_DIR")
                .unwrap_or_else(|_| "./data/attachments".into()),
            max_attachment_mb: env_num("MAX_ATTACHMENT_MB", 25),
            clamav_addr: opt_env("CLAMAV_ADDR"),
            scan_required: std::env::var("ATTACHMENTS_REQUIRE_SCAN")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(production),
            auth_per_min: env_num("RATE_LIMIT_AUTH_PER_MIN", 30),
            global_per_min: env_num("RATE_LIMIT_GLOBAL_PER_MIN", 1200),
            shared_rate_limit: env_bool("RATE_LIMIT_SHARED"),
        }
    }
}
