//! Offline provider for direct primaries and their traditional children.
use super::*;

pub(super) struct DirectModel {
    pub(super) base_url: String,
    pub(super) primary_gate: Arc<PhaseGate>,
    pub(super) child_gate: Arc<PhaseGate>,
    pub(super) completion_gate: Arc<CompletionGate>,
    pub(super) concurrent_completions: Arc<PhaseGate>,
    requests: Arc<Mutex<Vec<ModelRequest>>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl DirectModel {
    pub(super) fn start(
        seed: u64,
        count: usize,
        ordered: bool,
        command: Option<String>,
        allow_child_disconnect: bool,
    ) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let primary_gate = Arc::new(PhaseGate::new(count));
        let child_gate = Arc::new(PhaseGate::new(count));
        let completion_gate = Arc::new(CompletionGate::new(ordered));
        let concurrent_completions = Arc::new(PhaseGate::new(count));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (primary, child, completion, concurrent, log, stopped) = (
            Arc::clone(&primary_gate),
            Arc::clone(&child_gate),
            Arc::clone(&completion_gate),
            Arc::clone(&concurrent_completions),
            Arc::clone(&requests),
            Arc::clone(&stop),
        );
        let handle = thread::spawn(move || {
            let mut handlers = Vec::new();
            while !stopped.load(std::sync::atomic::Ordering::SeqCst) {
                let (stream, _) = match listener.accept() {
                    Ok(accepted) => accepted,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1));
                        continue;
                    }
                    Err(error) => panic!("accept direct model request: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                let (primary, child, completion, concurrent, log) = (
                    Arc::clone(&primary),
                    Arc::clone(&child),
                    Arc::clone(&completion),
                    Arc::clone(&concurrent),
                    Arc::clone(&log),
                );
                let command = command.clone();
                handlers.push(thread::spawn(move || {
                    handle_request(
                        stream,
                        seed,
                        count,
                        ordered,
                        command.as_deref(),
                        allow_child_disconnect,
                        &primary,
                        &child,
                        &completion,
                        &concurrent,
                        &log,
                    );
                }));
            }
            for handler in handlers {
                handler.join().unwrap();
            }
        });
        Self {
            base_url,
            primary_gate,
            child_gate,
            completion_gate,
            concurrent_completions,
            requests,
            stop,
            handle: Some(handle),
        }
    }

    pub(super) async fn wait_for_primaries(&self) {
        let gate = Arc::clone(&self.primary_gate);
        tokio::task::spawn_blocking(move || gate.wait_until_ready("direct primaries"))
            .await
            .unwrap();
    }

    pub(super) async fn wait_for_children(&self) {
        let gate = Arc::clone(&self.child_gate);
        tokio::task::spawn_blocking(move || gate.wait_until_ready("traditional children"))
            .await
            .unwrap();
    }

    pub(super) async fn wait_for_concurrent_completions(&self) -> usize {
        let gate = Arc::clone(&self.concurrent_completions);
        tokio::task::spawn_blocking(move || {
            gate.wait_until_ready("concurrent completions");
            let arrived = gate.state.lock().unwrap().arrived;
            arrived
        })
        .await
        .unwrap()
    }

    pub(super) fn observed_overlap(&self) -> (usize, usize) {
        (
            self.primary_gate.state.lock().unwrap().arrived,
            self.child_gate.state.lock().unwrap().arrived,
        )
    }

    pub(super) fn finish(mut self) -> Vec<ModelRequest> {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        self.handle.take().unwrap().join().unwrap();
        let requests = self.requests.lock().unwrap().clone();
        requests
    }
}

impl Drop for DirectModel {
    fn drop(&mut self) {
        self.primary_gate.release();
        self.child_gate.release();
        self.completion_gate.release_all();
        self.concurrent_completions.release();
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn handle_request(
    mut stream: TcpStream,
    seed: u64,
    count: usize,
    ordered: bool,
    command: Option<&str>,
    allow_child_disconnect: bool,
    primary_gate: &PhaseGate,
    child_gate: &PhaseGate,
    completion_gate: &CompletionGate,
    concurrent_completions: &PhaseGate,
    requests: &Mutex<Vec<ModelRequest>>,
) {
    let body = read_http_body(&mut stream);
    let request: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let input = request["input"].to_string();
    let primary = request["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tool| tool["name"] == "subagent");
    let tool_result = request["input"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["type"] == "function_call_output");
    let ordinal = (0..count).find(|ordinal| {
        input.contains(&format!(
            "ALL612:{}:{seed:08x}:{ordinal}",
            if primary { "PRIMARY" } else { "CHILD" }
        ))
    });
    let (phase, response) = if primary && !tool_result && !input.contains("ALL612_CHILD_COMPLETE") {
        let ordinal = ordinal.expect("primary request identity");
        primary_gate.arrive_and_wait("direct primary");
        ("primary", tool_response(&format!("direct-child-{ordinal}"), "subagent", &serde_json::json!({
            "profile":"general", "description":format!("load child {ordinal}"),
            "child_session_id":null, "background":true,
            "prompt":format!("ALL612:CHILD:{seed:08x}:{ordinal}: execute the scripted native command"),
        }).to_string()))
    } else if primary {
        for item in request["input"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["type"] == "function_call_output")
        {
            let output = item["output"].to_string();
            assert!(
                !output.contains("Error:"),
                "scripted subagent invocation failed"
            );
        }
        (
            "primary-continuation",
            text_response("ALL612_PRIMARY_COMPLETE"),
        )
    } else if !tool_result {
        let ordinal = ordinal.expect("child request identity");
        child_gate.arrive_and_wait("traditional child");
        (
            "child",
            tool_response(
                &format!("direct-command-{ordinal}"),
                "exec_command",
                &serde_json::json!({
                "cmd":command.unwrap_or("printf ALL612_NATIVE_COMMAND_COMPLETE"), "yield_time_ms":if command.is_some() { 30_000 } else { 1000 },
                })
                .to_string(),
            ),
        )
    } else {
        completion_gate.wait_for_turn(ordinal.expect("child completion identity"));
        if !ordered {
            concurrent_completions.arrive_and_wait("concurrent completions");
        }
        assert!(
            input.contains("ALL612_NATIVE_COMMAND_COMPLETE"),
            "native command output missing from child transcript"
        );
        ("child-continuation", text_response("ALL612_CHILD_COMPLETE"))
    };
    requests
        .lock()
        .unwrap()
        .push(ModelRequest { phase, ordinal });
    let result = write_http_json(&mut stream, &response);
    if let Err(error) = result {
        assert!(
            allow_child_disconnect
                && phase == "child"
                && matches!(
                    error.kind(),
                    std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                ),
            "unexpected model response write failure: {error}"
        );
    }
}
