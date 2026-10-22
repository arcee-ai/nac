//! Actual catalog source custody. A captured catalog is DATA, never admission.
use super::*;
use crate::configuration_source_files::{name, DirectoryFence, Identity, ParentAnchor};
use anyhow::{anyhow, ensure, Result};
use sha2::{Digest, Sha256};
use std::{
    ffi::{CString, OsStr},
    fs::File,
    io::Read,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

const LAYERS: [&str; 4] = [
    "models.json",
    "overlay.json",
    "arcee-overlay.json",
    "anthropic-overlay.json",
];
fn unavailable() -> anyhow::Error {
    anyhow!("CREATE catalog source unavailable")
}
struct SourceFile {
    name: CString,
    original: Option<File>,
    identity: Option<Identity>,
    digest: Option<[u8; 32]>,
    raw: Option<String>,
}
impl SourceFile {
    fn capture(anchor: Option<&ParentAnchor>, component: &str) -> Result<Self> {
        let name = name(OsStr::new(component))?;
        let mut original = match anchor {
            Some(anchor) => anchor.regular(&name, libc::O_RDONLY)?,
            None => None,
        };
        let identity = original.as_ref().map(Identity::read).transpose()?;
        let mut raw = None;
        let mut digest = None;
        if let Some(file) = &mut original {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)?;
            digest = Some(Sha256::digest(&bytes).into());
            raw = Some(String::from_utf8(bytes)?);
        }
        Ok(Self {
            name,
            original,
            identity,
            digest,
            raw,
        })
    }
    fn check(&self, anchor: Option<&ParentAnchor>) -> Result<()> {
        if let Some(original) = &self.original {
            ensure!(
                Some(Identity::read(original)?) == self.identity,
                "catalog file changed"
            );
        }
        let current = match anchor {
            Some(anchor) => anchor.regular(&self.name, libc::O_RDONLY)?,
            None => None,
        };
        let Some(mut current) = current else {
            ensure!(self.identity.is_none(), "catalog file missing");
            return Ok(());
        };
        ensure!(
            Some(Identity::read(&current)?) == self.identity,
            "catalog name changed"
        );
        let mut bytes = Vec::new();
        current.read_to_end(&mut bytes)?;
        ensure!(
            Some(<[u8; 32]>::from(Sha256::digest(&bytes))) == self.digest,
            "catalog bytes changed"
        );
        ensure!(
            Some(Identity::read(&current)?) == self.identity,
            "catalog file changed"
        );
        Ok(())
    }
}

/// Retains the original home, optional catalog directory, and all four source
/// files (including absence), plus a shared fence used by every cache publisher.
/// Configuration/model access is bounded; physical checks belong outside SQL
/// and credential locks. No file is created, repaired or reopened for parsing.
///
/// ```compile_fail
/// fn needs_clone<T: Clone>() {}
/// needs_clone::<nac_core::runtime::CreateModelCatalogSource>();
/// ```
/// ```compile_fail
/// fn needs_debug<T: std::fmt::Debug>() {}
/// needs_debug::<nac_core::runtime::CreateModelCatalogSource>();
/// ```
/// ```compile_fail
/// fn needs_serialize<T: serde::Serialize>() {}
/// needs_serialize::<nac_core::runtime::CreateModelCatalogSource>();
/// ```
pub struct CreateModelCatalogSource {
    fence: DirectoryFence,
    catalog_directory: Option<ParentAnchor>,
    files: [SourceFile; 4],
    catalog: ModelCatalog,
    cutoff: Instant,
    creator: u32,
    denied: AtomicBool,
}
impl CreateModelCatalogSource {
    pub fn capture(home: &Path, original_cutoff: Instant) -> Result<Self> {
        let result = (|| {
            ensure!(Instant::now() < original_cutoff, "catalog cutoff expired");
            let fence = DirectoryFence::shared(home)?;
            let catalog_directory = fence.anchor().child(&name(OsStr::new("model-catalog"))?)?;
            let files = [
                SourceFile::capture(Some(fence.anchor()), LAYERS[0])?,
                SourceFile::capture(catalog_directory.as_ref(), LAYERS[1])?,
                SourceFile::capture(catalog_directory.as_ref(), LAYERS[2])?,
                SourceFile::capture(catalog_directory.as_ref(), LAYERS[3])?,
            ];
            let catalog = ModelCatalog::from_captured_layers(
                home,
                files.each_ref().map(|f| f.raw.as_deref()),
            );
            let owner = Self {
                fence,
                catalog_directory,
                files,
                catalog,
                cutoff: original_cutoff,
                creator: std::process::id(),
                denied: AtomicBool::new(false),
            };
            owner.check_current()?;
            Ok(owner)
        })();
        result.map_err(|_: anyhow::Error| unavailable())
    }
    fn check_denial(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire)
            || self.creator != std::process::id()
            || Instant::now() >= self.cutoff
        {
            self.deny();
            return Err(unavailable());
        }
        Ok(())
    }
    pub(crate) fn catalog(&self) -> Result<&ModelCatalog> {
        self.check_denial()?;
        Ok(&self.catalog)
    }
    pub fn check_current(&self) -> Result<()> {
        let result = (|| {
            self.check_denial()?;
            self.fence.anchor().check()?;
            match &self.catalog_directory {
                Some(anchor) => anchor.check()?,
                None => ensure!(
                    self.fence
                        .anchor()
                        .child(&name(OsStr::new("model-catalog"))?)?
                        .is_none(),
                    "catalog directory appeared"
                ),
            }
            self.files[0].check(Some(self.fence.anchor()))?;
            for file in &self.files[1..] {
                file.check(self.catalog_directory.as_ref())?;
            }
            self.fence.anchor().check()?;
            self.check_denial()
        })();
        if result.is_err() {
            self.deny();
        }
        result.map_err(|_: anyhow::Error| unavailable())
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    pub(crate) fn home_identity(&self) -> Result<Identity> {
        self.check_denial()?;
        self.fence.anchor().directory_identity()
    }
    pub fn original_cutoff(&self) -> Instant {
        self.cutoff
    }
}
impl Drop for CreateModelCatalogSource {
    fn drop(&mut self) {
        self.deny();
    }
}

/// Ordinary refresh owns this fence before creating any catalog directory,
/// temporary output or sidecar. Missing home creation is ordinary startup work;
/// protected capture never invokes this function or creates a path.
pub(super) fn begin_publication(path: &Path) -> std::io::Result<DirectoryFence> {
    let home = path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| std::io::Error::other("catalog home unavailable"))?;
    std::fs::create_dir_all(home)?;
    let home = home.canonicalize()?;
    DirectoryFence::exclusive(&home).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::WouldBlock,
            "catalog publication unavailable",
        )
    })
}
