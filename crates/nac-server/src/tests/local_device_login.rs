//! Actual ordinary-local pending/credential/registry owners; HTTP approval is
//! a local double, not native browser or real-provider acceptance.
use super::*;
use axum::routing::{get, post};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::sync::{oneshot, Notify};

#[derive(Default)]
struct DeviceState {
    outcome: AtomicUsize,
    starts: AtomicUsize,
    block_token: AtomicBool,
    token_seen: Notify,
    token_release: Notify,
}

struct DeviceFixture {
    origin: String,
    state: Arc<DeviceState>,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl DeviceFixture {
    async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(DeviceState::default());
        let verification = format!("{origin}/approve");
        let app = axum::Router::new()
            .route(
                "/app/v1/device/code",
                post({
                    let verification = verification.clone();
                    move |State(state): State<Arc<DeviceState>>, Json(body): Json<serde_json::Value>| {
                        let verification = verification.clone();
                        async move {
                            assert_eq!(body, json!({"client_id": "nac-cli"}));
                            state.starts.fetch_add(1, Ordering::SeqCst);
                            Json(json!({"device_code":"local-device-canary","user_code":"LOCAL-FIXTURE",
                                "verification_uri_complete":verification,"interval":1,"expires_in":60}))
                        }
                    }
                }),
            )
            .route("/app/v1/device/token", post(device_token))
            .route(
                "/approve",
                get(|State(state): State<Arc<DeviceState>>| async move {
                    state.outcome.store(1, Ordering::SeqCst);
                    "Approved local fixture"
                }),
            )
            .with_state(state.clone());
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
        });
        Self {
            origin,
            state,
            stop,
            task,
        }
    }

    async fn finish(self) {
        let _ = self.stop.send(());
        tokio::time::timeout(Duration::from_secs(3), self.task)
            .await
            .unwrap()
            .unwrap();
    }
}

async fn device_token(
    State(state): State<Arc<DeviceState>>,
    Json(body): Json<serde_json::Value>,
) -> (StatusCode, Json<serde_json::Value>) {
    assert_eq!(
        body,
        json!({"device_code":"local-device-canary","client_id":"nac-cli"})
    );
    state.token_seen.notify_one();
    if state.block_token.load(Ordering::SeqCst) {
        state.token_release.notified().await;
    }
    let outcome = state.outcome.load(Ordering::SeqCst);
    if outcome == 1 {
        (
            StatusCode::OK,
            Json(
                json!({"access_token":"local-access-canary","refresh_token":"local-refresh-canary",
            "token_type":"bearer","expires_in":3600,"base_url":"https://api.arcee.ai/api/v1",
            "organization_id":"local-org","workspace_name":"local-workspace"}),
            ),
        )
    } else {
        let error = match outcome {
            2 => "access_denied",
            3 => "expired_token",
            _ => "authorization_pending",
        };
        (StatusCode::BAD_REQUEST, Json(json!({"error":error})))
    }
}

async fn settle(manager: &SessionManager, id: &str) -> DeviceLoginStateResponse {
    tokio::time::timeout(Duration::from_secs(4), async {
        loop {
            match manager
                .poll_managed_login(ManagedAuthProvider::Arcee, id)
                .unwrap()
            {
                DeviceLoginStateResponse::Pending => tokio::task::yield_now().await,
                outcome => break outcome,
            }
        }
    })
    .await
    .expect("local device fixture did not settle")
}

#[tokio::test]
async fn local_device_owner_completes_denies_expires_cancels_and_reloads_without_replay() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-local-device-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _environment = crate::tests::ScopedModelEnv::isolated(&nac_home, None);
    let manager = crate::tests::test_manager(&root);
    let fixture = DeviceFixture::start().await;
    let pending =
        nac_core::model::begin_local_arcee_login_with_auth_service_for_test(&fixture.origin)
            .await
            .unwrap();
    let started = manager
        .register_managed_login(ManagedAuthProvider::Arcee, pending)
        .await
        .unwrap();
    assert!(matches!(
        manager
            .poll_managed_login(ManagedAuthProvider::Arcee, &started.login_id)
            .unwrap(),
        DeviceLoginStateResponse::Pending
    ));
    assert_eq!(
        started.verification_uri,
        format!("{}/approve", fixture.origin)
    );
    // Explicit HTTP stand-in for approval. Native/browser qualification is separate.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut browser = tokio::net::TcpStream::connect(fixture.origin.trim_start_matches("http://"))
        .await
        .unwrap();
    browser
        .write_all(b"GET /approve HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .unwrap();
    let mut approval = Vec::new();
    browser.read_to_end(&mut approval).await.unwrap();
    assert!(approval.starts_with(b"HTTP/1.1 200"));
    let outcome = settle(&manager, &started.login_id).await;
    assert!(matches!(&outcome, DeviceLoginStateResponse::Complete { auth } if auth.signed_in));
    let public = serde_json::to_string(&outcome).unwrap();
    for secret in [
        "local-access-canary",
        "local-refresh-canary",
        "local-device-canary",
    ] {
        assert!(!public.contains(secret));
    }
    let credential_path = nac_home.join("arcee_auth.json");
    let retained = std::fs::read(&credential_path).unwrap();
    let stored: serde_json::Value = serde_json::from_slice(&retained).unwrap();
    assert_eq!(stored["client_id"], "nac-cli");
    assert_eq!(
        stored["auth_issuer"],
        nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER
    );
    assert!(stored["managed_bootstrap"].is_null());

    for (mode, message) in [(2, "denied"), (3, "expired")] {
        fixture.state.outcome.store(mode, Ordering::SeqCst);
        let pending =
            nac_core::model::begin_local_arcee_login_with_auth_service_for_test(&fixture.origin)
                .await
                .unwrap();
        let failed = manager
            .register_managed_login(ManagedAuthProvider::Arcee, pending)
            .await
            .unwrap();
        assert!(
            matches!(settle(&manager, &failed.login_id).await, DeviceLoginStateResponse::Failed { error } if error.contains(message))
        );
        assert_eq!(std::fs::read(&credential_path).unwrap(), retained);
    }

    assert_eq!(fixture.state.starts.load(Ordering::SeqCst), 3);
    fixture.finish().await;
    let fixture = DeviceFixture::start().await;
    fixture.state.block_token.store(true, Ordering::SeqCst);
    let pending =
        nac_core::model::begin_local_arcee_login_with_auth_service_for_test(&fixture.origin)
            .await
            .unwrap();
    let canceled = manager
        .register_managed_login(ManagedAuthProvider::Arcee, pending)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), fixture.state.token_seen.notified())
        .await
        .unwrap();
    let abort = manager.inner.managed_logins.entries.lock().unwrap()[&canceled.login_id]
        .task
        .abort_handle();
    assert!(manager.cancel_managed_login(&canceled.login_id));
    tokio::time::timeout(Duration::from_secs(3), async {
        while !abort.is_finished() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    fixture.state.outcome.store(1, Ordering::SeqCst);
    fixture.state.token_release.notify_one();
    assert_eq!(
        manager
            .poll_managed_login(ManagedAuthProvider::Arcee, &canceled.login_id)
            .err()
            .unwrap()
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(std::fs::read(&credential_path).unwrap(), retained);
    drop(manager);
    let restarted = crate::tests::test_manager(&root);
    assert!(
        managed_auth_snapshot(ManagedAuthProvider::Arcee)
            .unwrap()
            .signed_in
    );
    assert_eq!(
        restarted
            .poll_managed_login(ManagedAuthProvider::Arcee, &canceled.login_id)
            .err()
            .unwrap()
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(fixture.state.starts.load(Ordering::SeqCst), 1);
    fixture.finish().await;
    drop(restarted);
    std::fs::remove_dir_all(root).unwrap();
}
