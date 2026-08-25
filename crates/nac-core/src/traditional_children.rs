//! Protocol-independent control seam for durable traditional child sessions.
//!
//! Persistence and terminal settlement live in `store::traditional_children`.
//! The server supplies session construction/attachment through this trait so
//! model tools never loop back through HTTP or depend on `nac-server`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use anyhow::{anyhow, Result};
use futures_util::future::BoxFuture;

use crate::store::{TraditionalChildExecutionMode, TraditionalChildRecord, GENERAL_CHILD_PROFILE};
use crate::types::Message;

pub type ChildFuture<'a, T> = BoxFuture<'a, Result<T>>;

#[derive(Debug, Clone)]
pub struct TraditionalChildStartRequest {
    pub parent_session_id: String,
    pub child_session_id: Option<String>,
    pub profile: String,
    pub description: String,
    pub prompt: String,
    pub execution_mode: TraditionalChildExecutionMode,
}

pub trait TraditionalChildController: Send + Sync + 'static {
    fn start<'a>(
        &'a self,
        request: TraditionalChildStartRequest,
    ) -> ChildFuture<'a, TraditionalChildRecord>;

    fn wait<'a>(
        &'a self,
        child_session_id: &'a str,
        generation: u64,
    ) -> ChildFuture<'a, TraditionalChildRecord>;

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        child_session_id: &'a str,
    ) -> ChildFuture<'a, TraditionalChildRecord>;

    fn wake<'a>(&'a self, session_id: &'a str) -> ChildFuture<'a, ()>;
}

static CONTROLLERS: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn TraditionalChildController>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register_controller(path: PathBuf, controller: Arc<dyn TraditionalChildController>) {
    CONTROLLERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path, controller);
}

#[doc(hidden)]
pub fn controller_for(path: &Path) -> Result<Arc<dyn TraditionalChildController>> {
    CONTROLLERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(path)
        .cloned()
        .ok_or_else(|| anyhow!("traditional child session control is unavailable"))
}

/// Build the fresh canonical child system head from the parent's
/// construction-owned direct prompt plus its current project instructions.
/// No user/assistant history crosses the relationship.
pub fn fresh_general_child_messages(
    parent_messages: &[Message],
    parent_working_directory: &str,
    description: &str,
) -> Result<Vec<Message>> {
    let parent_system = parent_messages.first().and_then(|message| match message {
        Message::System { content } => Some(content.as_str()),
        _ => None,
    });
    let parent_base = crate::agent::render_direct_system_prompt(parent_working_directory);
    let delegating_parent_base =
        crate::agent::render_direct_with_orchestrator_system_prompt(parent_working_directory);
    // Schema-17 prototypes and hand-authored fixture rows may predate the
    // canonical direct system head. They still get a safe fresh child prompt,
    // but have no persisted project-instruction suffix to inherit.
    let project_suffix = parent_system
        .and_then(|system| {
            system
                .strip_prefix(&delegating_parent_base)
                .or_else(|| system.strip_prefix(&parent_base))
        })
        .unwrap_or_default();
    let mut child =
        crate::agent::render_general_child_system_prompt(parent_working_directory, description);
    child.push_str(project_suffix);
    Ok(vec![Message::System { content: child }])
}

pub fn validate_general_profile(profile: &str) -> Result<()> {
    if profile == GENERAL_CHILD_PROFILE {
        Ok(())
    } else {
        Err(anyhow!("unknown traditional child profile '{profile}'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delegating_parent_does_not_give_managed_orchestrator_instructions_to_child() {
        let cwd = "/workspace";
        let parent = format!(
            "{}\n\nProject instruction: preserve compatibility.",
            crate::agent::render_direct_with_orchestrator_system_prompt(cwd)
        );
        let messages = fresh_general_child_messages(
            &[Message::System { content: parent }],
            cwd,
            "review one subsystem",
        )
        .unwrap();
        let Message::System { content } = &messages[0] else {
            panic!("child must start with a system message");
        };
        assert!(content.contains("Project instruction: preserve compatibility."));
        assert!(!content.contains("orchestrator_*"));
        assert!(!content.contains("## Managed orchestration"));
    }
}
