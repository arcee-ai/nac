use anyhow::{bail, Context, Result};
use url::Url;

fn is_loopback_url(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

pub(super) fn normalize_endpoint(raw: &str) -> Result<String> {
    let mut url = Url::parse(raw).context("MCP OAuth endpoint must be an absolute URL")?;
    let loopback = is_loopback_url(&url);
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        bail!("MCP OAuth endpoint must use HTTPS (HTTP is allowed only for loopback testing)");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("MCP OAuth endpoint must not contain credentials, a query, or a fragment");
    }
    if url.path().is_empty() {
        url.set_path("/");
    }
    Ok(url.to_string())
}

pub(super) fn validate_https_url(
    raw: &str,
    label: &str,
    allow_loopback_http: bool,
) -> Result<String> {
    let url = Url::parse(raw).with_context(|| format!("{label} must be an absolute URL"))?;
    let loopback = is_loopback_url(&url);
    if url.scheme() != "https" && !(allow_loopback_http && url.scheme() == "http" && loopback) {
        bail!("{label} must use HTTPS");
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        bail!("{label} must not contain credentials or a fragment");
    }
    Ok(url.to_string())
}
