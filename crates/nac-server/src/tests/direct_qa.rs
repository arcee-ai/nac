//! Scripted choreography qualification, not a live QA pass or model evaluation.
use super::*;
use axum::response::IntoResponse;
use axum::{extract::State, routing::post, Json};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};

const SKILL: &str = include_str!("../../../../.agents/skills/qa/SKILL.md");
const ADAPTER: &str = include_str!("../../../../.agents/skills/qa/references/direct.md");

// HOME isolation must not alter concurrently running tests in the parent
// binary. Keep each native direct journey inside its own test subprocess.
fn run_isolated(name: &str) -> bool {
    let name = format!("tests::direct_qa::{name}");
    if std::env::var("NAC_DIRECT_QA_CHILD").as_deref() == Ok(name.as_str()) {
        return false;
    }
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([name.as_str(), "--exact", "--nocapture"])
        .env("NAC_DIRECT_QA_CHILD", &name)
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    print!("{stdout}");
    assert!(
        output.status.success(),
        "{name}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(stdout.contains("1 passed;") && stdout.contains(&name));
    true
}

struct Model {
    root: std::path::PathBuf,
    sha: String,
    case: &'static str,
    parent_step: AtomicUsize,
    workers: AtomicUsize,
    arrived: tokio::sync::Barrier,
    requests: std::sync::Mutex<Vec<Value>>,
}

impl Model {
    fn pass(&self) -> std::path::PathBuf {
        self.root.join(".nac/qa/fixture")
    }

    fn contract(&self, slot: usize) -> String {
        format!(
            "mode=worker\nrepo_root={}\npass_root={}\nslot={slot}\nsource_sha={}\nbinary={}/bin/nac-web\nscope=fixture axis {slot}\nreport={}/reports/{slot}.md\nevidence={}/evidence/{slot}\ncaller_context=bounded choreography fixture; no SUT\npodman_mode=unavailable\n",
            self.root.display(), self.pass().display(), self.sha,
            self.pass().display(), self.pass().display(), self.pass().display()
        )
    }

    fn dispatch(&self, label: &str, inputs: String) -> Value {
        call(
            label,
            "subagent",
            json!({
                "profile":"general", "description":label, "child_session_id":null,
                "background":false,
            "prompt":format!("{SKILL}\n{ADAPTER}\nCHOREOGRAPHY FIXTURE ONLY: do not build or launch a SUT.\nfixture_role={label}\n{inputs}")
            }),
        )
    }

    fn write(&self, id: &str, path: &str, content: String) -> Value {
        call(
            id,
            "write",
            json!({
                "path":self.pass().join(path), "content":content, "expected_revision":null
            }),
        )
    }

    fn report(&self, slot: usize, status: &str) -> String {
        format!("# QA slot {slot}\nStatus: {status}\nInfrastructure: {}\nSource: {}\nScope: fixture axis {slot}\n\nChoreography fixture only; live SUT and rootless Podman untested.\n", if status == "infra" { "failed" } else { "clean" }, self.sha)
    }
}

fn call(id: &str, name: &str, arguments: Value) -> Value {
    json!({"type":"function_call", "call_id":id, "name":name, "arguments":arguments.to_string()})
}

fn text_output(text: String) -> Value {
    json!({"type":"message", "content":[{"type":"output_text", "text":text}]})
}

fn retained_messages(root: &std::path::Path, session: &str) -> Vec<Message> {
    let store = root.join("store.db");
    let mut messages = sessions::load_session(&store, session).unwrap().messages;
    let tail = nac_core::store::TranscriptLogWriter::new(&store)
        .unwrap()
        .read_tail_from(session, messages.len() as u64)
        .unwrap();
    messages.extend(tail.into_iter().map(|(_, message)| message));
    messages
}

async fn respond(State(model): State<Arc<Model>>, Json(request): Json<Value>) -> Response {
    model.requests.lock().unwrap().push(request.clone());
    let parent = request["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|tool| tool["name"] == "subagent");
    let input = request["input"].as_array().unwrap();
    let serialized = request["input"].to_string();
    let tool_result = input
        .iter()
        .any(|item| item["type"] == "function_call_output");
    let output = if parent {
        match model.parent_step.fetch_add(1, Ordering::SeqCst) {
            0 => vec![model.dispatch("QA setup", "mode=setup\nn=2".into())],
            1 if model.case == "missing-podman" => vec![text_output(
                "infra: rootless Podman unavailable; no test wave dispatched".into(),
            )],
            1 => vec![
                model.dispatch("QA slot 1", model.contract(1)),
                model.dispatch("QA slot 2", model.contract(2)),
            ],
            2 => {
                // Pass actual structured native outcomes, including cancellation,
                // to the aggregate, rather than inventing successful episodes.
                let outcomes = input
                    .iter()
                    .filter(|item| item["type"] == "function_call_output")
                    .cloned()
                    .collect::<Vec<_>>();
                vec![model.dispatch("QA aggregate", format!("mode=aggregate\nrepo_root={}\npass_root={}\nsource_sha={}\nn=2\n{}{}\nOutcomes: {}", model.root.display(), model.pass().display(), model.sha, model.contract(1), model.contract(2), json!(outcomes)))]
            }
            3 => vec![text_output(
                "fixture aggregate retained; live QA unqualified".into(),
            )],
            step => panic!("unexpected parent request {step}"),
        }
    } else if serialized.contains("fixture_role=QA setup") {
        if model.case == "missing-podman" {
            vec![text_output("infra: podman info rootless probe failed: fixture engine unavailable; no RUN.json or assignments".into())]
        } else if tool_result {
            vec![text_output(format!(
                "repo_root={}\npass_root={}\nsource_sha={}\nn=2\n{}{}",
                model.root.display(),
                model.pass().display(),
                model.sha,
                model.contract(1),
                model.contract(2)
            ))]
        } else {
            vec![model.write("run", "RUN.json", json!({"fixture":true,"repo_root":model.root,"source_sha":model.sha,"n":2,"assignments":[model.contract(1),model.contract(2)]}).to_string())]
        }
    } else if serialized.contains("fixture_role=QA aggregate") {
        if tool_result {
            vec![text_output(
                "SUMMARY.md retained; two slots accounted; no live QA claim".into(),
            )]
        } else {
            let infra = matches!(model.case, "cancelled" | "failed");
            let mut writes = vec![model.write("summary", "SUMMARY.md", format!("Source: {}\nFixture only\nrequested=2 terminal=2 completed={} cancelled={} failed={}\npass=1 finding={} infra={}\nCoverage gap: rootless Podman and live SUT not exercised\nCleanup: no SUT resources created\nReports: reports/1.md reports/2.md\n", model.sha, if infra { 1 } else { 2 }, usize::from(model.case == "cancelled"), usize::from(model.case == "failed"), usize::from(model.case == "finding"), usize::from(infra)))];
            if infra {
                writes.push(model.write("stub", "reports/2.md", model.report(2, "infra")));
            }
            writes
        }
    } else {
        let slot = if serialized.contains("fixture_role=QA slot 1") {
            1
        } else {
            2
        };
        if tool_result {
            vec![text_output(
                model.report(slot, if slot == 2 { "finding" } else { "pass" }),
            )]
        } else {
            // Both native children must reach the provider before either can
            // finish: sequential dispatch would time out this fixture.
            model.workers.fetch_add(1, Ordering::SeqCst);
            model.arrived.wait().await;
            if slot == 2 && model.case == "failed" {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error":{"message":"fixture worker failure"}})),
                )
                    .into_response();
            }
            if slot == 2 && model.case == "cancelled" {
                std::future::pending::<()>().await;
            }
            vec![model.write(
                "report",
                &format!("reports/{slot}.md"),
                model.report(slot, if slot == 2 { "finding" } else { "pass" }),
            )]
        }
    };
    Json(
        json!({"status":"completed", "output":output, "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}),
    ).into_response()
}

async fn fixture(case: &'static str) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root(&format!("direct_qa_{case}"));
    let root = root.canonicalize().unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::with_config_home(
        Some(&home),
        Some(&root.join("xdg")),
        Some(&root.join("home")),
        Some("fixture-only"),
    );
    let project = root.join("project");
    std::fs::create_dir_all(project.join(".agents/skills/qa/references")).unwrap();
    std::fs::write(project.join(".agents/skills/qa/SKILL.md"), SKILL).unwrap();
    std::fs::write(
        project.join(".agents/skills/qa/references/direct.md"),
        ADAPTER,
    )
    .unwrap();
    std::fs::write(project.join(".gitignore"), ".nac/\n").unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["add", "."],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
    ] {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(&project)
            .status()
            .unwrap()
            .success());
    }
    let sha = String::from_utf8(
        std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&project)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    let model = Arc::new(Model {
        root: project.clone(),
        sha,
        case,
        parent_step: AtomicUsize::new(0),
        workers: AtomicUsize::new(0),
        arrived: tokio::sync::Barrier::new(2),
        requests: std::sync::Mutex::new(vec![]),
    });
    for path in ["reports", "evidence/1", "evidence/2"] {
        std::fs::create_dir_all(model.pass().join(path)).unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new()
        .route("/responses", post(respond))
        .with_state(model.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut snapshot = sessions::new_snapshot(
        "direct".into(),
        project.clone(),
        "model-a".into(),
        url,
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![],
        Some("OPENAI_API_KEY".into()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
    let manager = test_manager(&root);
    manager
        .submit_prompt(
            "direct",
            SubmitPromptRequest {
                prompt: "Use $qa with n=2; bounded choreography fixture only.".into(),
            },
            nac_core::store::InputOrigin::Automation,
        )
        .await
        .unwrap();

    tokio::time::timeout(Duration::from_secs(30), async {
        let mut cancelled = false;
        loop {
            let children =
                nac_core::store::list_traditional_children(&root.join("store.db"), "direct")
                    .unwrap();
            if case == "cancelled" && !cancelled && model.workers.load(Ordering::SeqCst) == 2 {
                let child = children
                    .iter()
                    .find(|child| child.description == "QA slot 2")
                    .unwrap();
                nac_core::traditional_children::controller_for(&root.join("store.db"))
                    .unwrap()
                    .cancel("direct", &child.child_session_id, child.generation)
                    .await
                    .unwrap();
                cancelled = true;
            }
            if model.parent_step.load(Ordering::SeqCst)
                == if case == "missing-podman" { 2 } else { 4 }
                && manager
                    .attach_session("direct")
                    .await
                    .unwrap()
                    .active_run()
                    .is_none()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("parallel direct QA fixture should finish");

    let children =
        nac_core::store::list_traditional_children(&root.join("store.db"), "direct").unwrap();
    assert_eq!(children.len(), if case == "missing-podman" { 1 } else { 4 });
    if matches!(case, "cancelled" | "failed") {
        let worker = children
            .iter()
            .find(|child| child.description == "QA slot 2")
            .unwrap();
        assert_eq!(
            worker.status,
            if case == "cancelled" {
                nac_core::store::TraditionalChildStatus::Cancelled
            } else {
                nac_core::store::TraditionalChildStatus::Failed
            }
        );
        let aggregate = children
            .iter()
            .find(|child| child.description == "QA aggregate")
            .unwrap();
        let messages = retained_messages(&root, &aggregate.child_session_id);
        assert!(messages.iter().any(|message| matches!(message, Message::User { content } if content.contains(&worker.child_session_id) && content.contains(case))));
    }
    assert_eq!(
        sessions::list_sessions(&root.join("store.db"))
            .unwrap()
            .len(),
        children.len() + 1,
        "no visible independent tasks or recursive children"
    );
    for child in &children {
        let snapshot =
            sessions::load_session(&root.join("store.db"), &child.child_session_id).unwrap();
        assert_eq!(snapshot.behavior, sessions::SessionBehavior::Direct);
        assert_eq!(snapshot.cwd, project);
        assert!(child.status.is_terminal());
        assert!(child.report.is_some() || child.failure.is_some());
        assert!(nac_core::store::list_traditional_children(
            &root.join("store.db"),
            &child.child_session_id
        )
        .unwrap()
        .is_empty());
    }
    let requests = model.requests.lock().unwrap();
    assert!(
        requests.first().unwrap()["input"]
            .to_string()
            .contains("NAC quality assurance"),
        "the parent must actually load and expand $qa"
    );
    // Relationship timestamps have second precision; prove phase order from
    // observed provider traffic, never UUID ordering within a timestamp tie.
    let phase_indices = |phase: &str| {
        requests
            .iter()
            .enumerate()
            .filter_map(|(index, request)| {
                let parent = request["tools"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|tool| tool["name"] == "subagent");
                (!parent
                    && request["input"]
                        .to_string()
                        .contains(&format!("fixture_role={phase}")))
                .then_some(index)
            })
            .collect::<Vec<_>>()
    };
    if case != "missing-podman" {
        let setup = phase_indices("QA setup");
        let aggregate = phase_indices("QA aggregate");
        for slot in 1..=2 {
            let worker = phase_indices(&format!("QA slot {slot}"));
            assert!(setup.last().unwrap() < worker.first().unwrap());
            assert!(worker.last().unwrap() < aggregate.first().unwrap());
        }
    }
    for request in requests.iter().filter(|request| {
        !request["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|tool| tool["name"] == "subagent")
    }) {
        let tools = request["tools"].as_array().unwrap();
        for forbidden in [
            "subagent",
            "create_goal",
            "orchestrator_launch",
            "orchestrator_status",
            "orchestrator_steer",
            "orchestrator_read",
            "orchestrator_wait",
            "orchestrator_cancel",
        ] {
            assert!(!tools.iter().any(|tool| tool["name"] == forbidden));
        }
    }
    if case == "missing-podman" {
        assert!(!model.pass().join("RUN.json").exists());
        assert_eq!(model.workers.load(Ordering::SeqCst), 0);
    } else {
        let run = std::fs::read_to_string(model.pass().join("RUN.json")).unwrap();
        let run: Value = serde_json::from_str(&run).unwrap();
        for slot in 1..=2 {
            assert_eq!(run["assignments"][slot - 1], model.contract(slot));
            let child = children
                .iter()
                .find(|child| child.description == format!("QA slot {slot}"))
                .unwrap();
            let messages = retained_messages(&root, &child.child_session_id);
            assert!(messages.iter().any(|message| matches!(message, Message::User { content, .. } if content.contains(&model.contract(slot)))));
            assert!(
                std::fs::read_to_string(model.pass().join(format!("reports/{slot}.md")))
                    .unwrap()
                    .contains(&model.sha)
            );
        }
        let summary = std::fs::read_to_string(model.pass().join("SUMMARY.md")).unwrap();
        assert!(summary.contains(if case == "finding" {
            "pass=1 finding=1 infra=0"
        } else {
            "pass=1 finding=0 infra=1"
        }));
        assert_eq!(model.workers.load(Ordering::SeqCst), 2);
    }
    // Opt-in durable evidence copies remain fixture-labelled, never QA reports
    // purporting to have exercised a real nac-web/Podman SUT.
    if let Some(destination) = std::env::var_os("NAC_QA_FIXTURE_EVIDENCE") {
        let destination = std::path::PathBuf::from(destination).join(case);
        std::fs::create_dir_all(destination.join("reports")).unwrap();
        std::fs::write(
            destination.join("requests.json"),
            serde_json::to_vec_pretty(&*requests).unwrap(),
        )
        .unwrap();
        std::fs::write(
            destination.join("children.json"),
            serde_json::to_vec_pretty(&children).unwrap(),
        )
        .unwrap();
        for path in ["RUN.json", "SUMMARY.md", "reports/1.md", "reports/2.md"] {
            if model.pass().join(path).exists() {
                std::fs::copy(model.pass().join(path), destination.join(path)).unwrap();
            }
        }
    }
    drop(requests);
    let git = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project)
        .output()
        .unwrap();
    assert!(git.status.success());
    assert!(git.stdout.is_empty(), "fixture source must remain clean");
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn direct_qa_parallel_assignments_and_finding_are_retained() {
    if run_isolated("direct_qa_parallel_assignments_and_finding_are_retained") {
        return;
    }
    fixture("finding").await;
}

#[tokio::test]
async fn direct_qa_cancelled_slot_is_aggregated_without_replacement() {
    if run_isolated("direct_qa_cancelled_slot_is_aggregated_without_replacement") {
        return;
    }
    fixture("cancelled").await;
}

#[tokio::test]
async fn direct_qa_missing_podman_stops_before_dispatch() {
    if run_isolated("direct_qa_missing_podman_stops_before_dispatch") {
        return;
    }
    fixture("missing-podman").await;
}

#[tokio::test]
async fn direct_qa_failed_slot_is_aggregated_without_replacement() {
    if run_isolated("direct_qa_failed_slot_is_aggregated_without_replacement") {
        return;
    }
    fixture("failed").await;
}
