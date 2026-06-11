use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;

use crate::agent::Agent;
use crate::skills::SkillRegistry;
use crate::store::{self, WorkerContext};
use crate::types::Message;

pub struct ManagedWorkerRunConfig {
    pub(crate) agent: Agent,
    pub(crate) store_path: PathBuf,
    pub(crate) session_id: String,
    pub(crate) thread_name: String,
    pub(crate) action: String,
}

pub fn build_worker_context_messages(
    thread_name: &str,
    worker_context: &WorkerContext,
) -> Vec<Message> {
    let mut messages = Vec::new();
    if let Some(self_context) =
        store::render_self_context(thread_name, &worker_context.self_episodes)
    {
        messages.push(Message::User {
            content: self_context,
        });
    }
    for source_episode in &worker_context.source_episodes {
        messages.push(Message::User {
            content: store::render_source_context(source_episode),
        });
    }
    messages
}

pub fn build_preloaded_skill_messages(
    registry: Option<&SkillRegistry>,
    names: &[String],
) -> Result<Vec<Message>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }

    let Some(registry) = registry else {
        anyhow::bail!("requested skills but no skills are available");
    };

    let mut seen = HashSet::new();
    let mut messages = Vec::new();
    for name in names {
        if !seen.insert(name.as_str()) {
            continue;
        }
        if !registry.has_skill(name) {
            anyhow::bail!("unknown skill '{}'", name);
        }

        let activated = registry.activate(name);
        messages.push(Message::System {
            content: format!(
                "The orchestrator preloaded this skill for this worker dispatch.\n\n{}",
                activated.content
            ),
        });
    }

    Ok(messages)
}

async fn commit_managed_worker_episode(
    store_path: PathBuf,
    session_id: String,
    thread_name: String,
    action: String,
    response: &str,
) -> Result<()> {
    let response = response.to_string();
    tokio::task::spawn_blocking(move || {
        store::append_episode(&store_path, &session_id, &thread_name, &action, &response)
    })
    .await??;
    Ok(())
}

pub async fn run_managed_worker(run_config: ManagedWorkerRunConfig) -> Result<()> {
    let ManagedWorkerRunConfig {
        mut agent,
        store_path,
        session_id,
        thread_name,
        action,
    } = run_config;

    let send_result = agent.send(&action).await;
    let response = send_result?;
    commit_managed_worker_episode(store_path, session_id, thread_name, action, &response).await?;
    println!("{}", response);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::events::EventSink;
    use crate::model::ModelClient;
    use crate::skills::SkillRecord;
    use crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS;

    fn test_registry() -> SkillRegistry {
        SkillRegistry::load_for_test(vec![SkillRecord {
            name: "code-review".to_string(),
            description: "Review code quality".to_string(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/tmp/code-review"),
            body: "Review body instructions.".to_string(),
            resources: Vec::new(),
        }])
    }

    #[test]
    fn preloaded_skill_messages_dedupe_validate_and_precede_context() {
        let registry = test_registry();
        let names = vec!["code-review".to_string(), "code-review".to_string()];
        let mut messages = build_preloaded_skill_messages(Some(&registry), &names).unwrap();
        messages.extend(build_worker_context_messages(
            "impl",
            &WorkerContext {
                self_episodes: vec![store::EpisodeRecord {
                    id: 1,
                    thread_name: "impl".to_string(),
                    session_id: "session".to_string(),
                    action: "previous".to_string(),
                    content: "retained context".to_string(),
                    created_at: "now".to_string(),
                }],
                source_episodes: Vec::new(),
            },
        ));

        assert_eq!(messages.len(), 2);
        match &messages[0] {
            Message::System { content } => {
                assert!(content.contains("orchestrator preloaded this skill"));
                assert!(content.contains("<skill_content name=\"code-review\">"));
                assert!(content.contains("Review body instructions."));
            }
            other => panic!("expected preloaded skill system message, got {:?}", other),
        }
        match &messages[1] {
            Message::User { content } => assert!(content.contains("retained context")),
            other => panic!("expected retained context after skill, got {:?}", other),
        }

        let agent = Agent::with_config(
            ModelClient::new_for_test(),
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: store::default_store_path(),
                session_id: None,
                initial_messages: messages.clone(),
                thread_name: Some("impl".to_string()),
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh_host: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: Some("AGENTS.md worker instructions".to_string()),
                thread_timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
            },
        )
        .expect("agent config must be valid");
        let system_messages = agent
            .messages
            .iter()
            .filter(|message| matches!(message, Message::System { .. }))
            .count();
        assert_eq!(system_messages, 1);
        assert_eq!(agent.messages.len(), 2);
        match (&agent.messages[0], &agent.messages[1]) {
            (Message::System { content }, Message::User { content: context }) => {
                assert!(content.contains("AGENTS.md worker instructions"));
                assert!(content.contains("orchestrator preloaded this skill"));
                assert!(content.contains("<skill_content name=\"code-review\">"));
                assert!(context.contains("retained context"));
            }
            other => panic!(
                "expected merged system then retained context, got {:?}",
                other
            ),
        }

        let missing = vec!["missing".to_string()];
        assert!(build_preloaded_skill_messages(Some(&registry), &missing)
            .unwrap_err()
            .to_string()
            .contains("unknown skill 'missing'"));
        assert!(build_preloaded_skill_messages(None, &missing)
            .unwrap_err()
            .to_string()
            .contains("no skills are available"));
    }
}
