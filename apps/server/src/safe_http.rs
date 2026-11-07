//! Outbound HTTP that cannot be aimed at our own network (SSRF defence).
//!
//! * the URL must be https (plain http only with `ALLOW_PRIVATE_OUTBOUND=true`, development only);
//! * IP-literal hosts are checked before any request is made;
//! * hostnames are resolved by a custom resolver that drops every non-public address, and reqwest
//!   connects to exactly the addresses it returned (so DNS rebinding between "check" and "use"
//!   is impossible);
//! * redirects are never followed, timeouts are short, and response bodies are size-capped by callers.
use crate::config::Config;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

/// Anything that is not a plain public unicast address.
pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_v4(mapped);
            }
            let seg = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (seg[0] & 0xffc0) == 0xfe80 // link local fe80::/10
                || (seg[0] == 0x2001 && seg[1] == 0x0db8) // documentation
                || v6 == Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0, 0)
                || (seg[0] == 0x64 && seg[1] == 0xff9b)) // NAT64 can reach IPv4 internals
        }
    }
}
fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local() // 169.254/16 incl. cloud metadata
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // CGNAT 100.64/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // benchmarking 198.18/15
        || o[0] >= 240) // reserved
}

struct PublicOnly {
    allow_private: bool,
}
impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let allow = self.allow_private;
        Box::pin(async move {
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            let ok: Vec<SocketAddr> = addrs
                .into_iter()
                .filter(|a| allow || is_public_ip(a.ip()))
                .collect();
            if ok.is_empty() {
                return Err("destination resolves only to non-public addresses".into());
            }
            Ok(Box::new(ok.into_iter()) as Addrs)
        })
    }
}

/// Validate a user-supplied outbound URL (before any network activity).
pub(crate) fn check_url(cfg: &Config, raw: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(raw).map_err(|_| "not a valid URL".to_string())?;
    let https = u.scheme() == "https";
    if !https && !(cfg.allow_private_outbound && u.scheme() == "http") {
        return Err("only https URLs are allowed".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("credentials in URLs are not allowed".into());
    }
    match u.host() {
        None => return Err("URL has no host".into()),
        Some(url::Host::Ipv4(ip))
            if !cfg.allow_private_outbound && !is_public_ip(IpAddr::V4(ip)) =>
        {
            return Err("destination is not a public address".into())
        }
        Some(url::Host::Ipv6(ip))
            if !cfg.allow_private_outbound && !is_public_ip(IpAddr::V6(ip)) =>
        {
            return Err("destination is not a public address".into())
        }
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            if !cfg.allow_private_outbound
                && (d == "localhost"
                    || d.ends_with(".localhost")
                    || d.ends_with(".internal")
                    || d.ends_with(".local"))
            {
                return Err("destination is not a public address".into());
            }
        }
        _ => {}
    }
    Ok(u)
}

/// A client that only ever reaches public addresses and never follows redirects.
pub(crate) fn client(cfg: &Config) -> reqwest::Client {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(PublicOnly {
            allow_private: cfg.allow_private_outbound,
        }))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .https_only(!cfg.allow_private_outbound)
        .user_agent(concat!("Meridian/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("static client configuration is valid")
}
