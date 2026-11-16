//! Real HTTP admission/model/terminal transaction/semantic SSE at exact G2.
//! This is canonical service evidence, never an AppKit crash/ACK cutpoint.
//! Direct pauses at actual Idle; DWO at actual IdleUnverified. Both pauses
//! follow durable terminal settlement/local release and precede publication attempt.
#![expect(clippy::unwrap_used, reason = "isolated integration test assertions")]
use super::*;
use crate::tests::{ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    response::IntoResponse,
    Json, Router,
};
use futures_core::Stream;
use nac_core::session_service::AttentionPublicationSelection;
use nac_core::store;
use std::{
    pin::Pin,
    sync::atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

type Feed = Pin<Box<dyn Stream<Item = std::result::Result<Bytes, axum::Error>> + Send>>;
struct Provider(Option<tokio::task::JoinHandle<()>>);
impl Provider {
    async fn stop(mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
            let _ = task.await;
        }
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        if let Some(task) = &self.0 {
            task.abort();
        }
    }
}
async fn post(app: Router, path: &str, value: serde_json::Value) -> serde_json::Value {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(
        response.status().is_success(),
        "{path}: {}",
        response.status()
    );
    serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}
async fn open(app: Router, cursor: &str) -> Feed {
    let response = app
        .oneshot(
            Request::builder()
                .uri("/attention/events")
                .header("host", "127.0.0.1:12345")
                .header("x-nac-completion-cursor", cursor)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    Box::pin(response.into_body().into_data_stream())
}
async fn retire_feed(
    manager: &SessionManager,
    feed: Feed,
) -> std::result::Result<(), tokio::time::error::Elapsed> {
    drop(feed);
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.attention.0.lock().unwrap().seat.is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
}
// Failure-only, descriptor-relative census of this fixture's owned root.
// Never resolve a discovered directory through its pathname after opening it.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn cleanup_directory(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
struct CleanupDirectory(*mut libc::DIR);

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl CleanupDirectory {
    fn open(file: std::fs::File) -> std::io::Result<Self> {
        use std::os::fd::{FromRawFd, IntoRawFd};
        let fd = file.into_raw_fd();
        // SAFETY: fd is a live, exclusively owned directory descriptor. On
        // success fdopendir takes ownership, released by closedir below.
        let stream = unsafe { libc::fdopendir(fd) };
        if stream.is_null() {
            let error = std::io::Error::last_os_error();
            // SAFETY: fdopendir failed and did not consume the descriptor.
            drop(unsafe { std::fs::File::from_raw_fd(fd) });
            Err(error)
        } else {
            Ok(Self(stream))
        }
    }

    fn next_name(&mut self) -> std::io::Result<Option<std::ffi::CString>> {
        #[cfg(target_os = "linux")]
        // SAFETY: libc returns this thread's live errno storage.
        let errno = unsafe { libc::__errno_location() };
        #[cfg(target_os = "macos")]
        // SAFETY: libc returns this thread's live errno storage.
        let errno = unsafe { libc::__error() };
        loop {
            // SAFETY: the DIR is exclusively owned, and errno is thread-local.
            let entry = unsafe {
                *errno = 0;
                libc::readdir(self.0)
            };
            if entry.is_null() {
                // SAFETY: errno remains valid on this same thread.
                let code = unsafe { *errno };
                return if code == 0 {
                    Ok(None)
                } else {
                    Err(std::io::Error::from_raw_os_error(code))
                };
            }
            // SAFETY: readdir returned a live dirent with a NUL-terminated name.
            // Copy it before any subsequent readdir call invalidates the entry.
            let name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) }.to_owned();
            if name.to_bytes() != b"." && name.to_bytes() != b".." {
                return Ok(Some(name));
            }
        }
    }

    fn metadata(&self, name: &std::ffi::CStr) -> std::io::Result<libc::stat> {
        let mut metadata = std::mem::MaybeUninit::uninit();
        // SAFETY: the DIR and copied name remain live, metadata is writable,
        // and AT_SYMLINK_NOFOLLOW returns metadata for the link itself.
        let result = unsafe {
            libc::fstatat(
                libc::dirfd(self.0),
                name.as_ptr(),
                metadata.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: successful fstatat initialized the entire stat value.
        Ok(unsafe { metadata.assume_init() })
    }

    fn child(&self, name: &std::ffi::CStr) -> std::io::Result<std::fs::File> {
        use std::os::fd::FromRawFd;
        // SAFETY: the directory and copied name are live. O_NOFOLLOW rejects a
        // replacement link; relative lookup stays bound to this owned directory.
        let fd = unsafe {
            libc::openat(
                libc::dirfd(self.0),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            Err(std::io::Error::last_os_error())
        }
        // SAFETY: successful openat returned a new, exclusively owned descriptor.
        else {
            Ok(unsafe { std::fs::File::from_raw_fd(fd) })
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl Drop for CleanupDirectory {
    fn drop(&mut self) {
        // SAFETY: this object exclusively owns the live stream and its fd.
        unsafe {
            libc::closedir(self.0);
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn cleanup_census(directory: std::fs::File) -> serde_json::Value {
    use std::os::unix::ffi::OsStrExt;
    const MAX_ENTRIES: usize = 32;
    const MAX_DEPTH: usize = 3;
    let mut pending = vec![(directory, std::path::PathBuf::new(), 0)];
    let mut entries = Vec::new();
    let mut truncated = false;
    while let Some((directory, relative, depth)) = pending.pop() {
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        let mut directory = match CleanupDirectory::open(directory) {
            Ok(directory) => directory,
            Err(error) => {
                entries.push(serde_json::json!({"path":relative.to_string_lossy(),"stage":"fdopendir","error":error.to_string()}));
                continue;
            }
        };
        loop {
            // Do not fetch an unbounded extra entry just to classify truncation.
            if entries.len() == MAX_ENTRIES {
                truncated = true;
                break;
            }
            let name = match directory.next_name() {
                Ok(Some(name)) => name,
                Ok(None) => break,
                Err(error) => {
                    entries.push(serde_json::json!({"path":relative.to_string_lossy(),"stage":"readdir","error":error.to_string()}));
                    break;
                }
            };
            let path = relative.join(std::ffi::OsStr::from_bytes(name.to_bytes()));
            let metadata = match directory.metadata(&name) {
                Ok(metadata) => metadata,
                Err(error) => {
                    entries.push(serde_json::json!({"path":path.to_string_lossy(),"stage":"fstatat_nofollow","error":error.to_string()}));
                    continue;
                }
            };
            let mode = metadata.st_mode as u32;
            let kind = match mode & libc::S_IFMT as u32 {
                value if value == libc::S_IFLNK as u32 => "symlink",
                value if value == libc::S_IFDIR as u32 => "directory",
                value if value == libc::S_IFREG as u32 => "file",
                _ => "other",
            };
            entries.push(serde_json::json!({"path":path.to_string_lossy(),"kind":kind,"inode":metadata.st_ino,"mode":mode,"bytes":metadata.st_size}));
            if kind == "directory" {
                if depth + 1 == MAX_DEPTH {
                    truncated = true;
                } else {
                    match directory.child(&name) {
                        Ok(owned) => pending.push((owned, path, depth + 1)),
                        Err(error) => {
                            *entries.last_mut().unwrap() = serde_json::json!({"path":path.to_string_lossy(),"stage":"openat_nofollow","error":error.to_string()});
                        }
                    }
                }
            }
        }
        if entries.len() == MAX_ENTRIES {
            break;
        }
    }
    serde_json::json!({"entries":entries,"truncated":truncated,"max_entries":MAX_ENTRIES,"max_depth":MAX_DEPTH})
}

fn cleanup_failure(
    root: &std::path::Path,
    error: &std::io::Error,
    receipts: serde_json::Value,
) -> serde_json::Value {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let census = match cleanup_directory(root) {
        Ok(directory) => cleanup_census(directory),
        Err(error) => serde_json::json!({"stage":"open_root_nofollow","error":error.to_string()}),
    };
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let census = serde_json::json!({"unavailable":"no descriptor-bound census on this platform"});
    serde_json::json!({
        "operation":"remove_dir_all", "root":root.to_string_lossy(), "error":error.to_string(),
        "error_kind":format!("{:?}",error.kind()), "raw_os_error":error.raw_os_error(),
        "failed_descendant":"not supplied by std::fs::remove_dir_all",
        "receipts":receipts, "remaining_owned_entries":census,
    })
}

fn remove_semantic_root(
    root: &std::path::Path,
    receipts: serde_json::Value,
) -> std::io::Result<()> {
    // Exactly the original operation, once. A failed census cannot replace the
    // primary deletion error, and no removal/cleanup retry runs after failure.
    let result = std::fs::remove_dir_all(root);
    if let Err(error) = &result {
        use std::io::Write;
        // A diagnostic-output failure must not mask the original removal error.
        let _ = writeln!(
            std::io::stderr().lock(),
            "semantic-g2-cleanup-failure {}",
            cleanup_failure(root, error, receipts)
        );
    }
    result
}

async fn frame(body: &mut Feed, stage: &str) -> serde_json::Value {
    eprintln!(
        "semantic-g2-stage {}",
        serde_json::json!({"stage":stage,"poll":"begin"})
    );
    let bytes = tokio::time::timeout(
        Duration::from_secs(5),
        std::future::poll_fn(|cx| body.as_mut().poll_next(cx)),
    )
    .await
    .unwrap()
    .unwrap()
    .unwrap();
    let text = std::str::from_utf8(&bytes).unwrap();
    let value: serde_json::Value = serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap();
    eprintln!(
        "semantic-g2-stage {}",
        serde_json::json!({"stage":stage,"frame":value})
    );
    value
}
async fn completion(
    body: &mut Feed,
    run: &str,
    stale: &str,
    seen: &mut std::collections::BTreeSet<i64>,
) -> serde_json::Value {
    for _ in 0..100 {
        let value = frame(body, run).await;
        assert_ne!(value["kind"], "reset", "{value}");
        assert!(
            !(value["change"]["work"]["run_id"] == stale
                && value["change"]["work"]["disposition"] == "completed"),
            "legacy current-only completion cannot survive B: {value}"
        );
        if value["kind"] == "completions" {
            for item in value["page"]["items"].as_array().unwrap() {
                assert!(
                    seen.insert(item["sequence"].as_i64().unwrap()),
                    "duplicate semantic delivery: {item}"
                );
                if item["run_id"] == run {
                    return serde_json::json!({"item":item,"page":value["page"]});
                }
            }
        }
    }
    panic!("missing semantic completion {run}");
}
async fn interleave(behavior: &str) {
    let root = std::env::temp_dir().join(format!("nac-semantic-g2-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(AtomicUsize::new(0));
    let entered_a = Arc::new(Notify::new());
    let release_a = Arc::new(Notify::new());
    let entered_b = Arc::new(Notify::new());
    let release_b = Arc::new(Notify::new());
    let handler = {
        let (calls, entered_a, release_a, entered_b, release_b) = (
            calls.clone(),
            entered_a.clone(),
            release_a.clone(),
            entered_b.clone(),
            release_b.clone(),
        );
        move |Json(request): Json<serde_json::Value>| {
            let (calls, entered_a, release_a, entered_b, release_b) = (
                calls.clone(),
                entered_a.clone(),
                release_a.clone(),
                entered_b.clone(),
                release_b.clone(),
            );
            async move {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                assert!(index < 2);
                let prompt = request["input"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .rev()
                    .find(|item| item["role"] == "user")
                    .unwrap()["content"]
                    .to_string();
                assert!(prompt.len() <= 4096);
                let expected = if index == 0 {
                    "semantic A"
                } else {
                    "semantic B"
                };
                assert!(prompt.contains(expected), "provider {index}: {prompt}");
                eprintln!(
                    "semantic-g2-provider {}",
                    serde_json::json!({"index":index,"prompt":prompt,"stage":"entered"})
                );
                let (entered, release) = if index == 0 {
                    (entered_a, release_a)
                } else {
                    (entered_b, release_b)
                };
                entered.notify_one();
                tokio::time::timeout(Duration::from_secs(5), release.notified())
                    .await
                    .unwrap();
                eprintln!(
                    "semantic-g2-provider {}",
                    serde_json::json!({"index":index,"stage":"released"})
                );
                let item = serde_json::json!({"type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":format!("semantic result {index}")}]});
                let response = serde_json::json!({"status":"completed","output":[item.clone()],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
                if request["stream"] == true {
                    ([("content-type","text/event-stream")], format!("data: {}\n\ndata: {}\n\n", serde_json::json!({"type":"response.output_item.done","output_index":0,"item":item}),serde_json::json!({"type":"response.completed","response":response}))).into_response()
                } else {
                    Json(response).into_response()
                }
            }
        }
    };
    let provider = Provider(Some(tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/responses", axum::routing::post(handler)),
        )
        .await
        .unwrap();
    })));
    let path = root.join("store.db");
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = crate::router(manager.clone());
    let project = post(
        app.clone(),
        "/projects",
        serde_json::json!({"name":"semantic G2","cwd":root.clone()}),
    )
    .await;
    let created = post(app.clone(), "/sessions", serde_json::json!({"behavior":behavior,"project_id":project["project_id"],"model":"gpt-5.6-sol","backend":"openai-responses","base_url":base,"api_key_env":"OPENAI_API_KEY"})).await;
    let id = created["metadata"]["session_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(created["metadata"]["behavior"], behavior);
    let service = manager.attach_session(&id).await.unwrap();
    let mut feed = open(app.clone(), "new").await;
    let cutoff = frame(&mut feed, "cutoff").await;
    assert_eq!(cutoff["kind"], "completions");
    assert_eq!(cutoff["page"]["baseline"], true);
    assert!(cutoff["page"]["items"].as_array().unwrap().is_empty());
    let baseline = frame(&mut feed, "baseline").await;
    assert_eq!(baseline["kind"], "baseline");
    let a = post(
        app.clone(),
        &format!("/sessions/{id}/runs"),
        serde_json::json!({"prompt":"semantic A"}),
    )
    .await;
    let a = a["run_id"].as_str().unwrap().to_owned();
    tokio::time::timeout(Duration::from_secs(5), entered_a.notified())
        .await
        .unwrap();
    let barrier = service.hold_attention_publication_for_test(&a).unwrap();
    release_a.notify_one();
    let selection = barrier.arrived().await.unwrap();
    match (behavior, &selection) {
        ("direct", AttentionPublicationSelection::Idle { goal, last_run }) => {
            assert!(goal.is_none());
            assert_eq!(last_run.as_deref(), Some(a.as_str()));
        }
        ("direct-with-orchestrator", AttentionPublicationSelection::IdleUnverified) => {
            assert_eq!(
                baseline["sources"][0]["availability"]["questions"],
                "unsupported"
            );
        }
        _ => panic!("unexpected actual continuation selection for {behavior}: {selection:?}"),
    }
    eprintln!(
        "semantic-g2-cutpoint {}",
        serde_json::json!({"behavior":behavior,"session":id,"run_a":a,"actual_selection":format!("{selection:?}")})
    );
    assert!(
        service.active_run().is_none(),
        "cutpoint must be AFTER actual selection and local active-run release"
    );
    let after = store::CompletionCursor {
        store: cutoff["page"]["store_id"].as_str().unwrap().into(),
        sequence: cutoff["page"]["cursor"].as_i64().unwrap(),
    };
    canonical_a(
        &manager,
        &path,
        &after,
        &a,
        &id,
        behavior,
        "selected-before-B",
    )
    .await;
    let b = post(
        app.clone(),
        &format!("/sessions/{id}/runs"),
        serde_json::json!({"prompt":"semantic B"}),
    )
    .await;
    let b = b["run_id"].as_str().unwrap().to_owned();
    assert_ne!(a, b);
    tokio::time::timeout(Duration::from_secs(5), entered_b.notified())
        .await
        .unwrap();
    assert_eq!(service.active_run().unwrap().run_id.as_str(), b);
    barrier.release();
    barrier.publication_attempted().await.unwrap();
    canonical_a(
        &manager,
        &path,
        &after,
        &a,
        &id,
        behavior,
        "B-active-after-A-publication-attempt",
    )
    .await;
    let mut seen = std::collections::BTreeSet::new();
    let first = completion(&mut feed, &a, &a, &mut seen).await;
    assert_eq!(
        service.active_run().unwrap().run_id.as_str(),
        b,
        "semantic A observed while B is active"
    );
    assert_eq!(first["item"]["session_id"], id);
    assert_eq!(first["item"]["behavior"], behavior);
    assert_eq!(first["item"]["kind"], "request");
    assert!(first["item"]["goal_id"].is_null());
    assert!(first["item"]["mark_version"].is_null());
    // Keep the original sole stream past an actual empty canonical read before
    // the real B provider finishes. This is a timing gate, never a seeded page.
    let (resume_wait, receive_wait) = tokio::sync::oneshot::channel();
    let waiting = Arc::new(HistoryWaitGate {
        reached: Notify::new(),
        resume: Mutex::new(Some(receive_wait)),
    });
    manager.inner.attention.0.lock().unwrap().history_wait_gate = Some(waiting.clone());
    let release_when_waiting = async {
        tokio::time::timeout(Duration::from_secs(5), waiting.reached.notified())
            .await
            .unwrap();
        eprintln!(
            "semantic-g2-wait-entry {}",
            serde_json::json!({"behavior":behavior,"run_b":b})
        );
        resume_wait.send(()).unwrap();
        release_b.notify_one();
    };
    let (_, second) = tokio::join!(
        release_when_waiting,
        completion(&mut feed, &b, &a, &mut seen)
    );
    for item in [&first["item"], &second["item"]] {
        assert_eq!(item["session_id"], id);
        assert_eq!(item["behavior"], behavior);
        assert_eq!(item["kind"], "request");
        assert!(item["goal_id"].is_null() && item["mark_version"].is_null());
    }
    assert_eq!(first["page"]["store_id"], cutoff["page"]["store_id"]);
    assert_eq!(second["page"]["store_id"], cutoff["page"]["store_id"]);
    assert!(
        second["item"]["sequence"].as_i64().unwrap() > first["item"]["sequence"].as_i64().unwrap()
    );
    let cursor = format!(
        "{}:{}",
        cutoff["page"]["store_id"].as_str().unwrap(),
        cutoff["page"]["cursor"].as_i64().unwrap()
    );
    retire_feed(&manager, feed).await.unwrap();
    let mut replay = open(app.clone(), &cursor).await;
    let page = frame(&mut replay, "replay").await;
    assert_eq!(page["kind"], "completions");
    let items = page["page"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0], first["item"]);
    assert_eq!(items[1], second["item"]);
    let canonical = store::read_completion_page(&path, None).unwrap();
    assert_eq!(canonical.cursor.sequence, 2);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    eprintln!(
        "semantic-g2-evidence {}",
        serde_json::json!({
            "behavior":behavior,"session":id,"run_a":a,"run_b":b,
            "actual_selection":format!("{selection:?}"),
            "silent_cutoff":cutoff["page"],"semantic_a_while_b_active":first,
            "semantic_b":second,"replayed":items,"model_posts":calls.load(Ordering::SeqCst)
        })
    );
    retire_feed(&manager, replay).await.unwrap();
    let service_active_after_replay = service.has_active_operation();
    // Close admission and fence the continuation caller before its store retires.
    tokio::time::timeout(Duration::from_secs(5), async {
        service.stop_run_admission().await.unwrap();
        assert!(service
            .start_next_direct_inbox_item()
            .await
            .unwrap()
            .is_none());
    })
    .await
    .unwrap();
    drop(barrier);
    drop(service);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    let physical_seat_after_drain = manager.inner.attention.0.lock().unwrap().seat.is_some();
    drop(manager);
    provider.stop().await;
    remove_semantic_root(
        &root,
        serde_json::json!({
            "behavior":behavior,"session":id,"run_a":a,"run_b":b,
            "original_feed_retirement_returned":true,"replay_feed_retirement_returned":true,
            "service_active_after_replay":service_active_after_replay,
            "stopped_wake_fence_returned":true,
            "quiesce_returned":true,"typed_drain_acknowledged":true,
            "physical_seat_after_drain":physical_seat_after_drain,
            "provider_listener_abort_join_returned":true,
            "original_run_task_join":"not observed by this fixture",
        }),
    )
    .unwrap();
}
async fn canonical_a(
    manager: &SessionManager,
    path: &std::path::Path,
    after: &store::CompletionCursor,
    run: &str,
    session: &str,
    behavior: &str,
    stage: &str,
) {
    let path = path.to_owned();
    let after = after.clone();
    let page = manager
        .inner
        ._store_ownership
        .call_legacy(move || store::read_completion_page(&path, Some(&after)))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        page.items.len(),
        1,
        "canonical A missing at {stage}: {page:?}"
    );
    let item = serde_json::to_value(&page.items[0]).unwrap();
    assert_eq!(item["run_id"], run);
    assert_eq!(item["session_id"], session);
    assert_eq!(item["behavior"], behavior);
    assert_eq!(item["kind"], "request");
    let live = manager
        .inner
        .attention
        .0
        .lock()
        .unwrap()
        .live
        .upgrade()
        .unwrap();
    let boundary = live.hub.boundary();
    let (questions_supported, current_completed_a) = {
        let state = live.state.lock().unwrap();
        let source = state.sources.get(session).unwrap();
        let completed = source
            .service
            .as_ref()
            .unwrap()
            .settled
            .as_ref()
            .is_some_and(|work| {
                work.run_id == run
                    && work.disposition == nac_core::events::SettledWorkDisposition::Completed
            });
        (
            source.stored.as_ref().unwrap().questions_supported,
            completed,
        )
    };
    if behavior == "direct-with-orchestrator" {
        assert!(!questions_supported);
        assert!(
            !current_completed_a,
            "DWO must not invent a current Completed(A)"
        );
    }
    eprintln!(
        "semantic-g2-canonical {}",
        serde_json::json!({
            "stage":stage,"page":page,"questions_supported":questions_supported,
            "current_completed_a":current_completed_a,"current_boundary":{
                "engine":boundary.engine.to_string(),"epoch":boundary.epoch.to_string(),
                "sequence":boundary.sequence,
            },
        })
    );
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn semantic_g2_real_http_direct_idle_before_publish_keeps_exact_a_during_b_and_replays() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    interleave("direct").await;
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn semantic_g2_real_http_dwo_idle_unverified_before_publication_attempt_keeps_exact_a_during_b_and_replays(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    interleave("direct-with-orchestrator").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn semantic_fixture_teardown_waits_for_accepted_read_after_sqlite_returns() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-semantic-retirement-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    store::initialize(&root.join("store.db")).unwrap();
    let manager = SessionManager::new_async(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    manager
        .inner
        .attention
        .configure_native(Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = crate::router(manager.clone());
    let mut feed = open(app.clone(), "new").await;
    assert_eq!(
        frame(&mut feed, "retirement-cutoff").await["kind"],
        "completions"
    );
    assert_eq!(
        frame(&mut feed, "retirement-baseline").await["kind"],
        "baseline"
    );
    let (release, receive) = std::sync::mpsc::channel();
    let gate = Arc::new(ReadGate {
        reached: Notify::new(),
        release: Mutex::new(receive),
    });
    manager.inner.attention.0.lock().unwrap().after_read_gate = Some(gate.clone());
    // A dirty hint causes a real accepted metadata read, without seeding a result.
    manager.inner.attention.deleted("retirement-only");
    let reached = tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .is_ok();
    // The gate runs after SQLite returns, outside the typed executor. This
    // reproduces why executor drain alone is not a caller-retirement receipt.
    let drained = tokio::time::timeout(Duration::from_secs(5), async {
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await
    })
    .await;
    let mut retiring = Box::pin(retire_feed(&manager, feed));
    let first_poll = std::future::poll_fn(|cx| {
        std::task::Poll::Ready(std::future::Future::poll(retiring.as_mut(), cx))
    })
    .await;
    let pending = first_poll.is_pending();
    // Release and settle the original caller before reporting the oracle.
    // Keep this independent fence so a mutant removing retire_feed's wait
    // still performs real cleanup before its semantic assertion fails.
    let released = release.send(());
    let retired = match first_poll {
        std::task::Poll::Pending => retiring.await,
        std::task::Poll::Ready(result) => {
            drop(retiring);
            result
        }
    };
    tokio::time::timeout(Duration::from_secs(5), async {
        while manager.inner.attention.0.lock().unwrap().seat.is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    drained.unwrap().unwrap();
    drop(app);
    drop(manager);
    std::fs::remove_dir_all(&root).unwrap();
    assert!(!root.exists());
    assert!(reached, "accepted read never reached its after-SQLite gate");
    released.unwrap();
    retired.unwrap();
    assert!(
        pending,
        "SEMANTIC_TEARDOWN_RETURNED_BEFORE_ACCEPTED_READ_RETIRED"
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn semantic_cleanup_census_is_bounded_and_does_not_follow_replaced_roots_or_children() {
    use std::os::unix::{ffi::OsStringExt, fs::symlink};
    let root = std::env::temp_dir().join(format!("nac-semantic-census-{}", Uuid::new_v4()));
    let inside = root.join("inside");
    let outside = root.join("outside");
    std::fs::create_dir_all(inside.join("nested")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(inside.join("nested/owned"), "fixture").unwrap();
    std::fs::write(
        outside.join("OUTSIDE_MUST_NOT_BE_ENUMERATED"),
        "private fixture canary",
    )
    .unwrap();
    symlink(&outside, inside.join("child-link")).unwrap();
    let malformed = std::fs::write(
        inside.join(std::ffi::OsString::from_vec(vec![0xff])),
        "non-UTF8 filename",
    );
    #[cfg(target_os = "linux")]
    malformed.unwrap();
    // Darwin rejects this filename before it reaches directory enumeration.
    #[cfg(target_os = "macos")]
    assert_eq!(malformed.unwrap_err().raw_os_error(), Some(libc::EILSEQ));
    let original = cleanup_directory(&inside).unwrap();
    // The original open handle must retain its directory when the path itself
    // is replaced by a link. Discovered child links are metadata-only as well.
    std::fs::rename(&inside, root.join("original")).unwrap();
    symlink(&outside, &inside).unwrap();
    assert!(cleanup_directory(&inside).is_err());
    let census = cleanup_census(original);
    let text = census.to_string();
    assert!(text.contains("nested/owned"), "{census}");
    assert!(
        text.contains("child-link") && text.contains("symlink"),
        "{census}"
    );
    assert!(!text.contains("OUTSIDE_MUST_NOT_BE_ENUMERATED"), "{census}");
    assert!(!text.contains("private fixture canary"), "{census}");
    #[cfg(target_os = "linux")]
    assert!(
        text.contains('\u{fffd}'),
        "non-UTF8 names must not panic: {census}"
    );
    for i in 0..40 {
        std::fs::write(root.join("original").join(format!("entry-{i}")), "").unwrap();
    }
    let bounded = cleanup_census(cleanup_directory(&root.join("original")).unwrap());
    assert!(bounded["entries"].as_array().unwrap().len() <= 32);
    assert_eq!(bounded["truncated"], true);
    std::fs::create_dir_all(outside.join("a/b/c/d")).unwrap();
    let depth = cleanup_census(cleanup_directory(&outside).unwrap());
    assert_eq!(depth["truncated"], true);
    assert!(!depth.to_string().contains("a/b/c/d"));
    std::fs::remove_dir_all(root).unwrap();
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn semantic_cleanup_reports_original_failure_and_retains_failed_path() {
    let root = std::env::temp_dir().join(format!("nac-semantic-removal-error-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("not-a-directory");
    std::fs::write(&file, "fixture must remain").unwrap();
    let error =
        remove_semantic_root(&file, serde_json::json!({"control":"original failure"})).unwrap_err();
    assert_eq!(error.raw_os_error(), Some(libc::ENOTDIR));
    let report = cleanup_failure(
        &file,
        &error,
        serde_json::json!({"control":"original failure"}),
    );
    assert_eq!(report["raw_os_error"], libc::ENOTDIR);
    assert_eq!(report["error"], error.to_string());
    assert_eq!(report["receipts"]["control"], "original failure");
    assert_eq!(
        report["remaining_owned_entries"]["stage"],
        "open_root_nofollow"
    );
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "fixture must remain"
    );
    std::fs::remove_dir_all(root).unwrap();
}
