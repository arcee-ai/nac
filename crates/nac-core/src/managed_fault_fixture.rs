//! One-shot controls for a private ALL-117 fault image. Absent from normal builds.
//! Controls and reached receipts live in an owner-only ephemeral directory,
//! outside the SQLite store. They grant no admission or store authority.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{ensure, Context, Result};
use cap_std::fs::{Dir, MetadataExt, OpenOptions, OpenOptionsExt};
use serde::{Deserialize, Serialize};

pub const CONTROL_ROOT_ENV: &str = "NAC_MANAGED_FAULT_ROOT";
const MAX_CONTROL_BYTES: u64 = 4096;
const MAX_ARM_WINDOW_MS: u64 = 20_000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Boundary {
    CommitAck,
    MonitorRead,
}

impl Boundary {
    fn control_file(self) -> &'static str {
        match self {
            Self::CommitAck => "commit-ack.json",
            Self::MonitorRead => "monitor-read.json",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Control {
    nonce: String,
    boundary: Boundary,
    session_id: String,
    run_id: Option<String>,
    generation: Option<u64>,
    expires_unix_ms: u64,
}

#[derive(Serialize)]
struct ReachedReceipt<'a> {
    nonce: &'a str,
    boundary: Boundary,
    session_id: &'a str,
    run_id: Option<&'a str>,
    generation: Option<u64>,
    reached_unix_ms: u64,
    process_id: u32,
    after_successful_sqlite_commit: bool,
}

fn clock_ms() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn configured_root() -> Result<Option<PathBuf>> {
    let Some(root) = std::env::var_os(CONTROL_ROOT_ENV).map(PathBuf::from) else {
        return Ok(None);
    };
    ensure!(
        root.parent() == Some(Path::new("/tmp")),
        "fault root must be directly under /tmp"
    );
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let nonce = name
        .strip_prefix("all117-fault-")
        .context("invalid fault root name")?;
    let uuid = uuid::Uuid::parse_str(nonce).context("invalid fault root nonce")?;
    ensure!(
        uuid.to_string() == nonce,
        "fault root nonce must be canonical"
    );
    Ok(Some(root))
}

pub fn validate_environment() -> Result<()> {
    let _ = configured_root()?;
    Ok(())
}

/// Called only at the two existing fault boundaries in a feature-gated image.
/// A permanent create-new receipt reserves the nonce before returning a fault.
pub fn hit(
    boundary: Boundary,
    session_id: &str,
    run_id: Option<&str>,
    generation: Option<u64>,
) -> Result<bool> {
    match configured_root()? {
        Some(root) => hit_in_root(&root, boundary, session_id, run_id, generation),
        None => Ok(false),
    }
}

fn hit_in_root(
    root: &Path,
    boundary: Boundary,
    session_id: &str,
    run_id: Option<&str>,
    generation: Option<u64>,
) -> Result<bool> {
    use std::os::unix::fs::MetadataExt as StdMetadataExt;
    let metadata = match std::fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    // SAFETY: geteuid has no arguments, pointers or side effects.
    let uid = unsafe { libc::geteuid() };
    ensure!(
        metadata.is_dir()
            && !metadata.file_type().is_symlink()
            && metadata.uid() == uid
            && metadata.mode() & 0o7777 == 0o700,
        "fault root is not a private owned directory"
    );
    let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
    let bound = directory.dir_metadata()?;
    ensure!(
        metadata.dev() == bound.dev() && metadata.ino() == bound.ino(),
        "fault directory changed during open"
    );
    let before = match directory.symlink_metadata(boundary.control_file()) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        before.is_file() && !before.file_type().is_symlink(),
        "fault control must be a regular non-symlink file"
    );
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let mut file = match directory.open_with(boundary.control_file(), &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let metadata = file.metadata()?;
    let after = directory.symlink_metadata(boundary.control_file())?;
    ensure!(
        before.dev() == metadata.dev()
            && before.ino() == metadata.ino()
            && after.is_file()
            && !after.file_type().is_symlink()
            && after.dev() == metadata.dev()
            && after.ino() == metadata.ino(),
        "fault control changed during open"
    );
    ensure!(
        metadata.is_file()
            && metadata.uid() == uid
            && metadata.mode() & 0o7777 == 0o600
            && metadata.nlink() == 1
            && metadata.len() <= MAX_CONTROL_BYTES,
        "fault control is not a bounded private owned file"
    );
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_CONTROL_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_CONTROL_BYTES,
        "fault control is too large"
    );
    let control: Control = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("invalid private fault control"))?;
    let nonce = uuid::Uuid::parse_str(&control.nonce).context("invalid fault nonce")?;
    ensure!(
        nonce.to_string() == control.nonce,
        "fault nonce must be canonical"
    );
    ensure!(
        control.session_id.len() <= 128 && !control.session_id.is_empty(),
        "invalid fault session identity"
    );
    ensure!(
        control.boundary == boundary,
        "fault control boundary mismatch"
    );
    match boundary {
        Boundary::CommitAck => ensure!(
            control
                .run_id
                .as_ref()
                .is_some_and(|run| !run.is_empty() && run.len() <= 128),
            "commit-ack fault requires an exact run"
        ),
        Boundary::MonitorRead => ensure!(
            control.run_id.is_none() && control.generation.is_some(),
            "monitor fault requires an exact generation"
        ),
    }
    let now = clock_ms()?;
    if control.expires_unix_ms < now
        || control.expires_unix_ms.saturating_sub(now) > MAX_ARM_WINDOW_MS
        || control.session_id != session_id
        || control.run_id.as_deref() != run_id
        || control.generation != generation
    {
        return Ok(false);
    }
    let receipt = ReachedReceipt {
        nonce: &control.nonce,
        boundary,
        session_id,
        run_id,
        generation,
        reached_unix_ms: now,
        process_id: std::process::id(),
        after_successful_sqlite_commit: boundary == Boundary::CommitAck,
    };
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW);
    let mut reached = match directory.open_with(format!("used-{}.json", control.nonce), &options) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let serialized = serde_json::to_string(&receipt)?;
    reached.write_all(serialized.as_bytes())?;
    reached.write_all(b"\n")?;
    reached.sync_all()?;
    eprintln!("nac-managed-fault-reached {serialized}");
    Ok(true)
}

#[cfg(test)]
mod tests;
