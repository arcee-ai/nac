use super::*;
use axum::{body::Body, routing::get};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tower::ServiceExt;

#[test]
fn actual_fixture_identity_requires_both_dev_track_and_a_nonempty_marker() {
    let identity = crate::build_identity::current();
    assert!(require_fixture_identity(identity).is_ok());
    assert_eq!(identity.build_id, env!("NAC_BUILD_ID"));
    assert_eq!(identity.source_revision, env!("NAC_SOURCE_REVISION"));
    for (track, build_id) in [
        ("dev", ""),
        ("dev", "ordinary-custom-id"),
        ("dev", "native-auth-fixture-v1-"),
        ("dev", "native-auth-fixture-v1-   "),
        ("beta", "native-auth-fixture-v1-test"),
        ("stable", "native-auth-fixture-v1-test"),
        ("invalid", "native-auth-fixture-v1-never-emit"),
    ] {
        let error = require_fixture_identity(crate::build_identity::BuildIdentity {
            track,
            build_id,
            ..identity
        })
        .unwrap_err();
        assert!(!error.to_string().contains("never-emit"));
    }
}

#[test]
fn service_is_an_exact_loopback_origin_without_url_authority_or_path_tricks() {
    assert_eq!(
        origin("http://127.0.0.1:43123").unwrap(),
        "http://127.0.0.1:43123"
    );
    for value in [
        "https://127.0.0.1:43123",
        "http://localhost:43123",
        "http://127.0.0.2:43123",
        "http://[::1]:43123",
        "http://127.1:43123",
        "http://2130706433:43123",
        "http://127.0.0.1",
        "http://127.0.0.1:0",
        "http://user@127.0.0.1:43123",
        "http://@127.0.0.1:43123",
        "http://127.0.0.1:43123/path",
        "http://127.0.0.1:43123?code=private-canary",
        "http://127.0.0.1:43123/#private-canary",
    ] {
        let error = origin(value).unwrap_err().to_string();
        assert!(!error.contains("private-canary"));
    }
}

#[tokio::test]
async fn closed_fixture_allows_session_list_bootstrap_but_refuses_effects_before_handlers() {
    let effects = Arc::new(AtomicUsize::new(0));
    let handler = {
        let effects = effects.clone();
        move || async move {
            effects.fetch_add(1, Ordering::SeqCst);
            "effect"
        }
    };
    let app = Router::new()
        .route(
            "/sessions",
            get(|| async { axum::Json(Vec::<serde_json::Value>::new()) })
                .post(handler.clone())
                .put(handler.clone())
                .patch(handler.clone())
                .delete(handler.clone()),
        )
        .route("/{*route}", get(handler.clone()).post(handler))
        .layer(middleware::from_fn(fence));
    for (method, path) in [
        (Method::POST, "/app"),
        (Method::POST, "/app?document=fixture"),
        (Method::PUT, "/app"),
        (Method::PATCH, "/app"),
        (Method::DELETE, "/app"),
        (Method::OPTIONS, "/app"),
        (Method::GET, "/app/"),
        (Method::HEAD, "/app/"),
        (Method::GET, "/app/anything"),
        (Method::HEAD, "/app/anything"),
        (Method::GET, "/application"),
        (Method::GET, "/app%2Fanything"),
        (Method::POST, "/sessions"),
        (Method::POST, "/sessions?workspace_stats=true"),
        (Method::PUT, "/sessions"),
        (Method::PATCH, "/sessions"),
        (Method::DELETE, "/sessions"),
        (Method::POST, "/model-configs"),
        (Method::POST, "/auth/codex/login"),
        (Method::GET, "/sessions/id"),
        (Method::HEAD, "/sessions/id"),
        (Method::GET, "/sessions/"),
        (Method::GET, "/sessions-other"),
        (Method::GET, "/sessions%2Fid"),
        (Method::GET, "/projects/id/sessions"),
        (Method::GET, "/future-effect"),
        (Method::POST, "/future-effect"),
        (Method::DELETE, "/credentials/name"),
    ] {
        let request = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            app.clone().oneshot(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(effects.load(Ordering::SeqCst), 0);
    for (method, path) in [
        (Method::GET, "/sessions"),
        (Method::GET, "/sessions?workspace_stats=true"),
        (Method::GET, "/sessions?project_id=fixture-project"),
        (Method::HEAD, "/sessions"),
    ] {
        let expected_body: &[u8] = if method == Method::HEAD { b"" } else { b"[]" };
        let request = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 16)
            .await
            .unwrap();
        assert_eq!(&body[..], expected_body);
    }
    assert_eq!(effects.load(Ordering::SeqCst), 0);
    for (method, path) in [
        (Method::GET, "/ui-config"),
        (Method::GET, "/app"),
        (Method::GET, "/app?document=fixture"),
        (Method::HEAD, "/app"),
        (Method::HEAD, "/app?document=fixture"),
    ] {
        let expected_body: &[u8] = if method == Method::HEAD {
            b""
        } else {
            b"effect"
        };
        let request = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), 16)
            .await
            .unwrap();
        assert_eq!(&body[..], expected_body);
    }
    assert_eq!(effects.load(Ordering::SeqCst), 5);
    for method in [Method::GET, Method::DELETE] {
        assert!(allowed(
            &method,
            "/auth/arcee/login/0123456789abcdef0123456789abcdef"
        ));
        assert!(!allowed(&method, "/auth/arcee/login/../../sessions"));
    }
}

struct Profile {
    root: PathBuf,
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl Profile {
    fn new() -> Self {
        use std::os::unix::fs::DirBuilderExt;
        let run = uuid::Uuid::new_v4();
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("{ROOT_PREFIX}{run}"));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&root)
            .unwrap();
        for child in ["home", "nac-home", "xdg", "workspace"] {
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(root.join(child))
                .unwrap();
        }
        let names = [
            ROOT_ENV,
            ORIGIN_ENV,
            "HOME",
            "NAC_HOME",
            "XDG_CONFIG_HOME",
            "NAC_MANAGED_CONFIG",
            "NAC_ALLOWED_HOSTS",
            "NAC_ALLOWED_ORIGINS",
            "ARCEE_API_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "EXA_API_KEY",
            "DEEPSEEK_API_KEY",
            "FIREWORKS_API_KEY",
            "TOGETHER_API_KEY",
            "NAC_LIBRARY_EXA_API_KEY",
        ];
        let saved = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        for name in names {
            unsafe {
                std::env::remove_var(name);
            }
        }
        for (name, path) in [
            (ROOT_ENV, root.clone()),
            ("HOME", root.join("home")),
            ("NAC_HOME", root.join("nac-home")),
            ("XDG_CONFIG_HOME", root.join("xdg")),
        ] {
            unsafe {
                std::env::set_var(name, path);
            }
        }
        unsafe {
            std::env::set_var(ORIGIN_ENV, "http://127.0.0.1:43123");
        }
        let profile = Self { root, saved };
        profile.owner(run, crate::build_identity::current().source_revision);
        profile
    }
    fn owner(&self, run: uuid::Uuid, source: &str) {
        use std::os::unix::fs::PermissionsExt;
        let path = self.root.join(SENTINEL);
        std::fs::write(
            &path,
            serde_json::to_vec(
                &serde_json::json!({"version":1,"source_revision":source,"run":run}),
            )
            .unwrap(),
        )
        .unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn validate(&self) -> Result<Admission> {
        validate_profile(
            &self.root.join("workspace"),
            Some(&self.root.join("store.db")),
        )
    }
}
impl Drop for Profile {
    fn drop(&mut self) {
        for (name, value) in self.saved.drain(..).rev() {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn profile_admission_requires_exact_owned_paths_source_and_run_before_effects() {
    use std::os::unix::fs::PermissionsExt;
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let profile = Profile::new();
    assert!(profile.validate().is_ok());
    unsafe {
        std::env::set_var("ARCEE_API_KEY", "fixture-must-not-consume");
    }
    assert!(profile.validate().is_err());
    unsafe {
        std::env::remove_var("ARCEE_API_KEY");
    }
    assert!(profile.validate().is_ok());
    assert!(validate_profile(
        &profile.root.join("home"),
        Some(&profile.root.join("store.db"))
    )
    .is_err());
    assert!(validate_profile(&profile.root.join("workspace"), None).is_err());
    assert!(admit_serving(
        Some(&profile.root.join("workspace")),
        Some(&profile.root.join("store.db")),
        "127.0.0.1:0".parse().unwrap(),
        false,
        false,
        false
    )
    .is_err());
    assert!(!profile.root.join("store.db").exists());
    let sentinel = profile.root.join(SENTINEL);
    let valid = std::fs::read(&sentinel).unwrap();
    profile.owner(uuid::Uuid::new_v4(), "wrong-source");
    assert!(profile.validate().is_err());
    std::fs::write(&sentinel, &valid).unwrap();
    std::fs::set_permissions(&sentinel, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(profile.validate().is_err());
    std::fs::set_permissions(&sentinel, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::rename(&sentinel, profile.root.join("owner-target")).unwrap();
    std::os::unix::fs::symlink(profile.root.join("owner-target"), &sentinel).unwrap();
    assert!(profile.validate().is_err());
    std::fs::remove_file(&sentinel).unwrap();
    std::fs::hard_link(profile.root.join("owner-target"), &sentinel).unwrap();
    assert!(profile.validate().is_err());
    std::fs::remove_file(&sentinel).unwrap();
    std::fs::rename(profile.root.join("owner-target"), &sentinel).unwrap();
    assert!(profile.validate().is_ok());
    let store = profile.root.join("store.db");
    std::os::unix::fs::symlink(&sentinel, &store).unwrap();
    assert!(profile.validate().is_err());
    std::fs::remove_file(store).unwrap();
    unsafe {
        std::env::set_var("NAC_HOME", profile.root.join("home"));
    }
    assert!(profile.validate().is_err());
    assert!(!profile.root.join("store.db").exists());
    assert_eq!(std::fs::read(sentinel).unwrap(), valid);
}
