//! Immutable expected context for one original startup attempt. Operator input
//! and clock observations confer no import, source, Ready or runtime authority.
use anyhow::{bail, Context, Result};
use nac_managed::ImportOriginalContext;
use std::{
    fs::OpenOptions,
    io::Read,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::time::Instant;
use uuid::Uuid;

const MAX_CONTEXT_BYTES: u64 = 65_536;

/// One retained snapshot and conservative original clock pair. This owner is
/// intentionally neither cloneable nor deserializable. Its getters are only
/// expectations for later authenticated proof/loan composition.
pub struct InitialEnrollmentContext {
    context: ImportOriginalContext,
    attempt_id: Uuid,
    start: Instant,
    utc: SystemTime,
    deadline: Instant,
}

impl InitialEnrollmentContext {
    pub fn load(path: &Path) -> Result<Self> {
        // Capture before file I/O or any D/Root wait, with monotonic first so
        // sampling latency cannot enlarge the original UTC-derived budget.
        let start = Instant::now();
        let utc = SystemTime::now();
        Self::load_at(path, start, utc)
    }

    fn load_at(path: &Path, start: Instant, utc: SystemTime) -> Result<Self> {
        let raw = read_context(path)?;
        let context: ImportOriginalContext =
            serde_json::from_slice(&raw).context("invalid initial enrollment context")?;
        context.validate()?;
        let expiry = UNIX_EPOCH
            .checked_add(Duration::from_millis(
                context.source_expires_at_unix_ms.try_into()?,
            ))
            .context("initial enrollment source expiry overflow")?;
        if utc <= UNIX_EPOCH {
            bail!("initial enrollment original UTC is unavailable");
        }
        let remaining = expiry
            .duration_since(utc)
            .context("initial enrollment source expectation expired")?;
        let budget = remaining.min(Duration::from_millis(
            context.max_exchange_duration_ms.try_into()?,
        ));
        let deadline = start
            .checked_add(budget)
            .context("initial enrollment original deadline overflow")?;
        let snapshot = Self {
            context,
            attempt_id: Uuid::new_v4(),
            start,
            utc,
            deadline,
        };
        snapshot.check_current()?;
        Ok(snapshot)
    }

    pub fn context(&self) -> &ImportOriginalContext {
        &self.context
    }

    pub fn attempt_id(&self) -> Uuid {
        self.attempt_id
    }

    pub fn deadline(&self) -> Instant {
        self.deadline
    }

    pub(crate) fn original_clock(&self) -> (Instant, SystemTime) {
        (self.start, self.utc)
    }

    pub fn check_current(&self) -> Result<()> {
        if Instant::now() >= self.deadline {
            bail!("initial enrollment original deadline expired");
        }
        Ok(())
    }
}

fn read_context(path: &Path) -> Result<Vec<u8>> {
    if !path.is_absolute() {
        bail!("initial enrollment context path must be absolute");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .context("cannot open initial enrollment context")?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_CONTEXT_BYTES {
        bail!("initial enrollment context must be a nonempty regular file of at most 64 KiB");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: geteuid only observes the current process identity.
        let current_uid = unsafe { libc::geteuid() };
        if ![0, current_uid].contains(&metadata.uid()) || metadata.mode() & 0o022 != 0 {
            bail!("initial enrollment context has unsafe ownership or permissions");
        }
    }
    let mut raw = Vec::new();
    file.take(MAX_CONTEXT_BYTES + 1).read_to_end(&mut raw)?;
    if raw.is_empty() || raw.len() as u64 > MAX_CONTEXT_BYTES {
        bail!("initial enrollment context is empty or exceeds 64 KiB");
    }
    Ok(raw)
}

#[cfg(test)]
#[path = "initial_enrollment_tests.rs"]
mod tests;
