use anyhow::{ensure, Result};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    /// A requirement on the future actual factory, not proof that it exists.
    SingleOwnerSharedSessionPair,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DeploymentScope {
    pub cluster_namespace_uid: String,
    pub namespace: String,
    pub namespace_uid: String,
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub source_revision: String,
    pub product_version: String,
    pub release_id: String,
    pub build_id: String,
    pub supported_schema_version: u64,
    pub minimum_schema_version: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScopeLimits {
    pub endpoints: u64,
    pub live_jobs: u64,
    pub native_payload_bytes: u64,
    pub captured_results: u64,
    pub captured_bytes: u64,
}
impl ScopeLimits {
    fn within(self, host: Self) -> bool {
        self.endpoints <= host.endpoints
            && self.live_jobs <= host.live_jobs
            && self.native_payload_bytes <= host.native_payload_bytes
            && self.captured_results <= host.captured_results
            && self.captured_bytes <= host.captured_bytes
    }
}

/// RAW Native inputs. Native alone computes its checked payload declaration.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EndpointLimits {
    pub live_jobs: u64,
    pub wire_records: u64,
    pub flow_window: u64,
    pub owned_input_bytes: u64,
    pub capture_bytes: u64,
}

/// Data only. Deserialize does not create a trusted retained PolicySource.
/// All values are required; there are no numeric or deployment defaults.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Configuration {
    pub version: u64,
    pub environment: String,
    pub policy_id: String,
    pub revision: u64,
    pub scope: DeploymentScope,
    pub layout: Layout,
    pub max_sessions: u64,
    pub host: ScopeLimits,
    pub session: ScopeLimits,
    pub native_endpoint: EndpointLimits,
}
impl Configuration {
    pub fn validate_data(&self) -> Result<()> {
        let policy = Uuid::parse_str(&self.policy_id)?;
        let host = Uuid::parse_str(&self.scope.managed_host_id)?;
        ensure!(
            self.version == 1
                && self.environment == "dev3"
                && !policy.is_nil()
                && policy.to_string() == self.policy_id
                && !host.is_nil()
                && host.to_string() == self.scope.managed_host_id
                && self.revision > 0,
            "capacity policy unavailable"
        );
        ensure!(
            self.scope.namespace.starts_with("dev3-")
                && self.scope.namespace.len() <= 63
                && self
                    .scope
                    .namespace
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && self
                    .scope
                    .namespace
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && [
                    self.scope.cluster_namespace_uid.as_str(),
                    self.scope.namespace_uid.as_str(),
                    self.scope.host_incarnation_id.as_str(),
                ]
                .into_iter()
                .all(token)
                && hex(&self.scope.source_revision, 40, 64)
                && nac_contracts::valid_product_version(&self.scope.product_version)
                && self.scope.release_id == self.scope.build_id
                && self.scope.build_id == format!("dev-{}", self.scope.source_revision)
                && self.scope.supported_schema_version <= i64::MAX as u64
                && self.scope.minimum_schema_version <= self.scope.supported_schema_version,
            "capacity policy unavailable"
        );
        ensure!(
            self.max_sessions == 1
                && self.session.within(self.host)
                && self.session.endpoints >= 2
                && self.native_endpoint.live_jobs > 0
                && self.native_endpoint.wire_records > 0
                && self.native_endpoint.flow_window > 0,
            "capacity policy unavailable"
        );
        Ok(())
    }
}

fn token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}
pub(crate) fn hex(value: &str, first: usize, second: usize) -> bool {
    (value.len() == first || value.len() == second)
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
