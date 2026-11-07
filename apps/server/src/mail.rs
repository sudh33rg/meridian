//! Outbound email. In development (no `SMTP_URL`) messages are written to the log instead of
//! being sent; in production a missing SMTP configuration is an error, never a silent drop and
//! never a log line that contains a usable link.
use crate::config::Config;
use lettre::{
    message::Mailbox, transport::smtp::AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};

pub(crate) struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

pub(crate) enum Mailer {
    Log { production: bool },
    Smtp(Box<SmtpMailer>),
}

impl Mailer {
    pub(crate) fn from_config(cfg: &Config) -> Mailer {
        if let Some(url) = &cfg.smtp_url {
            match (
                AsyncSmtpTransport::<Tokio1Executor>::from_url(url),
                cfg.mail_from.parse::<Mailbox>(),
            ) {
                (Ok(b), Ok(from)) => {
                    return Mailer::Smtp(Box::new(SmtpMailer {
                        transport: b.build(),
                        from,
                    }));
                }
                (Err(e), _) => tracing::error!(error=%e, "invalid SMTP_URL; email disabled"),
                (_, Err(e)) => tracing::error!(error=%e, "invalid MAIL_FROM; email disabled"),
            }
        }
        Mailer::Log {
            production: cfg.production,
        }
    }

    pub(crate) async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), String> {
        match self {
            Mailer::Log { production: true } => {
                Err("SMTP is not configured (set SMTP_URL and MAIL_FROM)".into())
            }
            Mailer::Log { production: false } => {
                tracing::info!(%to, %subject, "email (development log mode, not sent):\n{body}");
                Ok(())
            }
            Mailer::Smtp(m) => {
                let SmtpMailer { transport, from } = &**m;
                let msg = Message::builder()
                    .from(from.clone())
                    .to(to.parse().map_err(|e| format!("bad recipient: {e}"))?)
                    .subject(subject)
                    .body(body.to_string())
                    .map_err(|e| e.to_string())?;
                transport
                    .send(msg)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }
}
