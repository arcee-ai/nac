use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use fs2::FileExt;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) fn ensure_pre_branching_snapshot(source: &Connection, store_path: &Path) -> Result<()> {
    let (snapshot_path, digest_path) = crate::paths::pre_branching_snapshot_paths(store_path);
    let pinned_dir = snapshot_path
        .parent()
        .context("pre-branching snapshot has no parent directory")?;
    fs::create_dir_all(pinned_dir).with_context(|| {
        format!(
            "failed to create pinned backup directory {}",
            pinned_dir.display()
        )
    })?;
    set_private_dir_permissions(pinned_dir)?;

    // Serialize create-once publication across processes. The lock is metadata,
    // not part of the immutable snapshot pair.
    let lock_path = pinned_dir.join(".pre-branching.lock");
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("failed to open snapshot lock {}", lock_path.display()))?;
    set_private_file_permissions(&lock_path)?;
    lock.lock_exclusive()
        .with_context(|| format!("failed to lock {}", lock_path.display()))?;

    let result = if snapshot_path.exists() || digest_path.exists() {
        validate_snapshot_pair(&snapshot_path, &digest_path)
    } else {
        create_snapshot_pair(source, &snapshot_path, &digest_path)
    };
    FileExt::unlock(&lock).context("failed to unlock pre-branching snapshot lock")?;
    result
}

fn create_snapshot_pair(
    source: &Connection,
    snapshot_path: &Path,
    digest_path: &Path,
) -> Result<()> {
    let pinned_dir = snapshot_path.parent().unwrap();
    let unique = Uuid::new_v4();
    let temp_snapshot = pinned_dir.join(format!(".pre-branching-{unique}.db.tmp"));
    let temp_digest = pinned_dir.join(format!(".pre-branching-{unique}.sha256.tmp"));

    let result = (|| {
        let mut destination = Connection::open(&temp_snapshot).with_context(|| {
            format!(
                "failed to create temporary pre-branching snapshot {}",
                temp_snapshot.display()
            )
        })?;
        {
            let backup = Backup::new(source, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(25), None)?;
        }
        drop(destination);
        set_private_file_permissions(&temp_snapshot)?;
        validate_sqlite(&temp_snapshot)?;

        let digest = sha256_file(&temp_snapshot)?;
        let mut digest_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_digest)?;
        writeln!(digest_file, "{digest}")?;
        digest_file.sync_all()?;
        set_private_file_permissions(&temp_digest)?;

        // Hard links provide same-filesystem, atomic, no-clobber publication.
        fs::hard_link(&temp_snapshot, snapshot_path).with_context(|| {
            format!(
                "failed to publish create-once snapshot {}",
                snapshot_path.display()
            )
        })?;
        if let Err(error) = fs::hard_link(&temp_digest, digest_path) {
            // We created this link while holding the lock, so rollback is safe.
            let _ = fs::remove_file(snapshot_path);
            return Err(error).with_context(|| {
                format!(
                    "failed to publish snapshot digest {}",
                    digest_path.display()
                )
            });
        }
        validate_snapshot_pair(snapshot_path, digest_path)
    })();

    remove_temporary_database(&temp_snapshot);
    let _ = fs::remove_file(&temp_digest);
    result
}

fn validate_snapshot_pair(snapshot_path: &Path, digest_path: &Path) -> Result<()> {
    if !snapshot_path.is_file() || !digest_path.is_file() {
        bail!(
            "incomplete pre-branching snapshot: expected {} and {}",
            snapshot_path.display(),
            digest_path.display()
        );
    }
    validate_sqlite(snapshot_path)?;
    let expected = fs::read_to_string(digest_path)
        .with_context(|| format!("failed to read snapshot digest {}", digest_path.display()))?;
    let expected = expected.trim();
    let actual = sha256_file(snapshot_path)?;
    if expected != actual {
        bail!(
            "pre-branching snapshot digest mismatch for {}: expected {}, got {}",
            snapshot_path.display(),
            expected,
            actual
        );
    }
    Ok(())
}

fn validate_sqlite(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open snapshot {}", path.display()))?;
    let integrity: String = connection
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .with_context(|| format!("failed integrity check for {}", path.display()))?;
    if integrity != "ok" {
        bail!(
            "pre-branching snapshot {} failed integrity check: {}",
            path.display(),
            integrity
        );
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("failed to hash snapshot {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn remove_temporary_database(path: &Path) {
    let _ = fs::remove_file(path);
    let mut wal = PathBuf::from(path);
    wal.set_file_name(format!(
        "{}-wal",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    let mut shm = PathBuf::from(path);
    shm.set_file_name(format!(
        "{}-shm",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));
    for sidecar in [wal, shm] {
        if let Err(error) = fs::remove_file(sidecar) {
            if error.kind() != ErrorKind::NotFound {
                // Best-effort cleanup; the private temporary name is never reused.
            }
        }
    }
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_sidecar_publication_rolls_back_snapshot_link() {
        let root = std::env::temp_dir().join(format!("nac_backup_publish_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.db");
        let source = Connection::open(&source_path).unwrap();
        source
            .execute_batch("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('safe');")
            .unwrap();
        let snapshot = root.join("published.db");
        let digest_as_directory = root.join("digest-target");
        fs::create_dir(&digest_as_directory).unwrap();

        let error = create_snapshot_pair(&source, &snapshot, &digest_as_directory).unwrap_err();
        assert!(error
            .to_string()
            .contains("failed to publish snapshot digest"));
        assert!(!snapshot.exists());

        drop(source);
        let _ = fs::remove_dir_all(root);
    }
}
