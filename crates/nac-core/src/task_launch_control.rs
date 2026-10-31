//! Inward port for launching independent visible direct sessions.
//! The composition owner supplies project resolution and prepared-session admission.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
};

use anyhow::{anyhow, Result};
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::store::{DirectTaskSnapshot, TaskLaunchRecord};

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskWorkspace {
    #[default]
    Auto,
    CleanRef,
    ExistingCheckout,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NativeTaskRequest {
    pub request_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub skill: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub workspace: TaskWorkspace,
    pub git_ref: Option<String>,
    pub default_ref: Option<String>,
}

impl NativeTaskRequest {
    pub fn validate(&self) -> Result<()> {
        crate::store::TaskLaunchRequest {
            request_id: self.request_id.clone(),
            project_id: self.project_id.clone().unwrap_or_else(|| "current".into()),
            invoking_session_id: None,
            git_ref: self.git_ref.clone(),
            default_ref: self.default_ref.clone(),
            title: self.title.clone(),
            prompt: self.initial_prompt(),
        }
        .validate()?;
        for value in [&self.skill, &self.model, &self.reasoning_effort]
            .into_iter()
            .flatten()
        {
            anyhow::ensure!(
                !value.trim().is_empty()
                    && value.len() <= 256
                    && !value.chars().any(char::is_control),
                "invalid request: skill/model/reasoning must be nonblank and bounded"
            );
        }
        anyhow::ensure!(
            self.workspace != TaskWorkspace::ExistingCheckout
                || (self.git_ref.is_none() && self.default_ref.is_none()),
            "invalid request: existing_checkout cannot select a Git ref"
        );
        Ok(())
    }

    pub fn initial_prompt(&self) -> String {
        match &self.skill {
            Some(skill) => format!(
                "Use the requested skill ${}.\n\n{}",
                skill.strip_prefix('$').unwrap_or(skill),
                self.prompt
            ),
            None => self.prompt.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SavedTaskProject {
    pub project_id: String,
    pub name: String,
    pub cwd: PathBuf,
    pub ssh_host: Option<String>,
    pub default_model_config_id: Option<String>,
    pub default_model: Option<String>,
    pub default_reasoning_effort: Option<String>,
    pub default_ref: Option<String>,
    pub eligible: bool,
    pub eligibility_detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeTaskLaunch {
    pub request: NativeTaskRequest,
    pub caller_session_id: String,
    pub project_id: String,
    pub source_cwd: PathBuf,
    pub session_id: String,
    pub retained: bool,
    pub phase: String,
    pub error: Option<String>,
    pub first_input_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct NativeTaskReceipt {
    pub launch: NativeTaskLaunch,
    pub retained_launch: Option<TaskLaunchRecord>,
    pub navigation: String,
    pub task: Option<Box<DirectTaskSnapshot>>,
    pub as_of_epoch_ms: u64,
    /// Passive durable reads cannot observe process-local approval queues.
    pub approvals: String,
}

/// Issued only by the native kernel adapter. It carries ordinary agent policy,
/// never human invocation authority, and stays inside the launching invocation.
#[derive(Clone)]
pub struct NativeTaskAuthorization {
    runtime: crate::tools::ToolRuntime,
    context: crate::tools::kernel::ToolCallContext,
}

impl NativeTaskAuthorization {
    #[cfg(feature = "test-support")]
    #[doc(hidden)]
    pub fn for_local_fixture(store_path: PathBuf, caller: String, cwd: PathBuf) -> Self {
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path.clone();
        runtime.session_id = Some(caller.clone());
        runtime.workspace_cwd = cwd.clone();
        runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Local { workspace_cwd: cwd });
        runtime.permission_broker = Some(Arc::new(crate::permissions::PermissionBroker::new(
            store_path,
            caller,
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "*",
                "*",
                crate::permissions::PermissionEffect::Allow,
            )],
        )));
        Self::new(&runtime, &crate::tools::kernel::ToolCallContext::default())
    }
    pub(crate) fn new(
        runtime: &crate::tools::ToolRuntime,
        context: &crate::tools::kernel::ToolCallContext,
    ) -> Self {
        Self {
            runtime: runtime.clone(),
            context: context.clone(),
        }
    }

    pub async fn authorize_preparation(&self, launch: &TaskLaunchRecord) -> Result<()> {
        anyhow::ensure!(
            self.runtime.session_id == launch.request.invoking_session_id,
            "native preparation caller binding changed"
        );
        let broker = self
            .runtime
            .permission_broker
            .as_ref()
            .ok_or_else(|| anyhow!("agent authorization unavailable"))?;
        let mut resources = crate::workspace::task_worktree::preparation_resources(
            launch,
            self.runtime.backend.as_ref(),
            &self.runtime.store_path,
        );
        // Human preparation retains its legacy semantic command spelling.
        // Agent policy uses the same canonical argv identity as ordinary native execution.
        resources.retain(|resource| resource.action != "execute");
        for tokens in crate::workspace::task_worktree::preparation_commands(launch) {
            let canonical = crate::permissions::canonical_command(&tokens);
            for action in ["execute", "execute_broad"] {
                resources.push(
                    crate::tools::kernel::PermissionResource::new(action, canonical.clone())
                        .with_display(tokens.join(" ")),
                );
            }
        }
        let resources = crate::permissions::canonicalize_authorization_resources(
            &resources,
            self.runtime.backend.as_ref(),
            &self.runtime.store_path,
        )
        .await?;
        match self
            .context
            .authorize_during_execution(broker.authorize(
                "launch_task",
                &resources,
                &self.context,
                self.context.cancellation(&self.runtime),
            ))
            .await
        {
            crate::permissions::AuthorizationOutcome::Allowed => {}
            crate::permissions::AuthorizationOutcome::Denied(reason) => {
                return Err(anyhow!(
                    "native task preparation permission denied: {reason}"
                ))
            }
        }
        let current = crate::permissions::canonicalize_authorization_resources(
            &resources,
            self.runtime.backend.as_ref(),
            &self.runtime.store_path,
        )
        .await?;
        anyhow::ensure!(
            resources == current,
            "native task preparation target changed during authorization"
        );
        anyhow::ensure!(
            !self.context.cancellation(&self.runtime).is_cancelled(),
            "native task preparation cancelled before effects"
        );
        Ok(())
    }
}

pub trait TaskLaunchController: Send + Sync + 'static {
    fn projects<'a>(&'a self, caller: &'a str) -> BoxFuture<'a, Result<Vec<SavedTaskProject>>>;
    /// Resolve without mutation. The caller authorizes this exact binding.
    fn resolve<'a>(
        &'a self,
        caller: &'a str,
        request: &'a NativeTaskRequest,
    ) -> BoxFuture<'a, Result<SavedTaskProject>>;
    fn launch<'a>(
        &'a self,
        caller: &'a str,
        request: NativeTaskRequest,
        target: SavedTaskProject,
        authorization: NativeTaskAuthorization,
    ) -> BoxFuture<'a, Result<NativeTaskReceipt>>;
    /// A passive read: never attach, wake, recover or answer an approval.
    fn status<'a>(
        &'a self,
        caller: &'a str,
        request_id: &'a str,
    ) -> BoxFuture<'a, Result<NativeTaskReceipt>>;
}

static CONTROLLERS: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn TaskLaunchController>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register_controller(path: PathBuf, controller: Arc<dyn TaskLaunchController>) {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(path, controller);
}

pub(crate) fn controller_for(path: &Path) -> Result<Arc<dyn TaskLaunchController>> {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .cloned()
        .ok_or_else(|| anyhow!("independent task launch is unavailable on this host"))
}
