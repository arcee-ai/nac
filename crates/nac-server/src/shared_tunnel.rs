use std::net::IpAddr;

use axum::extract::Request;
use axum::http::{header, uri::Authority, HeaderMap, HeaderName, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub(crate) async fn shared_tunnel_origin_guard(request: Request, next: Next) -> Response {
    if !is_allowed_shared_tunnel_request(request.method(), request.headers()) {
        return (StatusCode::FORBIDDEN, "Host/Origin validation failed").into_response();
    }
    next.run(request).await
}

fn is_allowed_shared_tunnel_request(method: &Method, headers: &HeaderMap) -> bool {
    let Some(host) = single_header(headers, header::HOST).and_then(normalize_authority) else {
        return false;
    };
    match single_header(headers, header::ORIGIN) {
        Some(origin) => normalize_origin(origin).is_some_and(|origin| origin == host),
        None if headers.contains_key(header::ORIGIN) => false,
        None => matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS),
    }
}

fn single_header(headers: &HeaderMap, name: HeaderName) -> Option<&str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    values.next().is_none().then_some(value)
}

fn normalize_origin(origin: &str) -> Option<(String, u16)> {
    let (scheme, authority) = origin.split_once("://")?;
    scheme.eq_ignore_ascii_case("https").then_some(())?;
    normalize_authority(authority)
}

fn normalize_authority(raw: &str) -> Option<(String, u16)> {
    if raw.contains('@') {
        return None;
    }
    let authority = raw.parse::<Authority>().ok()?;
    let host = authority.host();
    let bare_host = host.trim_matches(['[', ']']);
    if bare_host.parse::<IpAddr>().is_err() && !is_valid_dns_host(host) {
        return None;
    }
    let port = match raw.strip_prefix(host)? {
        "" => 443,
        _ => authority.port_u16()?,
    };
    (port != 0).then(|| (host.to_ascii_lowercase(), port))
}

pub fn is_valid_dns_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(host: &str, origin: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, values) in [(header::HOST, host), (header::ORIGIN, origin)] {
            for value in values.split('|').filter(|value| !value.is_empty()) {
                headers.append(name.clone(), value.parse().unwrap());
            }
        }
        headers
    }

    #[test]
    fn shared_tunnel_header_policy() {
        const N: &str = "";
        const H: &str = "nac.example";
        const O: &str = "https://nac.example";
        const E: &str = "https://evil.example";
        const DUP_O: &str = "https://nac.example|https://nac.example";
        let cases = [
            ("GET without Origin", true, "GET", H, N),
            ("matching mutation", true, "POST", H, O),
            ("Host default port", true, "POST", "nac.example:443", O),
            ("uppercase Host", true, "POST", "NAC.EXAMPLE", O),
            ("IPv4 Host", true, "POST", "127.0.0.1", "https://127.0.0.1"),
            ("IPv6 Host", true, "POST", "[::1]", "https://[::1]"),
            ("mutation without Origin", false, "POST", H, N),
            ("unknown method", false, "PURGE", H, N),
            ("cross-origin GET", false, "GET", H, E),
            ("cross-origin POST", false, "POST", H, E),
            ("HTTP Origin", false, "POST", H, "http://nac.example"),
            ("path Origin", false, "POST", H, "https://nac.example/x"),
            ("malformed Origin", false, "GET", H, "https://bad_host"),
            ("duplicate Origin", false, "GET", H, DUP_O),
            ("missing Host", false, "GET", N, N),
            ("malformed Host", false, "GET", "bad_host", N),
            ("duplicate Host", false, "GET", "nac.example|nac.example", N),
            ("zero-port Host", false, "GET", "nac.example:0", N),
            ("userinfo Host", false, "GET", "user@nac.example", N),
            ("scheme Host", false, "GET", "https://nac.example", N),
        ];
        for (label, allowed, method, host, origin) in cases {
            let method = Method::from_bytes(method.as_bytes()).unwrap();
            let actual = is_allowed_shared_tunnel_request(&method, &headers(host, origin));
            assert_eq!(actual, allowed, "{label}");
        }
    }
}
