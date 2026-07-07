use axum::{
    extract::Request,
    http::{header, uri::Authority, HeaderMap, Method, StatusCode, Uri},
    middleware::Next,
    response::{IntoResponse, Response},
};

pub(crate) async fn shared_tunnel_origin_guard(request: Request, next: Next) -> Response {
    if !is_allowed_shared_tunnel_request(request.method(), request.headers()) {
        return (
            StatusCode::FORBIDDEN,
            "nac-web share mode requires Origin to match Host",
        )
            .into_response();
    }
    next.run(request).await
}

fn is_allowed_shared_tunnel_request(method: &Method, headers: &HeaderMap) -> bool {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let Some(origin) = origin else {
        return is_safe_shared_tunnel_method(method);
    };
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    origin_matches_host(origin, host)
}

fn is_safe_shared_tunnel_method(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedOrigin {
    scheme: OriginScheme,
    host: String,
    port: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OriginScheme {
    Http,
    Https,
}

impl OriginScheme {
    fn default_port(self) -> u16 {
        match self {
            Self::Http => 80,
            Self::Https => 443,
        }
    }
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    let Some(origin) = parse_origin(origin) else {
        return false;
    };
    let Some(host) = parse_host_authority(host) else {
        return false;
    };
    if !origin.host.eq_ignore_ascii_case(host.host()) {
        return false;
    }
    match (origin.port, host.port_u16()) {
        (_, Some(host_port)) => {
            origin.port.unwrap_or_else(|| origin.scheme.default_port()) == host_port
        }
        (Some(origin_port), None) => origin_port == origin.scheme.default_port(),
        (None, None) => true,
    }
}

fn parse_origin(origin: &str) -> Option<ParsedOrigin> {
    let uri = origin.trim().parse::<Uri>().ok()?;
    if let Some(path_and_query) = uri.path_and_query() {
        if path_and_query.as_str() != "/" {
            return None;
        }
    }
    let scheme = match uri.scheme_str()? {
        scheme if scheme.eq_ignore_ascii_case("http") => OriginScheme::Http,
        scheme if scheme.eq_ignore_ascii_case("https") => OriginScheme::Https,
        _ => return None,
    };
    let authority = uri.authority()?;
    if authority.as_str().contains('@') {
        return None;
    }
    let host = authority.host().trim();
    if host.is_empty() {
        return None;
    }
    Some(ParsedOrigin {
        scheme,
        host: host.to_ascii_lowercase(),
        port: authority.port_u16(),
    })
}

fn parse_host_authority(host: &str) -> Option<Authority> {
    let host = host.trim();
    if host.is_empty() || host.contains('/') || host.contains("://") || host.contains('@') {
        return None;
    }
    host.parse::<Authority>().ok()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use axum::body::Body;
    use tower::ServiceExt;

    use super::*;
    use crate::{
        router_with_options, CorsPolicy, ExposureMode, ServeOptions, ServerOptions, SessionManager,
    };

    #[tokio::test]
    async fn shared_tunnel_router_rejects_missing_origin_for_mutation() {
        let status =
            shared_tunnel_post_health_status("missing_origin", "nac.example.com", None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_rejects_malformed_origin_for_mutation() {
        let status = shared_tunnel_post_health_status(
            "malformed_origin",
            "nac.example.com",
            Some("https://nac.example.com/path"),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_allows_tunnel_origin_for_mutation() {
        let status = shared_tunnel_post_health_status(
            "allowed_tunnel_origin",
            "nac-test.ngrok-free.app",
            Some("https://nac-test.ngrok-free.app"),
        )
        .await;
        assert_ne!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_normalizes_default_ports_for_mutation() {
        let explicit_host_status = shared_tunnel_post_health_status(
            "default_port_host",
            "nac.example.com:443",
            Some("https://nac.example.com"),
        )
        .await;
        let explicit_origin_status = shared_tunnel_post_health_status(
            "default_port_origin",
            "nac.example.com",
            Some("https://nac.example.com:443"),
        )
        .await;

        assert_ne!(explicit_host_status, StatusCode::FORBIDDEN);
        assert_ne!(explicit_origin_status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_rejects_disallowed_origin_for_mutation() {
        let status = shared_tunnel_post_health_status(
            "disallowed_origin",
            "nac.example.com",
            Some("https://evil.example"),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_rejects_disallowed_origin_for_read() {
        let status = shared_tunnel_health_status(
            Method::GET,
            "disallowed_read_origin",
            "nac.example.com",
            Some("https://evil.example"),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_allows_safe_read_without_origin() {
        let status =
            shared_tunnel_health_status(Method::GET, "safe_read_no_origin", "nac.example.com", None)
                .await;
        assert_ne!(status, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn shared_tunnel_router_rejects_extension_method_without_origin() {
        let status = shared_tunnel_health_status(
            Method::from_bytes(b"PURGE").expect("extension method"),
            "extension_method_missing_origin",
            "nac.example.com",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_server_origin_guard_{label}_{unique}"));
        std::fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn test_manager(root: &Path) -> SessionManager {
        SessionManager::new(ServerOptions {
            root_cwd: root.to_path_buf(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
        })
        .expect("session manager")
    }

    async fn shared_tunnel_post_health_status(
        label: &str,
        host: &str,
        origin: Option<&str>,
    ) -> StatusCode {
        shared_tunnel_health_status(Method::POST, label, host, origin).await
    }

    async fn shared_tunnel_health_status(
        method: Method,
        label: &str,
        host: &str,
        origin: Option<&str>,
    ) -> StatusCode {
        let root = temp_root(label);
        let manager = test_manager(&root);
        let app = router_with_options(
            manager,
            ServeOptions {
                cors: CorsPolicy::Disabled,
                exposure: ExposureMode::SharedTunnel,
            },
        );
        let mut builder = Request::builder()
            .method(method)
            .uri("/health")
            .header(header::HOST, host);
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        let response = app
            .oneshot(builder.body(Body::empty()).expect("request"))
            .await
            .expect("router response");
        let status = response.status();
        let _ = std::fs::remove_dir_all(&root);
        status
    }
}
