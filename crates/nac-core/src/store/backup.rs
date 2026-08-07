use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use fs2::FileExt;
use rusqlite::{backup::Backup, Connection, OpenFlags};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Fixed, non-rotating files that preserve the first store requiring a migration.
pub fn pinned_backup_paths(store_path: &Path) -> (PathBuf, PathBuf) {
    let store_dir = store_path.parent().unwrap_or_else(|| Path::new("."));
    let pinned_dir = store_dir.join("backups").join("pinned");
    (
        pinned_dir.join("pre-migration.db"),
        pinned_dir.join("pre-migration.sha256"),
    )
}

/// Create the pinned online backup once, or validate the already-published pair.
///
/// Publication is serialized and no-clobber. A partial or invalid existing pair
/// is an error: migration must stop rather than silently replacing evidence.
pub(crate) fn ensure_pinned_backup(source: &Connection, store_path: &Path) -> Result<()> {
    let (backup_path, digest_path) = pinned_backup_paths(store_path);
    let pinned_dir = backup_path
        .parent()
        .context("pinned backup has no parent")?;
    fs::create_dir_all(pinned_dir).with_context(|| {
        format!(
            "failed to create pinned backup dir {}",
            pinned_dir.display()
        )
    })?;
    set_private_dir_permissions(pinned_dir)?;

    let lock_path = pinned_dir.join(".pre-migration.lock");
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("failed to open backup lock {}", lock_path.display()))?;
    set_private_file_permissions(&lock_path)?;
    lock.lock_exclusive()
        .with_context(|| format!("failed to lock {}", lock_path.display()))?;

    let result = if backup_path.exists() || digest_path.exists() {
        validate_backup_pair(&backup_path, &digest_path)
    } else {
        create_backup_pair(source, &backup_path, &digest_path)
    };
    FileExt::unlock(&lock).context("failed to unlock pinned backup lock")?;
    result
}

fn create_backup_pair(source: &Connection, backup_path: &Path, digest_path: &Path) -> Result<()> {
    let pinned_dir = backup_path.parent().expect("backup parent checked");
    let unique = Uuid::new_v4();
    let temp_backup = pinned_dir.join(format!(".pre-migration-{unique}.db.tmp"));
    let temp_digest = pinned_dir.join(format!(".pre-migration-{unique}.sha256.tmp"));

    let result = (|| {
        let mut destination = Connection::open(&temp_backup).with_context(|| {
            format!(
                "failed to create temporary backup {}",
                temp_backup.display()
            )
        })?;
        {
            let backup = Backup::new(source, &mut destination)?;
            backup.run_to_completion(128, Duration::from_millis(25), None)?;
        }
        drop(destination);
        set_private_file_permissions(&temp_backup)?;
        validate_sqlite(&temp_backup)?;

        let digest = sha256_file(&temp_backup)?;
        let mut digest_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_digest)?;
        writeln!(digest_file, "{digest}")?;
        digest_file.sync_all()?;
        set_private_file_permissions(&temp_digest)?;

        fs::hard_link(&temp_backup, backup_path).with_context(|| {
            format!("failed to publish pinned backup {}", backup_path.display())
        })?;
        if let Err(error) = fs::hard_link(&temp_digest, digest_path) {
            let _ = fs::remove_file(backup_path);
            return Err(error).with_context(|| {
                format!(
                    "failed to publish pinned backup digest {}",
                    digest_path.display()
                )
            });
        }
        validate_backup_pair(backup_path, digest_path)
    })();

    remove_temporary_database(&temp_backup);
    let _ = fs::remove_file(&temp_digest);
    result
}

fn validate_backup_pair(backup_path: &Path, digest_path: &Path) -> Result<()> {
    if !backup_path.is_file() || !digest_path.is_file() {
        bail!(
            "incomplete pinned backup: expected {} and {}",
            backup_path.display(),
            digest_path.display()
        );
    }
    validate_sqlite(backup_path)?;
    let expected = fs::read_to_string(digest_path)
        .with_context(|| format!("failed to read backup digest {}", digest_path.display()))?;
    let expected = expected.trim();
    let actual = sha256_file(backup_path)?;
    if expected != actual {
        bail!(
            "pinned backup digest mismatch for {}: expected {}, got {}",
            backup_path.display(),
            expected,
            actual
        );
    }
    Ok(())
}

fn validate_sqlite(path: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("failed to open pinned backup {}", path.display()))?;
    let integrity: String = connection
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .with_context(|| format!("failed integrity check for {}", path.display()))?;
    if integrity != "ok" {
        bail!(
            "pinned backup {} failed integrity check: {}",
            path.display(),
            integrity
        );
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)
        .with_context(|| format!("failed to hash pinned backup {}", path.display()))?;
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
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
        if let Err(error) = fs::remove_file(sidecar) {
            if error.kind() != ErrorKind::NotFound { /* best-effort private cleanup */ }
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
    fn failed_sidecar_publication_rolls_back_backup_link() {
        let root = std::env::temp_dir().join(format!("nac_backup_publish_{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = Connection::open(root.join("source.db")).unwrap();
        source
            .execute_batch("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('safe');")
            .unwrap();
        let backup = root.join("published.db");
        let digest_as_directory = root.join("digest-target");
        fs::create_dir(&digest_as_directory).unwrap();

        let error = create_backup_pair(&source, &backup, &digest_as_directory).unwrap_err();
        assert!(error
            .to_string()
            .contains("failed to publish pinned backup digest"));
        assert!(!backup.exists());
        drop(source);
        let _ = fs::remove_dir_all(root);
    }
}
