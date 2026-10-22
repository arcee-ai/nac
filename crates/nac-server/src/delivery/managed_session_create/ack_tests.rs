//! New actual pinned listener negatives. No genuine CREATE publication is minted.
use super::*;

#[tokio::test]
async fn fresh_ack_v2_requires_retained_original_terminal_and_never_returns_synthetic_204() {
    use tower::ServiceExt;
    let f = fixture();
    let listener =
        RuntimeTlsListener::bind_create_issuer("127.0.0.1:0".parse().unwrap(), identity())
            .await
            .unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, done) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(super::super::super::serve_managed_location_facts(
        listener,
        f.manager.clone(),
        async {
            let _ = done.await;
        },
    ));
    let ack = json!({"schema":"managed-session-create-ack.v2","purpose":"managed-session-create-ack.v2",
        "operation":{"id":Uuid::from_u128(21),"claim_sequence":1,"session_id":Uuid::from_u128(22)},
        "intent":{"sha256":"12".repeat(32),"configuration_sha256":"34".repeat(32)},
        "receipt":{"session_id":Uuid::from_u128(22),"configuration_version":0,"configuration_digest":"34".repeat(32)},
        "terminal_body_sha256":"56".repeat(32)});
    let body = serde_json::to_vec(&ack).unwrap();
    let path = "/internal/v1/managed-session-create/ack";
    // Real mTLS transport and a complete tuple cannot reconstruct a Core half.
    assert_eq!(
        exchange(address, Some("d-service"), "POST", path, &body, &headers())
            .await
            .unwrap()
            .0,
        503
    );
    for peer in [None, Some("wrong-peer"), Some("untrusted")] {
        assert!(exchange(address, peer, "POST", path, &body, &headers())
            .await
            .is_err());
    }
    for (key, value, status) in [
        ("if-match", "duplicate", 400),
        ("x-nac-request-id", "duplicate", 400),
        ("x-nac-expires-at-epoch-ms", "duplicate", 403),
        ("authorization", "Bearer private-canary", 400),
    ] {
        let mut h = headers();
        h.push((key, value.to_owned()));
        let response = exchange(address, Some("d-service"), "POST", path, &body, &h)
            .await
            .unwrap();
        assert_eq!(response.0, status);
        assert!(!response.1.to_string().contains("private-canary"));
    }
    for raw in [
        format!(
            "{{\"purpose\":\"managed-session-create-ack.v2\",{}",
            &String::from_utf8(body.clone()).unwrap()[1..]
        ),
        {
            let mut extra = ack.clone();
            extra["grant"] = json!(true);
            extra.to_string()
        },
        {
            let mut missing = ack.clone();
            missing
                .as_object_mut()
                .unwrap()
                .remove("terminal_body_sha256");
            missing.to_string()
        },
        {
            let mut unknown = ack.clone();
            unknown["receipt"]["source"] = json!(true);
            unknown.to_string()
        },
    ] {
        assert_eq!(
            exchange(
                address,
                Some("d-service"),
                "POST",
                path,
                raw.as_bytes(),
                &headers()
            )
            .await
            .unwrap()
            .0,
            400
        );
    }
    let mut expired = headers();
    for (key, value) in &mut expired {
        if *key == "x-nac-expires-at-epoch-ms" {
            *value = "1".to_owned();
        }
    }
    assert_eq!(
        exchange(address, Some("d-service"), "POST", path, &body, &expired)
            .await
            .unwrap()
            .0,
        403
    );
    let response = crate::router(f.manager.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(path)
                .body(axum::body::Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    // Explicit v2 Accept is understood, but participant admission remains closed.
    let mut v2 = headers();
    for (key, value) in &mut v2 {
        if *key == "accept" {
            *value = crate::application::create_terminal::MEDIA_TYPE.to_owned();
        }
    }
    assert_eq!(
        exchange(
            address,
            Some("d-service"),
            "POST",
            PATH,
            &serde_json::to_vec(&envelope(&f)).unwrap(),
            &v2
        )
        .await
        .unwrap()
        .0,
        503
    );
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
    assert!(f.manager.inner.active_sessions.read().await.is_empty());
    assert!(!f
        .manager
        .inner
        .create_transfers
        .retains_session(&Uuid::from_u128(22).to_string()));
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
}

/// Read-only TLS enrollment must fail before it can wait on a request body.
#[tokio::test]
async fn ordinary_enrollment_cannot_poll_ack_body_or_schedule_cleanup() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let f = fixture();
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let (stop, done) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(super::super::super::serve_managed_location_facts(
        listener,
        f.manager.clone(),
        async {
            let _ = done.await;
        },
    ));
    let mut stream =
        crate::delivery::managed_runtime_tls::tests::client(address, Some("d-service"))
            .await
            .unwrap();
    let fields = headers()
        .iter()
        .map(|(key, value)| format!("{key}: {value}\r\n"))
        .collect::<String>();
    stream.write_all(format!("POST /internal/v1/managed-session-create/ack HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 100\r\n{fields}\r\n").as_bytes()).await.unwrap();
    let mut response = Vec::new();
    // The original expiry is 30s. No body ever arrives: admission must refuse
    // without waiting for that timer or interpreting copied operation DATA.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        stream.read_to_end(&mut response),
    )
    .await;
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
    result.unwrap().unwrap();
    assert!(String::from_utf8(response)
        .unwrap()
        .starts_with("HTTP/1.1 403"));
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
    assert!(!f
        .manager
        .inner
        .create_transfers
        .retains_session(&Uuid::from_u128(22).to_string()));
}
