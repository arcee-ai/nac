use crate::{configuration::hex, Configuration, DeploymentScope};
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, Metadata, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    time::Duration,
};
use tokio::{sync::Notify, time::Instant};

const MAX_FILE: u64 = 64 * 1024;

/// Trusted STARTUP inputs, independently selected by the operator/composition.
/// They must not be learned from the file/request to make a comparison pass.
/// Like all policy data, these pins alone do not authorize runtime effects.
#[derive(Clone)]
pub struct PolicyPins {
    pub policy_id: String,
    pub revision: u64,
    pub sha256: String,
    pub scope: DeploymentScope,
}

#[derive(PartialEq, Eq)]
struct FileIdentity {
    dev: u64,
    ino: u64,
    uid: u32,
    mode: u32,
    len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}
impl FileIdentity {
    fn capture(meta: &Metadata) -> Result<Self> {
        // SAFETY: geteuid only observes this process's effective identity.
        let uid = unsafe { libc::geteuid() };
        ensure!(
            meta.is_file()
                && (meta.uid() == 0 || meta.uid() == uid)
                && meta.mode() & 0o222 == 0
                && meta.len() <= MAX_FILE,
            "capacity policy unavailable"
        );
        Ok(Self {
            dev: meta.dev(),
            ino: meta.ino(),
            uid: meta.uid(),
            mode: meta.mode(),
            len: meta.len(),
            modified: (meta.mtime(), meta.mtime_nsec()),
            changed: (meta.ctime(), meta.ctime_nsec()),
        })
    }
}

/// Original retained, immutable operator configuration source. Not serializable
/// or cloneable; Arc copies retain this same allocation/process/cutoff. It has
/// no constructor from a DTO and cannot construct a Core ledger or boundary.
///
/// ```compile_fail
/// use nac_capacity_policy::PolicySource;
/// let _: PolicySource = serde_json::from_str("{}").unwrap();
/// ```
/// ```compile_fail
/// use nac_capacity_policy::PolicySource;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<PolicySource>();
/// ```
pub struct PolicySource {
    config: Configuration,
    hash: String,
    path: PathBuf,
    file: File,
    identity: FileIdentity,
    process: u32,
    cutoff: Mutex<Instant>,
    retired: AtomicBool,
    changed: Notify,
}
pub struct PolicyRetirement(Weak<PolicySource>);
/// Unique original configuration owner. Its Drop denies every retained view;
/// views keep storage/provenance alive, never the right to continue admission.
pub struct PolicyOwner(Arc<PolicySource>);
impl PolicyOwner {
    pub fn source(&self) -> Arc<PolicySource> {
        Arc::clone(&self.0)
    }
    pub fn retirement(&self) -> PolicyRetirement {
        self.0.retirement()
    }
}
impl std::ops::Deref for PolicyOwner {
    type Target = PolicySource;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl Drop for PolicyOwner {
    fn drop(&mut self) {
        self.0.retire();
    }
}
impl PolicyRetirement {
    /// Denial only. Does not prove process cleanup, join or loan settlement.
    pub fn retire(&self) {
        if let Some(source) = self.0.upgrade() {
            source.retire();
        }
    }
}

impl PolicySource {
    /// The cutoff is the original owner's existing monotonic instant. It is
    /// a bound, NOT proof that a genuine lifecycle lease exists. Core's actual
    /// private composition must retain/check that real owner independently.
    pub fn load_file(
        path: &Path,
        pins: &PolicyPins,
        original_cutoff: std::time::Instant,
    ) -> Result<PolicyOwner> {
        ensure!(
            path.is_absolute() && hex(&pins.sha256, 64, 64),
            "capacity policy unavailable"
        );
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(path)
            .context("capacity policy unavailable")?;
        let before = FileIdentity::capture(&file.metadata()?)?;
        let mut raw = Vec::new();
        (&file).take(MAX_FILE + 1).read_to_end(&mut raw)?;
        ensure!(
            raw.len() as u64 <= MAX_FILE
                && !raw.is_empty()
                && FileIdentity::capture(&file.metadata()?)? == before,
            "capacity policy unavailable"
        );
        let hash = format!("{:x}", Sha256::digest(&raw));
        ensure!(hash == pins.sha256, "capacity policy unavailable");
        let config: Configuration =
            serde_json::from_slice(&raw).context("capacity policy unavailable")?;
        config.validate_data()?;
        ensure!(
            config.policy_id == pins.policy_id
                && config.revision == pins.revision
                && config.scope == pins.scope,
            "capacity policy unavailable"
        );
        let cutoff = Instant::from_std(original_cutoff);
        ensure!(Instant::now() < cutoff, "capacity policy unavailable");
        let source = Arc::new(Self {
            config,
            hash,
            path: path.to_owned(),
            file,
            identity: before,
            process: std::process::id(),
            cutoff: Mutex::new(cutoff),
            retired: AtomicBool::new(false),
            changed: Notify::new(),
        });
        source.check_current()?;
        Ok(PolicyOwner(source))
    }
    pub fn configuration(&self) -> Result<&Configuration> {
        self.check_current()?;
        Ok(&self.config)
    }
    pub fn sha256(&self) -> &str {
        &self.hash
    }
    pub fn creator_process(&self) -> u32 {
        self.process
    }
    pub fn retirement(self: &Arc<Self>) -> PolicyRetirement {
        PolicyRetirement(Arc::downgrade(self))
    }
    /// Only tightens the REAL original lease's cutoff. This does not issue or
    /// consume that lease; the genuine Core composition must retain both owners.
    pub fn cutoff(&self, original: std::time::Instant) -> std::time::Instant {
        original.min(self.retained_cutoff().into_std())
    }
    /// Bounded original-owner vetoes only. This does not check filesystem
    /// identity or substitute for check_current() before a physical effect.
    pub fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.retired.load(Ordering::Acquire)
                && self.process == std::process::id()
                && Instant::now() < self.retained_cutoff(),
            "capacity policy unavailable"
        );
        Ok(())
    }
    pub fn check_current(&self) -> Result<()> {
        let checked: Result<()> = (|| {
            self.check_denial()?;
            ensure!(
                FileIdentity::capture(&self.file.metadata()?)? == self.identity
                    && FileIdentity::capture(&std::fs::symlink_metadata(&self.path)?)?
                        == self.identity,
                "capacity policy unavailable"
            );
            Ok(())
        })();
        if checked.is_err() {
            self.retire();
        }
        checked
    }
    pub async fn retired(&self) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_current().is_err() {
                return;
            }
            // Recheck metadata at most one second after an unannounced file
            // replacement; no reload, recapture or fresh acceptance budget.
            let cutoff = self.retained_cutoff();
            tokio::select! {
                _ = &mut changed => {},
                _ = tokio::time::sleep_until(cutoff) => {},
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    }
    /// Denial-only tightening from the actual original owner. A later instant
    /// is inert; loading/retrying never starts a new budget.
    pub fn tighten_cutoff(&self, original: std::time::Instant) {
        let changed = {
            let mut cutoff = self
                .cutoff
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let next = (*cutoff).min(Instant::from_std(original));
            let changed = next < *cutoff;
            *cutoff = next;
            changed
        };
        if changed {
            self.changed.notify_waiters();
        }
    }
    fn retained_cutoff(&self) -> Instant {
        *self
            .cutoff
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn retire(&self) {
        if !self.retired.swap(true, Ordering::AcqRel) {
            self.changed.notify_waiters();
        }
    }
}
