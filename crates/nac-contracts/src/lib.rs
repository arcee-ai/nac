//! Inward-facing contracts shared by the durable harness and optional product
//! contexts. This crate stays free of HTTP, providers, persistence, and agent
//! runtime construction so those outer layers can depend on it without cycles.

use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

/// Stable project projection shared by persistence, managed workflows, and
/// delivery without exposing a SQLite implementation.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProjectRecord {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub cwd: PathBuf,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: bool,
    pub sort_order: i64,
    pub presentation_version: i64,
}

/// Project registration command used by application ports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProject {
    pub project_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub cwd: PathBuf,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
}

/// Immutable command environment plus the exact secret values that must be
/// redacted from output produced under that environment.
///
/// The type intentionally has no serialization implementation: environment
/// values are process-local capability data, not a persistence or transport
/// contract.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandEnvironmentSnapshot {
    values: BTreeMap<String, String>,
    redactions: Vec<String>,
}

impl CommandEnvironmentSnapshot {
    pub fn empty() -> Self {
        Self {
            values: BTreeMap::new(),
            redactions: Vec::new(),
        }
    }

    pub fn from_parts(values: BTreeMap<String, String>, redactions: Vec<String>) -> Self {
        Self { values, redactions }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.values
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    #[doc(hidden)]
    pub fn insert_dedicated(
        &mut self,
        name: impl Into<String>,
        value: impl Into<String>,
        redact: bool,
    ) {
        let value = value.into();
        if redact && !value.is_empty() {
            self.redactions.push(value.clone());
        }
        self.values.insert(name.into(), value);
    }

    pub fn redact(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        let mut values = self
            .redactions
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        values.sort_by_key(|value| std::cmp::Reverse(value.len()));
        values.dedup();
        for value in values {
            redacted = redacted.replace(value, "[REDACTED]");
        }
        redacted
    }
}

pub type CommandEnvironmentFuture<'a> =
    Pin<Box<dyn Future<Output = anyhow::Result<CommandEnvironmentSnapshot>> + Send + 'a>>;

/// Process-launch metadata needed when a worker must reconstruct the same
/// environment provider in its own process.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WorkerEnvironment {
    pub secret_root: Option<PathBuf>,
    pub github_client_id: Option<String>,
    pub home_root: Option<PathBuf>,
}

/// Injected command-environment capability. Implementations may read mutable
/// credential stores at spawn time, but consumers see only immutable snapshots
/// and never provider-specific credential types.
pub trait CommandEnvironmentProvider: Send + Sync {
    fn snapshot(&self) -> CommandEnvironmentFuture<'_>;
    fn redaction_snapshot(&self) -> anyhow::Result<CommandEnvironmentSnapshot>;
    fn worker_environment(&self) -> WorkerEnvironment;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_redacts_longest_distinct_values_and_keeps_environment_private() {
        let mut snapshot = CommandEnvironmentSnapshot::empty();
        snapshot.insert_dedicated("TOKEN", "secret", true);
        snapshot.insert_dedicated("LONG_TOKEN", "secret-suffix", true);
        snapshot.insert_dedicated("HOME", "/managed/home", false);
        snapshot.insert_dedicated("TOKEN_COPY", "secret", true);

        assert_eq!(snapshot.get("HOME"), Some("/managed/home"));
        assert_eq!(
            snapshot.redact("secret-suffix then secret from /managed/home"),
            "[REDACTED] then [REDACTED] from /managed/home"
        );
    }
}
