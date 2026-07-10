use std::net::IpAddr;

use axum::{
    extract::Request,
    http::{header, uri::Authority, HeaderMap, HeaderName, Method, StatusCode, Uri},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub(crate) async fn shared_tunnel_origin_guard(request: Request, next: Next) -> Response {
    if !is_allowed_shared_tunnel_request(request.method(), request.headers()) {
        return (
            StatusCode::FORBIDDEN,
            "nac-web share mode requires a valid Host and matching HTTPS Origin",
        )
            .into_response();
    }
    next.run(request).await
}

fn is_allowed_shared_tunnel_request(method: &Method, headers: &HeaderMap) -> bool {
    let Some(host) = single_header(headers, header::HOST).and_then(parse_authority) else {
        return false;
    };

    match single_header(headers, header::ORIGIN) {
        Some(origin) => parse_https_origin(origin).is_some_and(|origin| origin == host),
        None if headers.contains_key(header::ORIGIN) => false,
        None => is_safe_shared_tunnel_method(method),
    }
}

fn single_header(headers: &HeaderMap, name: HeaderName) -> Option<&str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    if values.next().is_some() {
        return None;
    }
    value.to_str().ok()
}

fn is_safe_shared_tunnel_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedAuthority {
    host: String,
    port: u16,
}

fn parse_https_origin(origin: &str) -> Option<ParsedAuthority> {
    if origin != origin.trim() {
        return None;
    }
    let (scheme, raw_authority) = origin.split_once("://")?;
    if !scheme.eq_ignore_ascii_case("https") {
        return None;
    }
    let uri = origin.parse::<Uri>().ok()?;
    let authority = uri.authority()?;
    if raw_authority != authority.as_str() {
        return None;
    }
    parse_uri_authority(authority, 443)
}

fn parse_authority(authority: &str) -> Option<ParsedAuthority> {
    if authority != authority.trim()
        || authority.is_empty()
        || authority.contains('/')
        || authority.contains("://")
        || authority.contains('@')
    {
        return None;
    }
    let authority = authority.parse::<Authority>().ok()?;
    parse_uri_authority(&authority, 443)
}

fn parse_uri_authority(authority: &Authority, default_port: u16) -> Option<ParsedAuthority> {
    if authority.as_str().contains('@') {
        return None;
    }
    let host = authority.host();
    if !is_valid_authority_host(host) {
        return None;
    }
    let raw_port = authority.as_str().strip_prefix(host)?;
    let port = if raw_port.is_empty() {
        default_port
    } else {
        raw_port
            .strip_prefix(':')?
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)?
    };
    Some(ParsedAuthority {
        host: host.to_ascii_lowercase(),
        port,
    })
}

fn is_valid_authority_host(host: &str) -> bool {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed.parse::<IpAddr>().is_ok() || is_valid_dns_host(host)
}

pub fn is_valid_dns_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || !host.is_ascii() {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            && label
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric)
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_origins_and_normalizes_the_default_port() {
        assert_eq!(
            parse_https_origin("https://NAC.Example.com"),
            Some(ParsedAuthority {
                host: "nac.example.com".to_string(),
                port: 443,
            })
        );
        assert_eq!(
            parse_https_origin("https://nac.example.com:443"),
            parse_authority("nac.example.com")
        );
    }

    #[test]
    fn rejects_non_https_or_malformed_origins() {
        for origin in [
            "http://nac.example.com",
            "https://nac.example.com/",
            "https://nac.example.com/path",
            "https://nac.example.com:",
            "https://user@nac.example.com",
            "https://bad_host.example",
            "null",
        ] {
            assert_eq!(parse_https_origin(origin), None, "accepted {origin}");
        }
    }
}
