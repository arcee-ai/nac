//! Retained CREATE configuration observation, never operation admission.
//! The same physical source owner survives denial until its caller releases
//! custody. Configuration access is bounded; physical checks stay outside SQL
//! and credential locks. No ordinary loader, recovery, client or key IO occurs.
use super::NacConfig;
use crate::{mcp::RetainedMcpConfiguration, paths::PathContext};
use anyhow::{anyhow, Result};
use std::{path::Path, time::Instant};

/// Actual retained source DATA, not a grant, writer permit or release proof.
///
/// ```compile_fail
/// fn needs_clone<T: Clone>() {}
/// needs_clone::<nac_core::runtime::CreateConfigurationSource>();
/// ```
/// ```compile_fail
/// fn needs_debug<T: std::fmt::Debug>() {}
/// needs_debug::<nac_core::runtime::CreateConfigurationSource>();
/// ```
/// ```compile_fail
/// fn needs_serialize<T: serde::Serialize>() {}
/// needs_serialize::<nac_core::runtime::CreateConfigurationSource>();
/// ```
pub struct CreateConfigurationSource {
    source: RetainedMcpConfiguration,
    configuration: NacConfig,
    cutoff: Instant,
}
fn unavailable() -> anyhow::Error {
    anyhow!("CREATE configuration source unavailable")
}
impl CreateConfigurationSource {
    /// Capture only the actual configured source under the original cutoff.
    /// Missing path context, startup fences, unresolved publications or busy
    /// writers refuse. No default source, repair or renewed clock is installed.
    pub fn capture(config_cwd: &Path, original_cutoff: Instant) -> Result<Self> {
        let capture = (|| {
            if !config_cwd.is_absolute() {
                return Err(unavailable());
            }
            let path = PathContext::new(config_cwd)
                .nac_config_path()
                .ok_or_else(unavailable)?;
            Self::capture_path(&path, original_cutoff)
        })();
        capture.map_err(|_: anyhow::Error| unavailable())
    }

    /// Consume the SAME original startup global namespace, without resolving
    /// HOME/NAC_HOME again. This captures configuration resources only; no
    /// AGENTS/skills reads, repair, transport or execution is authorized.
    pub fn capture_from_global_source(
        global: &super::CreateGlobalPreparationSource,
    ) -> Result<Self> {
        let capture = (|| {
            global.check_current()?;
            let path = global
                .path_context()?
                .nac_config_path()
                .ok_or_else(unavailable)?;
            let source = Self::capture_path(&path, global.original_cutoff())?;
            global.check_current()?;
            Ok(source)
        })();
        capture.map_err(|_: anyhow::Error| unavailable())
    }

    fn capture_path(path: &Path, original_cutoff: Instant) -> Result<Self> {
        let source = RetainedMcpConfiguration::capture(path, original_cutoff)?;
        source.check_current()?;
        let configuration = NacConfig::from_captured_source(source.raw()?)?;
        source.check_current()?;
        Ok(Self {
            source,
            configuration,
            cutoff: original_cutoff,
        })
    }

    pub(in crate::runtime) fn captured_preparation_text(&self) -> Result<&str> {
        self.check_current()?;
        self.source.raw().map_err(|_| unavailable())
    }
    /// Bounded denial/creator/cutoff check only. This does NOT re-read files or
    /// establish physical currentness; callers perform check_current separately.
    pub fn configuration(&self) -> Result<&NacConfig> {
        self.source.check_denial().map_err(|_| unavailable())?;
        Ok(&self.configuration)
    }

    /// Check the SAME original source outside SQLite/credential locks.
    pub fn check_current(&self) -> Result<()> {
        self.source.check_current().map_err(|_| unavailable())
    }

    /// Negative-only veto. Denial keeps the original descriptors/fence alive.
    pub fn deny(&self) {
        self.source.deny();
    }

    pub(crate) fn home_identity(&self) -> Result<crate::configuration_source_files::Identity> {
        self.source.home_identity().map_err(|_| unavailable())
    }

    /// Correlation DATA, never a renewed eligibility window.
    pub fn original_cutoff(&self) -> Instant {
        self.cutoff
    }
}

#[cfg(test)]
#[path = "create_configuration_source_tests.rs"]
mod tests;
