//! Inward-facing contracts shared by the durable harness and optional product
//! contexts. This crate stays free of HTTP, providers, persistence, and agent
//! runtime construction so those outer layers can depend on it without cycles.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;

/// Canonical public NAC product version sourced from the repository root.
///
/// Internal crate versions are dependency metadata and must not be exposed on
/// public protocol or provider surfaces.
pub const PRODUCT_VERSION: &str = env!("NAC_PRODUCT_VERSION");
pub const NAC_USER_AGENT: &str = concat!("nac/", env!("NAC_PRODUCT_VERSION"));
pub const NAC_WEB_USER_AGENT: &str = concat!("nac-web/", env!("NAC_PRODUCT_VERSION"));

/// Compare two bounded Semantic Version 2.0.0 product versions by precedence.
/// Build metadata is validated but deliberately ignored for ordering.
pub fn compare_product_versions(left: &str, right: &str) -> Option<Ordering> {
    let left = ProductVersion::parse(left)?;
    let right = ProductVersion::parse(right)?;
    Some(left.cmp(&right))
}

/// Validate the product-version wire contract shared by release metadata,
/// controller assertions, and managed startup expectations.
pub fn valid_product_version(value: &str) -> bool {
    ProductVersion::parse(value).is_some()
}

#[derive(Debug, Eq)]
struct ProductVersion<'a> {
    core: [&'a str; 3],
    prerelease: Option<Vec<&'a str>>,
}

impl<'a> ProductVersion<'a> {
    fn parse(value: &'a str) -> Option<Self> {
        if value.is_empty() || value.len() > 128 || !value.is_ascii() {
            return None;
        }
        let (precedence, build) = value
            .split_once('+')
            .map_or((value, None), |(precedence, build)| {
                (precedence, Some(build))
            });
        if let Some(build) = build {
            if !valid_semver_identifiers(build, false) {
                return None;
            }
        }
        let (core, prerelease) = precedence
            .split_once('-')
            .map_or((precedence, None), |(core, prerelease)| {
                (core, Some(prerelease))
            });
        if prerelease.is_some_and(|value| !valid_semver_identifiers(value, true)) {
            return None;
        }
        let core = core.split('.').collect::<Vec<_>>();
        let core: [&str; 3] = core.try_into().ok()?;
        if core.iter().any(|part| !valid_core_number(part)) {
            return None;
        }
        Some(Self {
            core,
            prerelease: prerelease.map(|value| value.split('.').collect()),
        })
    }
}

impl PartialEq for ProductVersion<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Ord for ProductVersion<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        for (left, right) in self.core.iter().zip(other.core.iter()) {
            let ordering = compare_numeric_identifiers(left, right);
            if ordering != Ordering::Equal {
                return ordering;
            }
        }
        match (&self.prerelease, &other.prerelease) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(left), Some(right)) => {
                for (left, right) in left.iter().zip(right.iter()) {
                    let ordering = match (
                        left.bytes().all(|byte| byte.is_ascii_digit()),
                        right.bytes().all(|byte| byte.is_ascii_digit()),
                    ) {
                        (true, true) => compare_numeric_identifiers(left, right),
                        (true, false) => Ordering::Less,
                        (false, true) => Ordering::Greater,
                        (false, false) => left.cmp(right),
                    };
                    if ordering != Ordering::Equal {
                        return ordering;
                    }
                }
                left.len().cmp(&right.len())
            }
        }
    }
}

impl PartialOrd for ProductVersion<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn valid_core_number(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn valid_semver_identifiers(value: &str, reject_numeric_leading_zero: bool) -> bool {
    !value.is_empty()
        && value.split('.').all(|identifier| {
            !identifier.is_empty()
                && identifier
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && (!reject_numeric_leading_zero
                    || !identifier.bytes().all(|byte| byte.is_ascii_digit())
                    || identifier == "0"
                    || !identifier.starts_with('0'))
        })
}

fn compare_numeric_identifiers(left: &str, right: &str) -> Ordering {
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

/// Formats a public product user agent from the canonical product version.
pub fn product_user_agent(product: &str) -> String {
    product_user_agent_for_version(product, PRODUCT_VERSION)
}

/// Version-injected formatter used to prove future product bumps propagate
/// byte-for-byte without coupling public identity to Cargo package versions.
#[doc(hidden)]
pub fn product_user_agent_for_version(product: &str, version: &str) -> String {
    format!("{product}/{version}")
}

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
    fn simulated_product_version_bump_updates_public_user_agents_exactly() {
        assert_eq!(product_user_agent_for_version("nac", "9.8.7"), "nac/9.8.7");
        assert_eq!(
            product_user_agent_for_version("nac-web", "9.8.7"),
            "nac-web/9.8.7"
        );
        assert_eq!(PRODUCT_VERSION, include_str!("../../../version.txt").trim());
        assert_eq!(NAC_USER_AGENT, product_user_agent("nac"));
        assert_eq!(NAC_WEB_USER_AGENT, product_user_agent("nac-web"));
    }

    #[test]
    fn product_version_contract_accepts_semver_builds_and_orders_precedence() {
        for valid in [
            "0.0.0",
            "1.2.3",
            "1.2.3+build.4",
            "1.2.3-alpha-beta",
            "1.2.3-alpha.1+linux-amd64.7",
            "999999999999999999999999.0.1",
        ] {
            assert!(valid_product_version(valid), "{valid}");
        }
        for invalid in [
            "",
            "1.2",
            "01.2.3",
            "1.02.3",
            "1.2.03",
            "1.2.3-",
            "1.2.3-alpha..1",
            "1.2.3-01",
            "1.2.3+",
            "1.2.3+build_4",
            "1.2.3+one+two",
        ] {
            assert!(!valid_product_version(invalid), "{invalid}");
        }
        assert_eq!(
            compare_product_versions("1.2.3+build.4", "1.2.3+build.5"),
            Some(std::cmp::Ordering::Equal)
        );
        assert_eq!(
            compare_product_versions("1.2.3-alpha.2", "1.2.3-alpha.10"),
            Some(std::cmp::Ordering::Less)
        );
        assert_eq!(
            compare_product_versions("1.2.3-rc.1", "1.2.3"),
            Some(std::cmp::Ordering::Less)
        );
    }

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
