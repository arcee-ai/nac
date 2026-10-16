use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use anyhow::Result;

use super::AgentMode;

type CredentialSource = dyn Fn() -> Result<Option<String>> + Send + Sync;
type ParentKey = (PathBuf, String);

// Only constructed direct primaries publish a source. Bindings survive idle
// agent eviction for this process, but never restart. No credential bytes live
// in this map; generation admission revalidates the durable parent identity.
static PARENT_SOURCES: LazyLock<Mutex<HashMap<ParentKey, Arc<CredentialSource>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Construction-owned eligibility, separate from tool JSON and authorization.
/// Delegates resolve only a trusted parent binding at generation admission; their
/// model requests cannot consult ambient credentials or refresh mid-generation.
pub(super) enum NativeWebCapabilities {
    Disabled,
    Direct(Arc<CredentialSource>),
    Inherited {
        store: PathBuf,
        session: String,
        parent: String,
        credential: Option<String>,
    },
    Worker(Option<String>),
}

impl NativeWebCapabilities {
    pub(super) fn new(mode: AgentMode, store: &Path, session: Option<&str>) -> Result<Self> {
        if mode == AgentMode::Worker {
            return Ok(Self::Worker(None));
        }
        if let Some(session) = session {
            if let Some(parent) = parent_for(store, session)? {
                return Ok(Self::Inherited {
                    store: store.to_path_buf(),
                    session: session.to_string(),
                    parent,
                    credential: None,
                });
            }
        }
        if mode != AgentMode::Direct {
            return Ok(Self::Disabled);
        }
        let source: Arc<CredentialSource> = Arc::new(resolve_direct_credential);
        Ok(Self::Direct(source))
    }

    // Publish only after the entire agent constructor succeeds. Failed backend
    // or tool construction must never establish parent delegation authority.
    pub(super) fn register_parent(&self, store: &Path, session: Option<&str>) {
        let Self::Direct(source) = self else { return };
        if let Some(session) = session {
            let mut sources = PARENT_SOURCES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            sources.insert(
                (store.to_path_buf(), session.to_string()),
                Arc::clone(source),
            );
        }
    }

    pub(super) fn is_eligible(&self) -> bool {
        !matches!(self, Self::Disabled)
    }

    pub(super) fn admit_generation(&mut self) -> Result<()> {
        if let Self::Inherited {
            store,
            session,
            parent,
            credential,
        } = self
        {
            // Reattachment and continuation revalidate durable ownership. No
            // source on this process/host means no grant, even if ambient Exa
            // credentials exist. The parent must be constructed by its runtime.
            *credential = None;
            if parent_for(store, session)?.as_ref() != Some(parent) {
                return Ok(());
            }
            let eligible =
                crate::sessions::load_session_summary(store, parent)?.is_some_and(|summary| {
                    matches!(
                        summary.behavior,
                        crate::sessions::SessionBehavior::Direct
                            | crate::sessions::SessionBehavior::DirectWithOrchestrator
                    )
                });
            if !eligible {
                PARENT_SOURCES
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .remove(&(store.clone(), parent.clone()));
                return Ok(());
            }
            let source = PARENT_SOURCES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(&(store.clone(), parent.clone()))
                .cloned();
            if let Some(source) = source {
                let resolved = source()?.filter(|value| !value.trim().is_empty());
                if resolved
                    .as_ref()
                    .is_some_and(|value| value.len() > 32 * 1024)
                {
                    anyhow::bail!("parent native web credential exceeds the delegation bound");
                }
                *credential = resolved;
            }
        }
        Ok(())
    }

    pub(super) fn set_worker_credential(&mut self, credential: Option<String>) {
        if let Self::Worker(worker_credential) = self {
            *worker_credential = credential.filter(|value| !value.trim().is_empty());
        }
    }

    pub(super) fn resolve_credential(&self) -> Result<Option<String>> {
        match self {
            Self::Disabled => Ok(None),
            Self::Direct(source) => source(),
            Self::Inherited { credential, .. } | Self::Worker(credential) => Ok(credential.clone()),
        }
    }
}

fn parent_for(store: &Path, session: &str) -> Result<Option<String>> {
    let parent = if let Some(child) = crate::store::load_traditional_child(store, session)? {
        Some(child.parent_session_id)
    } else {
        crate::store::load_managed_orchestrator(store, session)?
            .map(|child| child.parent_session_id)
    };
    Ok(parent)
}

fn resolve_direct_credential() -> Result<Option<String>> {
    match crate::worker_credentials::managed_exa_api_key() {
        Some(credential) => Ok(Some(credential)),
        None => crate::model::resolve_named_api_key(crate::model::EXA_API_KEY_ENV),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANARY: &str = "managed-direct-native-web-canary";

    #[test]
    fn managed_snapshot_direct_web_helper() {
        if std::env::var_os("NAC_MANAGED_DIRECT_WEB_HELPER").is_none() {
            return;
        }
        crate::worker_credentials::capture_managed_native_credentials_from_environment().unwrap();
        assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        let nac_home = std::path::PathBuf::from(std::env::var_os("NAC_HOME").unwrap());
        std::fs::create_dir_all(&nac_home).unwrap();
        let credential_file = nac_home.join("credentials.json");
        let fixture = std::env::var("NAC_MANAGED_DIRECT_WEB_CREDENTIAL_FIXTURE").unwrap();
        std::fs::write(
            &credential_file,
            if fixture == "corrupt" {
                b"not valid JSON".as_slice()
            } else {
                br#"{"api_keys":{"EXA_API_KEY":"must-not-be-read"}}"#.as_slice()
            },
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &credential_file,
                std::fs::Permissions::from_mode(if fixture == "insecure" { 0o644 } else { 0o600 }),
            )
            .unwrap();
        }
        let capability =
            NativeWebCapabilities::new(AgentMode::Direct, &nac_home.join("store.db"), None)
                .unwrap();
        assert_eq!(
            capability.resolve_credential().unwrap().as_deref(),
            Some(CANARY)
        );
        assert_eq!(
            crate::worker_credentials::ManagedWorkerNativeCredentials::from_process_environment()
                .unwrap()
                .into_exa_api_key()
                .as_deref(),
            Some(CANARY)
        );
    }

    #[test]
    fn managed_snapshot_remains_available_to_direct_native_web_only() {
        let fixtures = if cfg!(unix) {
            &["corrupt", "insecure"][..]
        } else {
            &["corrupt"][..]
        };
        for fixture in fixtures {
            let nac_home = std::env::temp_dir().join(format!(
                "nac_managed_direct_web_{fixture}_{}",
                uuid::Uuid::new_v4().simple()
            ));
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "agent::web_capabilities::tests::managed_snapshot_direct_web_helper",
                    "--nocapture",
                ])
                .env("NAC_MANAGED_DIRECT_WEB_HELPER", "1")
                .env("NAC_MANAGED_DIRECT_WEB_CREDENTIAL_FIXTURE", fixture)
                .env("NAC_HOME", &nac_home)
                .env(crate::model::EXA_API_KEY_ENV, CANARY)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "managed direct-web {fixture} helper failed: stdout={} stderr={}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(!String::from_utf8_lossy(&output.stdout).contains(CANARY));
            assert!(!String::from_utf8_lossy(&output.stderr).contains(CANARY));
            let _ = std::fs::remove_dir_all(nac_home);
        }
    }
}

#[cfg(test)]
#[path = "web_inheritance_tests.rs"]
mod inheritance_tests;
