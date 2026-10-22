//! Actual retained config publication lock and source custody, never admission.
//! Capture refuses unresolved publication; it performs no recovery or writes.
//! The genuine caller retains this SAME owner through unknown outcomes and
//! uses its captured bytes, avoiding a recursive ordinary config-lock read.
use super::*;
use crate::configuration_source_files::{name, Identity, ParentAnchor};
use anyhow::{ensure, Result};
use std::{
    ffi::CString,
    os::unix::fs::MetadataExt,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

fn image(file: &mut File) -> Result<(String, DocumentRevision)> {
    let metadata = file.metadata()?;
    let mut raw = Vec::new();
    file.read_to_end(&mut raw)?;
    let revision =
        DocumentRevision::recorded(Sha256::digest(&raw).into(), Some(file_identity(&metadata)));
    Ok((String::from_utf8(raw)?, revision))
}
fn unavailable() -> anyhow::Error {
    anyhow!("original config source unavailable")
}

fn source_lock_path(path: &Path) -> PathBuf {
    path.with_extension("toml.source-lock")
}
fn open_writer_fence(path: &Path) -> ConfigurationResult<File> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(source_lock_path(path))
        .map_err(|_| McpServerConfigurationStoreError::Store(unavailable()))?;
    let metadata = file
        .metadata()
        .map_err(|_| McpServerConfigurationStoreError::Store(unavailable()))?;
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(McpServerConfigurationStoreError::Store(unavailable()));
    }
    Ok(file)
}
// Legacy public mutation functions do not require a caller-held write lease.
// All actual publication paths therefore take this independent exclusive fence
// BEFORE recovery, temporary output or journal writes. The original source
// owners share its read side; no copied revision can bypass that custody.
pub(super) fn initialize_write_fence(path: &Path) -> ConfigurationResult<()> {
    open_writer_fence(path).map(drop)
}
pub(super) fn begin_write(path: &Path) -> ConfigurationResult<File> {
    let file = open_writer_fence(path)?;
    file.try_lock_exclusive()
        .map_err(|_| McpServerConfigurationStoreError::ConcurrentModification)?;
    Ok(file)
}
fn check_named_lock(
    anchor: &ParentAnchor,
    file: &File,
    name: &CString,
    identity: Identity,
) -> Result<()> {
    ensure!(
        Identity::read(file)? == identity,
        "original source lock changed"
    );
    let named = anchor
        .regular(name, libc::O_RDONLY)?
        .ok_or_else(unavailable)?;
    ensure!(
        Identity::read(&named)? == identity,
        "original source lock name changed"
    );
    Ok(())
}

/// Resource participant only. No Clone, Debug, serde, admission or release proof.
/// Actual directory/config/lock descriptors survive denial while this owner is
/// retained. Only bounded check_denial belongs inside store/credential locks.
/// Dropping custody is not authenticated settlement of any CREATE operation.
pub(crate) struct RetainedMcpConfiguration {
    lease: File,
    lock_identity: Identity,
    lock_name: CString,
    source_fence: File,
    source_fence_identity: Identity,
    source_fence_name: CString,
    journal_name: CString,
    anchor: ParentAnchor,
    config_name: CString,
    original_file: Option<File>,
    config_identity: Option<Identity>,
    revision: DocumentRevision,
    raw: String,
    cutoff: Instant,
    creator: u32,
    denied: AtomicBool,
}
impl RetainedMcpConfiguration {
    pub(crate) fn capture(path: &Path, cutoff: Instant) -> Result<Self> {
        let captured = (|| {
            ensure!(Instant::now() < cutoff, "source cutoff expired");
            let parent = path.parent().ok_or_else(unavailable)?;
            let anchor = ParentAnchor::capture(parent)?;
            let config_name = name(path.file_name().ok_or_else(unavailable)?)?;
            let source_fence_path = source_lock_path(path);
            let source_fence_name = name(source_fence_path.file_name().ok_or_else(unavailable)?)?;
            let source_fence = anchor
                .regular(&source_fence_name, libc::O_RDWR)?
                .ok_or_else(unavailable)?;
            ensure!(
                source_fence.metadata()?.mode() & 0o022 == 0,
                "source fence is writable by another principal"
            );
            FileExt::try_lock_shared(&source_fence)?;
            let source_fence_identity = Identity::read(&source_fence)?;
            let lock_path = path.with_extension("toml.lock");
            let lock_name = name(lock_path.file_name().ok_or_else(unavailable)?)?;
            // Startup establishes ordinary configuration lock resources.
            // Source capture never creates directories, locks or repairs config.
            let file = anchor
                .regular(&lock_name, libc::O_RDWR)?
                .ok_or_else(unavailable)?;
            ensure!(
                file.metadata()?.mode() & 0o022 == 0,
                "source lock is writable by another principal"
            );
            FileExt::try_lock_shared(&file)?; // no blocking wait, retry or renewed cutoff
            let lock_identity = Identity::read(&file)?;
            let lease = file;
            anchor.check()?;
            // Ordinary publication/recovery owns this journal. A protected
            // source capture cannot repair it before runtime/source admission.
            let marker = path.with_extension("toml.nac-txn");
            let marker_name = name(marker.file_name().ok_or_else(unavailable)?)?;
            ensure!(
                anchor.regular(&marker_name, libc::O_RDONLY)?.is_none(),
                "config publication is unresolved"
            );
            let mut original_file = anchor.regular(&config_name, libc::O_RDONLY)?;
            let config_identity = original_file.as_ref().map(Identity::read).transpose()?;
            let (raw, revision) = match &mut original_file {
                Some(file) => image(file)?,
                None => (String::new(), DocumentRevision::missing()),
            };
            let owner = Self {
                lease,
                lock_identity,
                lock_name,
                source_fence,
                source_fence_identity,
                source_fence_name,
                journal_name: marker_name,
                anchor,
                config_name,
                original_file,
                config_identity,
                revision,
                raw,
                cutoff,
                creator: std::process::id(),
                denied: AtomicBool::new(false),
            };
            owner.check_current()?;
            // The independent source fence excludes ALL publication/recovery
            // mutations. Retain this original legacy descriptor identity but
            // release its transient read lock before any caller can enqueue a
            // legacy data read on the same store executor. It is not a runtime
            // or source-terminal release; the actual source fence stays held.
            FileExt::unlock(&owner.lease)?;
            owner.check_current()?;
            Ok(owner)
        })();
        captured.map_err(|_: anyhow::Error| unavailable())
    }
    pub(crate) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    pub(crate) fn check_denial(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire)
            || self.creator != std::process::id()
            || Instant::now() >= self.cutoff
        {
            self.deny();
            return Err(unavailable());
        }
        Ok(())
    }
    pub(crate) fn home_identity(&self) -> Result<Identity> {
        self.check_denial()?;
        self.anchor.directory_identity()
    }
    pub(crate) fn raw(&self) -> Result<&str> {
        self.check_denial()?;
        Ok(&self.raw)
    }
    pub(crate) fn check_current(&self) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            self.anchor.check()?;
            check_named_lock(
                &self.anchor,
                &self.lease,
                &self.lock_name,
                self.lock_identity,
            )?;
            check_named_lock(
                &self.anchor,
                &self.source_fence,
                &self.source_fence_name,
                self.source_fence_identity,
            )?;
            ensure!(
                self.anchor
                    .regular(&self.journal_name, libc::O_RDONLY)?
                    .is_none(),
                "config publication is unresolved"
            );
            if let Some(file) = &self.original_file {
                ensure!(
                    Some(Identity::read(file)?) == self.config_identity,
                    "original config identity changed"
                );
            }
            let current = match self.anchor.regular(&self.config_name, libc::O_RDONLY)? {
                Some(mut file) => {
                    ensure!(
                        Some(Identity::read(&file)?) == self.config_identity,
                        "config name changed"
                    );
                    image(&mut file)?.1
                }
                None => DocumentRevision::missing(),
            };
            ensure!(current == self.revision, "original config bytes changed");
            self.anchor.check()?;
            self.check_denial()
        })();
        if checked.is_err() {
            self.deny();
        }
        checked.map_err(|_: anyhow::Error| unavailable())
    }
}
impl Drop for RetainedMcpConfiguration {
    fn drop(&mut self) {
        self.deny();
        // Closing our descriptor alone can leave the same open-file-description
        // lock alive in a child between fork and exec. The child cannot use this
        // PID-bound owner; explicitly retire its lock when actual custody ends.
        if self.creator == std::process::id() {
            let _ = FileExt::unlock(&self.source_fence);
        }
    }
}

#[cfg(test)]
#[path = "source_tests.rs"]
mod tests;
