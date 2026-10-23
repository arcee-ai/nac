//! Local direct qualification, with no user installation or external service.
use super::*;
use crate::commands::{prepare_user_input, PreparedUserInput};
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::permissions::{PermissionEffect, PermissionRule};
use crate::runtime::{
    build_run_config_for_project_with_behavior, ModelOptions, NacConfig, OptionalModelOption,
    OrchestratorRunConfig, RunOptions, StoreOptions,
};
use crate::sessions::SessionBehavior;
use crate::types::Message;
use serde_json::json;
use std::ffi::OsString;
use std::os::unix::fs::symlink;

mod sources;

/// HOME/NAC_HOME isolation must not change the environment inherited by
/// unrelated process tests running concurrently in the parent test binary.
fn run_in_subprocess(name: &str, ignored: bool) -> bool {
    let selected = format!("skills::qualification::{name}");
    if std::env::var("NAC_SKILL_QUALIFICATION_CHILD").as_deref() == Ok(selected.as_str()) {
        return false;
    }
    // Also keep the child's inherited PATH/config snapshot clear of other
    // cooperating environment fixtures while it is spawned.
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([selected.as_str(), "--exact", "--nocapture"])
        .env("NAC_SKILL_QUALIFICATION_CHILD", &selected);
    if ignored {
        command.arg("--ignored");
    }
    let output = command.output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    print!("{stdout}");
    assert!(
        output.status.success(),
        "{selected}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        stdout.contains("1 passed;") && stdout.contains(&selected),
        "child did not execute {selected}"
    );
    true
}

struct Fixture {
    root: PathBuf,
    env: Vec<(&'static str, Option<OsString>)>,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-skill-qualification-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("project/.git")).unwrap();
        let root = root.canonicalize().unwrap();
        let mut fixture = Self { root, env: vec![] };
        for (name, suffix) in [
            ("HOME", "home"),
            ("NAC_HOME", "nac-home"),
            ("XDG_CONFIG_HOME", "xdg"),
        ] {
            fixture.set_env(name, fixture.root.join(suffix).as_os_str());
        }
        fixture.set_env(
            "NAC_SKILL_QUALIFICATION_KEY",
            std::ffi::OsStr::new("fixture-only"),
        );
        fixture
    }

    fn set_env(&mut self, name: &'static str, value: &std::ffi::OsStr) {
        self.env.push((name, std::env::var_os(name)));
        // Every caller owns TEST_ENV_LOCK, like the neighboring skill tests.
        unsafe { std::env::set_var(name, value) };
    }

    fn project(&self) -> PathBuf {
        self.root.join("project")
    }

    fn write(&self, relative: &str, content: &str) -> PathBuf {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, content).unwrap();
        path
    }

    fn skill(&self, root: &str, body: &str) -> PathBuf {
        self.write(
            &format!("{root}/linked-demo/SKILL.md"),
            &format!("---\nname: linked-demo\ndescription: qualification: linked resources\ncompatibility: Local fixture only\ndisable-model-invocation: true\nuser-invocable: false\nallowed-tools: [unavailable_connector]\n---\n{body}\n"),
        ).parent().unwrap().to_path_buf()
    }

    fn load(&self) -> Arc<SkillRegistry> {
        SkillRegistry::load(
            Some(&self.project()),
            SkillPathVisibility::Visible,
            &PathContext::new(self.project()),
        )
        .unwrap()
        .unwrap()
    }

    async fn direct(&self, url: &str, rules: Vec<PermissionRule>) -> OrchestratorRunConfig {
        let mut config = NacConfig::default();
        config.permissions.rules = rules;
        let mut run = build_run_config_for_project_with_behavior(
            RunOptions {
                workspace_cwd: self.project(),
                config_cwd: Some(self.project()),
                store: StoreOptions {
                    store_path: Some(self.root.join(format!("{}.db", uuid::Uuid::new_v4()))),
                },
                model: ModelOptions {
                    backend: Some(crate::model::BackendKind::OpenAiResponses),
                    api_model: Some("gpt-5.2".into()),
                    api_base_url: Some(url.into()),
                    api_key_env: OptionalModelOption::Value("NAC_SKILL_QUALIFICATION_KEY".into()),
                    ..Default::default()
                },
                orchestrator_compaction_threshold: Some(0),
                ..Default::default()
            },
            &config,
            None,
            SessionBehavior::Direct,
        )
        .await
        .unwrap();
        let version = crate::sessions::load_session_config(
            &run.session.store_path(),
            run.session.session_id().unwrap(),
        )
        .unwrap()
        .config_version;
        assert!(run.agent.configure_permission_broker(version).is_some());
        run.agent
            .set_steering_dispatch_id(Some(uuid::Uuid::new_v4().to_string()));
        run
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for (name, previous) in self.env.drain(..).rev() {
            unsafe {
                match previous {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn response(output: serde_json::Value) -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        json!({"status":"completed", "output":output,
        "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}})
        .to_string(),
    )
}

fn calls(items: &[(&str, &str, serde_json::Value)]) -> ScriptedResponse {
    response(json!(items
        .iter()
        .map(|(id, name, args)| json!({
            "type":"function_call", "call_id":id, "name":name, "arguments":args.to_string()
        }))
        .collect::<Vec<_>>()))
}

fn done() -> ScriptedResponse {
    response(
        json!([{"type":"message","content":[{"type":"output_text","text":"fixture finished"}]}]),
    )
}

fn tool_result(run: &OrchestratorRunConfig, id: &str) -> String {
    run.agent
        .messages
        .iter()
        .find_map(|message| match message {
            Message::Tool {
                tool_call_id,
                content,
            } if tool_call_id == id => Some(content.as_text().unwrap().to_string()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing result {id}"))
}

#[test]
fn all_four_roots_shadow_in_order_and_registry_retains_loaded_bytes() {
    if run_in_subprocess(
        "all_four_roots_shadow_in_order_and_registry_retains_loaded_bytes",
        false,
    ) {
        return;
    }
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let f = Fixture::new();
    let roots = [
        "project/.nac/skills",
        "project/.agents/skills",
        "nac-home/skills",
        "home/.agents/skills",
    ];
    for (index, root) in roots.iter().enumerate() {
        f.skill(root, &format!("source {index}"));
    }
    let retained = f.load();
    for (index, root) in roots.iter().enumerate() {
        let registry = f.load();
        let rendered = registry
            .activate("linked-demo")
            .content
            .as_text()
            .unwrap()
            .to_string();
        assert!(rendered.contains(&format!("source {index}")));
        assert!(rendered.contains(&f.root.join(root).join("linked-demo").display().to_string()));
        let entries = registry.catalog_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "qualification: linked resources");
        assert_eq!(
            entries[0].compatibility.as_deref(),
            Some("Local fixture only")
        );
        fs::remove_dir_all(f.root.join(root)).unwrap();
    }
    assert!(retained
        .activate("linked-demo")
        .content
        .as_text()
        .unwrap()
        .contains("source 0"));
    assert!(retained.activate("missing").is_error);
    assert!(SkillRegistry::load(
        Some(&f.project()),
        SkillPathVisibility::Visible,
        &PathContext::new(f.project())
    )
    .unwrap()
    .is_none());
}

#[tokio::test]
async fn direct_expansion_reads_linked_resources_executes_inert_script_and_rejects_missing_capability(
) {
    if run_in_subprocess("direct_expansion_reads_linked_resources_executes_inert_script_and_rejects_missing_capability", false) { return; }
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let f = Fixture::new();
    let package = f.skill("project/catalog", "Read references/guide.txt; scripts/probe.py is inert. Missing references/absent.txt must be reported. unavailable_connector is unsupported.");
    f.write(
        "project/catalog/linked-demo/references/guide.txt",
        "qualification-resource-marker\n",
    );
    f.write(
        "project/catalog/linked-demo/scripts/probe.py",
        "print('qualification-script-marker')\n",
    );
    f.write(
        "project/catalog/linked-demo/skill.json",
        r#"{"schema_version":1,"clients":["codex"]}"#,
    );
    fs::create_dir_all(f.project().join(".agents/skills")).unwrap();
    let link = f.project().join(".agents/skills/linked-demo");
    symlink(&package, &link).unwrap();
    let command = format!("python3 '{}'", link.join("scripts/probe.py").display());
    // This exact inert interpreter invocation is deliberately trusted in this
    // fixture. It is broad code authority, not a skill/frontmatter grant.
    let resources = crate::permissions::shell_resources(
        &command,
        &f.project(),
        &crate::sandbox::ExecutionBackend::Local {
            workspace_cwd: f.project(),
        },
    );
    let rules = resources
        .into_iter()
        .filter(|r| matches!(r.action.as_str(), "execute" | "execute_broad"))
        .map(|r| PermissionRule::new(r.action, r.resource, PermissionEffect::Allow))
        .collect();
    let server = ScriptedServer::start(vec![
        calls(&[
            (
                "reference",
                "read",
                json!({"path":link.join("references/guide.txt")}),
            ),
            (
                "script-read",
                "read",
                json!({"path":link.join("scripts/probe.py")}),
            ),
            (
                "missing",
                "read",
                json!({"path":link.join("references/absent.txt")}),
            ),
            ("unsupported", "unavailable_connector", json!({})),
        ]),
        calls(&[(
            "script",
            "exec_command",
            json!({"cmd":command,"workdir":f.project(),"tty":false}),
        )]),
        done(),
        calls(&[(
            "updated-reference",
            "read",
            json!({"path":link.join("references/guide.txt")}),
        )]),
        done(),
    ]);
    let mut run = f.direct(&server.base_url, rules).await;
    let registry = run.agent.skills().unwrap();
    let ordinary = "Use the matching workflow if appropriate.";
    let PreparedUserInput::SubmitPrompt(automatic) = prepare_user_input(ordinary, Some(&registry))
    else {
        panic!("expected prompt")
    };
    assert_eq!(automatic.agent_prompt, ordinary);
    let raw = "Use $linked-demo twice: $linked-demo; leave $not-installed unchanged.";
    let PreparedUserInput::SubmitPrompt(prepared) = prepare_user_input(raw, Some(&registry)) else {
        panic!("expected prompt")
    };
    assert_eq!(prepared.raw_prompt, raw);
    assert_eq!(
        prepared
            .agent_prompt
            .matches("<skill_content name=")
            .count(),
        1
    );
    assert!(prepared
        .agent_prompt
        .contains("<file>references/guide.txt</file>"));
    assert!(!prepared
        .agent_prompt
        .contains("<file>references/absent.txt</file>"));
    assert!(prepared
        .agent_prompt
        .contains(&format!("Skill directory: {}", link.display())));
    run.agent.send(&prepared.agent_prompt).await.unwrap();
    assert!(tool_result(&run, "reference").contains("qualification-resource-marker"));
    assert!(tool_result(&run, "script-read").contains("qualification-script-marker"));
    let missing = tool_result(&run, "missing");
    let missing: serde_json::Value = serde_json::from_str(&missing).unwrap();
    assert!(missing.get("revision").is_none());
    assert_eq!(missing["error"], "not_found");
    assert!(tool_result(&run, "unsupported").contains("unknown tool"));
    let script = tool_result(&run, "script");
    assert!(script.contains("qualification-script-marker"), "{script}");
    let script: serde_json::Value = serde_json::from_str(&script).unwrap();
    assert_eq!(script["exit_code"], 0);
    // Mutation is fixture-only. An already constructed direct agent retains
    // its registry; a fresh load observes updated source bytes.
    fs::write(
        package.join("SKILL.md"),
        "---\nname: linked-demo\ndescription: changed\n---\nchanged body\n",
    )
    .unwrap();
    fs::write(
        package.join("references/guide.txt"),
        "updated-resource-marker\n",
    )
    .unwrap();
    let PreparedUserInput::SubmitPrompt(second) =
        prepare_user_input("$linked-demo", run.agent.skills().as_deref())
    else {
        panic!("expected prompt")
    };
    assert!(second.agent_prompt.contains("Read references/guide.txt"));
    assert!(!second.agent_prompt.contains("changed body"));
    run.agent.send(&second.agent_prompt).await.unwrap();
    assert!(tool_result(&run, "updated-reference").contains("updated-resource-marker"));
    assert!(f
        .load()
        .activate("linked-demo")
        .content
        .as_text()
        .unwrap()
        .contains("changed body"));
    let requests = server.finish();
    assert_eq!(requests.len(), 5);
    let first: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(first.to_string().contains("<invoked_skills>"));
    assert!(!first.to_string().contains("<available_skills>"));
    assert!(!first["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "unavailable_connector" || t["name"] == "activate_skill"));
}

#[tokio::test]
async fn linked_external_resource_requires_canonical_permission_and_deny_still_wins() {
    if run_in_subprocess(
        "linked_external_resource_requires_canonical_permission_and_deny_still_wins",
        false,
    ) {
        return;
    }
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let f = Fixture::new();
    let package = f.skill("catalog", "Read references/guide.txt.");
    let target = f.write(
        "catalog/linked-demo/references/guide.txt",
        "external-fixture-marker",
    );
    fs::create_dir_all(f.project().join(".agents/skills")).unwrap();
    let link = f.project().join(".agents/skills/linked-demo");
    symlink(package, &link).unwrap();
    assert!(f.load().has_skill("linked-demo"));
    for (rules, expected) in [
        (vec![], "approval is required"),
        (
            vec![PermissionRule::new(
                "external_directory",
                target.display().to_string(),
                PermissionEffect::Allow,
            )],
            "external-fixture-marker",
        ),
        (
            vec![
                PermissionRule::new(
                    "external_directory",
                    target.display().to_string(),
                    PermissionEffect::Allow,
                ),
                PermissionRule::new("read", target.display().to_string(), PermissionEffect::Deny),
            ],
            "permission denied",
        ),
        (
            vec![PermissionRule::new(
                "external_directory",
                link.join("references/guide.txt").display().to_string(),
                PermissionEffect::Allow,
            )],
            "approval is required",
        ),
    ] {
        let server = ScriptedServer::start(vec![
            calls(&[(
                "read",
                "read",
                json!({"path":link.join("references/guide.txt")}),
            )]),
            done(),
        ]);
        let mut run = f.direct(&server.base_url, rules).await;
        let PreparedUserInput::SubmitPrompt(prompt) = prepare_user_input(
            "Use $linked-demo; read only the linked fixture reference.",
            run.agent.skills().as_deref(),
        ) else {
            panic!("expected prompt")
        };
        assert!(prompt
            .agent_prompt
            .contains("<skill_content name=\"linked-demo\">"));
        run.agent.send(&prompt.agent_prompt).await.unwrap();
        let result = tool_result(&run, "read");
        assert!(result.contains(expected), "{result}");
        if expected != "external-fixture-marker" {
            assert!(!result.contains("external-fixture-marker"));
        }
        assert_eq!(server.finish().len(), 2);
    }
}
