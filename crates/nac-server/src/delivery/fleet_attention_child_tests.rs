//! Real traditional child delegation: the child's own broker decision reaches
//! native and browser observers once, attributed to the child, never the parent.
use super::*;

const DESCRIPTION: &str = "Fleet attention child approval journey";

fn launch(fixture: &Fixture) -> tokio::task::JoinHandle<StatusCode> {
    let app = fixture.app.clone();
    tokio::spawn(async move {
        let body = serde_json::json!({
            "profile": "general",
            "description": DESCRIPTION,
            "prompt": "child runs the command",
            "background": false,
        });
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/session/children")
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
    })
}

async fn child_id(app: &Router) -> String {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let children = json(app, "/sessions/session/children").await;
            if let Some(child) = children
                .as_array()
                .unwrap()
                .iter()
                .find(|child| child["description"] == DESCRIPTION)
            {
                return child["child_session_id"].as_str().unwrap().to_owned();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("child relationship committed")
}

fn has_child_permission(child: &str) -> impl Fn(&Sessions) -> bool + '_ {
    move |state| !pending_permissions(state.get(child)).is_empty()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_child_permission_is_one_child_record_natively_and_in_every_browser_stream() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = fixture().await;
    let (app, manager) = (fixture.app.clone(), fixture.manager.clone());
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let native = app
        .clone()
        .oneshot(get("/attention/events", "127.0.0.1:12345"))
        .await
        .unwrap();
    assert_eq!(native.status(), StatusCode::OK);
    let mut native = Frames::new(native);
    assert_eq!(native.next().await["kind"], "baseline");
    let parent = manager.attach_session("session").await.unwrap();
    let mut first = open(&app, "/attention/stream").await;
    let mut second = open(&app, "/attention/stream").await;
    let (mut one, mut two) = (Sessions::new(), Sessions::new());
    until(&mut first, &mut one, |state| state.len() == 3).await;
    until(&mut second, &mut two, |state| state.len() == 3).await;

    let launched = launch(&fixture);
    let child = child_id(&app).await;
    // The delegated parent view is the child's interactive client.
    let service = manager.attach_session(&child).await.unwrap();
    let interactive = service.subscribe_events_for_client_with_replay(
        nac_core::events::SessionClientId::new(),
        None,
        32,
    );
    until(&mut first, &mut one, has_child_permission(&child)).await;
    until(&mut second, &mut two, has_child_permission(&child)).await;
    let exact = service.list_permission_requests().unwrap()[0].id.clone();
    for state in [&one, &two] {
        let entry = &state[&child];
        assert_eq!(pending_permissions(Some(entry)), vec![exact.clone()]);
        assert_eq!(entry["session_id"], child);
        assert_eq!(entry["availability"]["permissions"], "available");
        assert_eq!(entry["availability"]["topology"], "available");
        assert_eq!(entry["lineage"]["kind"], "traditional-child");
        assert_eq!(entry["lineage"]["parent_session_id"], "session");
        assert_eq!(entry["lineage"]["root_session_id"], "session");
        // Never duplicated onto the parent.
        assert!(pending_permissions(state.get("session")).is_empty());
    }
    assert!(parent.list_permission_requests().unwrap().is_empty());

    let target = format!("/sessions/{child}/permissions/{exact}");
    assert_eq!(
        fixture.post(&target, r#"{"reply":"reject"}"#).await,
        StatusCode::NO_CONTENT
    );
    let cleared = |state: &Sessions| pending_permissions(state.get(&child)).is_empty();
    until(&mut first, &mut one, cleared).await;
    until(&mut second, &mut two, cleared).await;

    // Native: exactly one new-attention record, on the child source, then
    // its resolution; nothing is attributed to the parent.
    let mut pending = Vec::new();
    loop {
        let frame = native.next().await;
        assert_ne!(frame["kind"], "reset", "{frame}");
        let kind = frame["change"]["kind"].as_str().unwrap_or_default();
        if kind == "decision_pending" {
            pending.push(frame.clone());
        }
        if matches!(kind, "decision_pending" | "decision_resolved") {
            assert_eq!(frame["source"]["session_id"], child, "{frame}");
        }
        if kind == "decision_resolved" {
            assert_eq!(frame["change"]["decision"]["request_id"], exact);
            break;
        }
    }
    assert_eq!(pending.len(), 1, "{pending:?}");
    assert_eq!(pending[0]["change"]["decision"]["request_id"], exact);
    assert_eq!(pending[0]["new_attention"], true);

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(10), launched)
            .await
            .unwrap()
            .unwrap(),
        StatusCode::CREATED
    );
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
    drop((first, second, native, interactive, service, parent));
    manager.inner.attention.stop();
    drop(manager);
    fixture.finish().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn headless_child_ask_with_only_fleet_attention_observers_still_fails_closed() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = fixture().await;
    let (app, manager) = (fixture.app.clone(), fixture.manager.clone());
    let mut first = open(&app, "/attention/stream").await;
    let _second = open(&app, "/attention/stream").await;
    let mut state = Sessions::new();
    until(&mut first, &mut state, |state| state.len() == 3).await;
    let launched = launch(&fixture);
    let child = child_id(&app).await;
    // No interactive client for the child: the existing delegated grace ends in
    // the same denial whether or not browser attention is observing.
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(20), launched)
            .await
            .unwrap()
            .unwrap(),
        StatusCode::CREATED
    );
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 2);
    let denial = fixture.requests.lock().unwrap()[1].to_string();
    assert!(
        denial.contains("no interactive parent session client connected"),
        "{denial}"
    );
    let service = manager.attach_session(&child).await.unwrap();
    assert!(service.list_permission_requests().unwrap().is_empty());
    // Whatever was briefly pending during the grace is gone on the next record.
    until(&mut first, &mut state, |state| {
        state.contains_key(&child) && pending_permissions(state.get(&child)).is_empty()
    })
    .await;
    drop((first, service));
    drop(manager);
    fixture.finish().await;
}
