//! Original global configuration directory resources captured at startup.
//! No file contents, keys, processes, MCP transport or execution authority.
use crate::{
    configuration_source_files::{DirectoryPath, Identity},
    paths::PathContext,
};
use anyhow::{anyhow, ensure, Result};
use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

fn unavailable() -> anyhow::Error {
    anyhow!("global preparation source unavailable")
}
struct Root {
    configured: Option<DirectoryPath>,
}
impl Root {
    fn capture(path: Option<PathBuf>) -> Result<Self> {
        Ok(Self {
            configured: path.as_deref().map(DirectoryPath::capture).transpose()?,
        })
    }
    fn check(&self) -> Result<()> {
        if let Some(root) = &self.configured {
            root.check()?;
        }
        Ok(())
    }
    fn child(&self, path: &Path) -> Result<Option<DirectoryPath>> {
        self.configured
            .as_ref()
            .map(|root| root.descend(path))
            .transpose()
    }
}

/// Original HOME/NAC_HOME directory custody. Resource-only: neither a path nor
/// a descriptor/check grants preparation IO, CREATE, Ready or runtime effects.
/// Capture once at the trusted startup/factory boundary, before accepting work;
/// retain the SAME Arc through each actual preparation and unknown outcome.
/// Missing configured directories are bound as absence, never created/repaired.
/// ```compile_fail
/// fn needs_clone<T: Clone>() {}
/// needs_clone::<nac_core::runtime::CreateGlobalSourceRoots>();
/// ```
/// ```compile_fail
/// fn serialize(value: &nac_core::runtime::CreateGlobalSourceRoots) {
///     let _ = serde_json::to_vec(value);
/// }
/// ```
pub struct CreateGlobalSourceRoots {
    paths: PathContext,
    nac_home: Root,
    home: Root,
    creator: u32,
    denied: AtomicBool,
}
impl CreateGlobalSourceRoots {
    /// Sample the established PathContext precedence ONCE. Later CREATE calls
    /// cannot change this selection by modifying ambient HOME/NAC_HOME/XDG.
    pub fn capture(config_cwd: &Path) -> Result<Self> {
        ensure!(
            config_cwd.is_absolute(),
            "global source configuration cwd unavailable"
        );
        Self::capture_selected(PathContext::new(config_cwd).freeze_globals())
    }
    fn capture_selected(paths: PathContext) -> Result<Self> {
        let captured = (|| {
            let nac_home = Root::capture(paths.nac_home_dir())?;
            let home = Root::capture(paths.home_dir())?;
            let owner = Self {
                paths,
                nac_home,
                home,
                creator: std::process::id(),
                denied: AtomicBool::new(false),
            };
            owner.check_current()?;
            Ok(owner)
        })();
        captured.map_err(|_: anyhow::Error| unavailable())
    }
    pub(crate) fn original_nac_home_directory(&self) -> Result<(&File, &Path)> {
        self.check_current()?;
        let root = self.nac_home.configured.as_ref().ok_or_else(unavailable)?;
        Ok((root.directory()?.ok_or_else(unavailable)?, root.path()))
    }
    pub fn check_denial(&self) -> Result<()> {
        if self.creator != std::process::id() || self.denied.load(Ordering::Acquire) {
            self.deny();
            return Err(unavailable());
        }
        Ok(())
    }
    pub fn check_current(&self) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            self.nac_home.check()?;
            self.home.check()?;
            self.check_denial()
        })();
        if checked.is_err() {
            self.deny();
        }
        checked.map_err(|_: anyhow::Error| unavailable())
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    /// Capture preparation directory names/absence under these SAME original
    /// startup roots and the supplied original CREATE clock. No IO grant or
    /// renewed host/CREATE eligibility is created by this resource participant.
    pub fn for_preparation(
        self: &Arc<Self>,
        original_cutoff: Instant,
    ) -> Result<CreateGlobalPreparationSource> {
        let captured = (|| {
            self.check_current()?;
            ensure!(
                Instant::now() < original_cutoff,
                "global preparation cutoff expired"
            );
            let mut skills = Vec::new();
            // Reuse the exact existing global-root mapping/precedence. Dedup
            // follows ordinary skill discovery, without consulting live env.
            let mut seen = std::collections::HashSet::new();
            for source in crate::skills::configured_global_sources(&self.paths) {
                if !seen.insert(source.host_root.clone()) {
                    continue;
                }
                let base = if source.precedence == 2 {
                    &self.nac_home
                } else {
                    &self.home
                };
                let base_path = base.configured.as_ref().ok_or_else(unavailable)?.path();
                let relative = source.host_root.strip_prefix(base_path)?;
                skills.push(base.child(relative)?.ok_or_else(unavailable)?);
            }
            let prepared = CreateGlobalPreparationSource {
                original: Arc::clone(self),
                skills,
                cutoff: original_cutoff,
                denied: AtomicBool::new(false),
            };
            prepared.check_current()?;
            Ok(prepared)
        })();
        captured.map_err(|_: anyhow::Error| unavailable())
    }
}
impl Drop for CreateGlobalSourceRoots {
    fn drop(&mut self) {
        self.deny();
    }
}

/// SAME retained startup roots and per-preparation directory/absence resources.
/// This participant retains no file bytes or authorization and never runs a
/// loader/transport. The genuine builder must keep it while consuming permitted
/// AGENTS/skill reads and must check physical currentness outside Core locks.
/// ```compile_fail
/// fn needs_clone<T: Clone>() {}
/// needs_clone::<nac_core::runtime::CreateGlobalPreparationSource>();
/// ```
pub struct CreateGlobalPreparationSource {
    original: Arc<CreateGlobalSourceRoots>,
    skills: Vec<DirectoryPath>,
    cutoff: Instant,
    denied: AtomicBool,
}
impl CreateGlobalPreparationSource {
    pub(in crate::runtime) fn original_skill_roots(&self) -> Result<Vec<DirectoryPath>> {
        self.check_current()?;
        self.skills
            .iter()
            .map(|root| root.descend(Path::new("")))
            .collect()
    }
    pub fn check_denial(&self) -> Result<()> {
        self.original.check_denial()?;
        if self.denied.load(Ordering::Acquire) || Instant::now() >= self.cutoff {
            self.deny();
            return Err(unavailable());
        }
        Ok(())
    }
    pub fn check_current(&self) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            self.original.check_current()?;
            for source in &self.skills {
                source.check()?;
            }
            self.check_denial()
        })();
        if checked.is_err() {
            self.deny();
        }
        checked.map_err(|_: anyhow::Error| unavailable())
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    pub fn original_cutoff(&self) -> Instant {
        self.cutoff
    }
    /// Configured paths/absence are DATA, not replacement owners or IO grants.
    pub fn global_agents_root(&self) -> Result<Option<&Path>> {
        self.check_denial()?;
        Ok(self
            .original
            .nac_home
            .configured
            .as_ref()
            .map(DirectoryPath::path))
    }
    pub fn global_skill_roots(&self) -> Result<Vec<&Path>> {
        self.check_denial()?;
        Ok(self.skills.iter().map(DirectoryPath::path).collect())
    }
    pub(crate) fn path_context(&self) -> Result<&PathContext> {
        self.check_denial()?;
        Ok(&self.original.paths)
    }
    pub(crate) fn nac_home_identity(&self) -> Result<Option<Identity>> {
        self.check_denial()?;
        self.nac_home_directory()?.map(Identity::read).transpose()
    }
    /// Borrow the SAME actual directory resource only. No open by name or file
    /// read occurs here; actual consuming IO still requires its separate scope.
    fn nac_home_directory(&self) -> Result<Option<&File>> {
        self.check_denial()?;
        self.original
            .nac_home
            .configured
            .as_ref()
            .map(DirectoryPath::directory)
            .transpose()
            .map(Option::flatten)
    }
}
impl Drop for CreateGlobalPreparationSource {
    fn drop(&mut self) {
        self.deny();
    }
}

#[cfg(test)]
#[path = "create_global_source_tests.rs"]
mod tests;
