//! Separate reservation ordering for every private credential mutator.
//! Exclusive ownership is a filesystem resource, never product authorization.
use super::*;
use anyhow::ensure;
use std::{
    ffi::{CString, OsStr},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
mod directory_cleanup;
mod files;
pub(super) use directory_cleanup::remove_empty_private_directory;
const GATE: &str = ".nac-bootstrap-slot.gate";
fn unavailable() -> anyhow::Error {
    anyhow!("credential slot reservation unavailable")
}
#[derive(PartialEq, Eq)]
struct Identity(u64, u64, u32, u32, u32);
fn identity(file: &File) -> Result<Identity> {
    let m = file.metadata()?;
    Ok(Identity(m.dev(), m.ino(), m.mode(), m.uid(), m.gid()))
}
fn name(value: &OsStr) -> Result<CString> {
    let bytes = value.as_bytes();
    ensure!(
        !bytes.is_empty() && bytes != b"." && bytes != b".." && !bytes.contains(&b'/'),
        "invalid credential component"
    );
    Ok(CString::new(bytes)?)
}
fn open(root: &File, value: &OsStr, flags: i32) -> Result<File> {
    let name = name(value)?;
    // SAFETY: the retained root is live, name is one owned NUL-terminated component.
    let fd = unsafe {
        libc::openat(
            root.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            0o600,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error().into());
    }
    // SAFETY: openat returned this fresh descriptor to its sole owner.
    let file = unsafe { File::from_raw_fd(fd) };
    Ok(file)
}
fn gate(root: &File) -> Result<File> {
    // Publish the first gate with exclusive creation. Concurrent first writers
    // then open that existing inode without a second nonexclusive create.
    let file = match open(
        root,
        OsStr::new(GATE),
        libc::O_RDWR | libc::O_CREAT | libc::O_EXCL,
    ) {
        Ok(file) => file,
        Err(error)
            if error
                .downcast_ref::<io::Error>()
                .is_some_and(|error| error.kind() == io::ErrorKind::AlreadyExists) =>
        {
            open(root, OsStr::new(GATE), libc::O_RDWR)?
        }
        Err(error) => return Err(error),
    };
    ensure_open_file_is_regular(&file, Path::new(GATE), "credential reservation")?;
    ensure!(
        file.metadata()?.nlink() == 1,
        "credential reservation is aliased"
    );
    ensure_open_credential_file_is_safe(&file, Path::new(GATE))?;
    Ok(file)
}
/// Shared nonblocking side, retained over a credential lock or direct mutation.
/// Failure never waits while the caller might hold SQL or another credential lock.
pub struct CredentialMutationGuard {
    root: File,
    gate: File,
    original: Identity,
}
impl CredentialMutationGuard {
    fn acquire(root: File) -> Result<Self> {
        let file = gate(&root)?;
        FileExt::try_lock_shared(&file).map_err(|_| unavailable())?;
        ensure!(file.metadata()?.len() == 0, "credential slot quarantined");
        let original = identity(&file)?;
        let guard = Self {
            root,
            gate: file,
            original,
        };
        guard.check_current()?;
        Ok(guard)
    }
    fn check_current(&self) -> Result<()> {
        ensure!(
            identity(&self.gate)? == self.original
                && identity(&gate(&self.root)?)? == self.original
                && self.gate.metadata()?.len() == 0,
            "credential slot reservation changed"
        );
        Ok(())
    }
}
/// Enter before a direct private-file mutation. Existing absent parents are not
/// created by removal; writers/lock acquisition create their parent first.
pub fn credential_mutation_guard(path: &Path) -> Result<Option<CredentialMutationGuard>> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let root = match File::open(parent) {
        Ok(root) => root,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    Ok(Some(CredentialMutationGuard::acquire(root)?))
}
/// SAME original selected directory and exclusive cross-process reservation.
/// Drop/expiry/cancellation leaves a durable quarantine marker. Only the known
/// original local import completion may call `finish_known_import`; bytes or a
/// reopened path cannot reconstruct this allocation after crash/restart.
/// ```compile_fail
/// fn cloneable<T: Clone>() {} cloneable::<nac_credential_store::CredentialSlotReservation>();
/// ```
pub struct CredentialSlotReservation {
    root: File,
    root_identity: Identity,
    gate: File,
    gate_identity: Identity,
    marker: Vec<u8>,
    process: u32,
    cutoff: Instant,
    denied: AtomicBool,
    finished: AtomicBool,
    operation: std::sync::Mutex<()>,
    phase: std::sync::Mutex<()>,
}
impl CredentialSlotReservation {
    pub fn capture(original_directory: &File, original_cutoff: Instant) -> Result<Self> {
        ensure!(
            Instant::now() < original_cutoff
                && original_cutoff.saturating_duration_since(Instant::now())
                    <= Duration::from_secs(60),
            "credential reservation cutoff invalid"
        );
        let root = original_directory.try_clone()?;
        let m = root.metadata()?;
        // SAFETY: geteuid has no pointers or preconditions.
        let uid = unsafe { libc::geteuid() };
        ensure!(
            m.is_dir() && m.uid() == uid && m.mode() & 0o022 == 0,
            "credential reservation directory unavailable"
        );
        let root_identity = identity(&root)?;
        let mut file = gate(&root)?;
        FileExt::try_lock_exclusive(&file).map_err(|_| unavailable())?;
        ensure!(file.metadata()?.len() == 0, "credential slot quarantined");
        let marker = format!("nac-bootstrap-slot.v1:{}\n", Uuid::new_v4()).into_bytes();
        file.write_all(&marker)?;
        file.sync_all()?;
        root.sync_all()?;
        let gate_identity = identity(&file)?;
        let owner = Self {
            root,
            root_identity,
            gate: file,
            gate_identity,
            marker,
            process: std::process::id(),
            cutoff: original_cutoff,
            denied: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            operation: std::sync::Mutex::new(()),
            phase: std::sync::Mutex::new(()),
        };
        owner.check_current()?;
        Ok(owner)
    }
    pub fn check_denial(&self) -> Result<()> {
        ensure!(
            self.process == std::process::id()
                && !self.denied.load(Ordering::Acquire)
                && (self.finished.load(Ordering::Acquire) || Instant::now() < self.cutoff),
            "credential reservation denied"
        );
        Ok(())
    }
    pub fn check_current(&self) -> Result<()> {
        let _phase = self.phase.lock().map_err(|_| unavailable())?;
        let result = (|| {
            self.check_denial()?;
            ensure!(
                identity(&self.root)? == self.root_identity
                    && identity(&self.gate)? == self.gate_identity
                    && identity(&gate(&self.root)?)? == self.gate_identity,
                "original credential reservation replaced"
            );
            let expected = if self.finished.load(Ordering::Acquire) {
                &[][..]
            } else {
                &self.marker[..]
            };
            let mut bytes = vec![0; expected.len() + 1];
            use std::os::unix::fs::FileExt as _;
            let len = self.gate.read_at(&mut bytes, 0)?;
            ensure!(&bytes[..len] == expected, "credential quarantine changed");
            self.check_denial()
        })();
        if result.is_err() {
            self.deny();
        }
        result
    }
    pub fn deny(&self) {
        self.denied.store(true, Ordering::Release);
    }
    pub fn original_cutoff(&self) -> Instant {
        self.cutoff
    }
    /// Short credential lock only. No remote/SQL operation belongs in this
    /// closure; it exists solely for atomic original-directory credential IO.
    pub fn with_credential_lock<T>(
        &self,
        lock_name: &OsStr,
        operation: impl FnOnce(&ReservedCredentialIo<'_>) -> Result<T>,
    ) -> Result<T> {
        // Before known import completion, contention is an unavailable one-shot
        // preparation. After completion this SAME resource serves ordinary
        // runtime key reads: serialize short IO just like the existing store,
        // off the async reactor, without reusing the old bootstrap clock.
        let completed = self.finished.load(Ordering::Acquire);
        let _operation = if completed {
            self.operation.lock().map_err(|_| unavailable())?
        } else {
            self.operation.try_lock().map_err(|_| unavailable())?
        };
        self.check_current()?;
        let shared = if completed {
            Some(CredentialMutationGuard::acquire(self.root.try_clone()?)?)
        } else {
            None
        };
        let lock = open(&self.root, lock_name, libc::O_RDWR | libc::O_CREAT)?;
        ensure_open_credential_file_is_safe(&lock, Path::new(lock_name))?;
        if completed {
            FileExt::lock_exclusive(&lock)?;
        } else {
            FileExt::try_lock_exclusive(&lock).map_err(|_| unavailable())?;
        }
        self.check_current()?;
        let result = operation(&ReservedCredentialIo(self));
        let checked = self.check_current();
        drop(lock);
        drop(shared);
        checked?;
        result
    }
    /// Known local negative before provider work can abandon a candidate. The
    /// Core owner never invokes this on unknown/cancelled/possibly-started work.
    pub fn finish_known_import(&self) -> Result<()> {
        let _operation = self.operation.try_lock().map_err(|_| unavailable())?;
        self.check_current()?;
        let _phase = self.phase.lock().map_err(|_| unavailable())?;
        ensure!(
            !self.finished.load(Ordering::Acquire),
            "credential reservation already retired"
        );
        self.gate.set_len(0)?;
        self.gate.sync_all()?;
        self.root.sync_all()?;
        self.finished.store(true, Ordering::Release);
        FileExt::unlock(&self.gate)?;
        Ok(())
    }
}
impl Drop for CredentialSlotReservation {
    fn drop(&mut self) {
        self.deny(); /* File drop closes only this process's reference; marker survives. */
    }
}

#[cfg(test)]
mod tests;

/// Explicit bounded IO borrow exists only while the original short credential
/// lock is held. It cannot escape that borrow or select another directory.
pub struct ReservedCredentialIo<'a>(&'a CredentialSlotReservation);
