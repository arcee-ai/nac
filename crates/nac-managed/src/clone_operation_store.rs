//! Durable operation records, destination reservations, and staging ownership.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use nac_credential_store::{
    acquire_credential_lock, read_auth_string_from_path, try_acquire_credential_lock,
    write_auth_string_to_path, FileLock,
};
use serde::{Deserialize, Serialize};

use crate::clone_workflow::ManagedCloneOperation;

pub(crate) const OPERATION_VERSION: u32 = 1;
const MARKER_VERSION: u32 = 1;

#[derive(Clone)]
pub(crate) struct CloneOperationStore {
    operation_root: PathBuf,
    repository_root: PathBuf,
}

pub(crate) struct DestinationReservation {
    _lock: FileLock,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct StagingMarker {
    version: u32,
    operation_id: String,
    destination: PathBuf,
    source_identity: String,
}

impl CloneOperationStore {
    pub(crate) fn new(state_root: &Path, repository_root: PathBuf) -> Result<Self> {
        let operation_root = state_root.join("managed_clone_operations");
        std::fs::create_dir_all(&operation_root).with_context(|| {
            format!(
                "failed to create managed clone operation root {}",
                operation_root.display()
            )
        })?;
        Ok(Self {
            operation_root,
            repository_root,
        })
    }

    pub(crate) fn reserve_destination(
        &self,
        destination: &Path,
    ) -> Result<Option<DestinationReservation>> {
        let lock_path = destination_lock_path(&self.repository_root, destination);
        Ok(try_acquire_credential_lock(&lock_path)?
            .map(|lock| DestinationReservation { _lock: lock }))
    }

    pub(crate) fn save(&self, operation: &ManagedCloneOperation) -> Result<()> {
        validate_operation_id(&operation.operation_id)?;
        let path = self.operation_path(&operation.operation_id);
        let lock_path = path.with_extension("json.lock");
        let _lock = acquire_credential_lock(&lock_path)?;
        write_auth_string_to_path(&path, &serde_json::to_string_pretty(operation)?)
    }

    pub(crate) fn load(&self, operation_id: &str) -> Result<Option<ManagedCloneOperation>> {
        validate_operation_id(operation_id)?;
        let Some(raw) = read_auth_string_from_path(&self.operation_path(operation_id))? else {
            return Ok(None);
        };
        decode_operation(&raw, Some(operation_id)).map(Some)
    }

    pub(crate) fn all(&self) -> Result<Vec<ManagedCloneOperation>> {
        let mut operations = Vec::new();
        for entry in std::fs::read_dir(&self.operation_root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(raw) = read_auth_string_from_path(&path)? else {
                continue;
            };
            operations.push(decode_operation(&raw, None)?);
        }
        Ok(operations)
    }

    pub(crate) fn save_staging_marker(
        &self,
        staging_root: &Path,
        operation_id: &str,
        destination: &Path,
        source_identity: &str,
    ) -> Result<()> {
        let marker = StagingMarker {
            version: MARKER_VERSION,
            operation_id: operation_id.to_string(),
            destination: destination.to_path_buf(),
            source_identity: source_identity.to_string(),
        };
        write_auth_string_to_path(
            &staging_root.join("owner.json"),
            &serde_json::to_string_pretty(&marker)?,
        )
    }

    pub(crate) fn cleanup_owned_staging(
        &self,
        staging_root: &Path,
        operation_id: &str,
    ) -> Result<bool> {
        let metadata = match std::fs::symlink_metadata(staging_root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            bail!("refusing to clean non-directory managed clone staging path");
        }
        let Some(raw) = read_auth_string_from_path(&staging_root.join("owner.json"))? else {
            bail!("refusing to clean managed clone staging without an ownership marker");
        };
        let marker: StagingMarker = serde_json::from_str(&raw)
            .map_err(|_| anyhow!("managed clone staging ownership marker is invalid"))?;
        if marker.version != MARKER_VERSION || marker.operation_id != operation_id {
            bail!("refusing to clean managed clone staging owned by another operation");
        }
        let expected = self
            .repository_root
            .join(format!(".nac-clone-{operation_id}"));
        if staging_root != expected {
            bail!("refusing to clean unexpected managed clone staging path");
        }
        std::fs::remove_dir_all(staging_root)?;
        Ok(true)
    }

    pub(crate) fn validate_id(&self, operation_id: &str) -> Result<()> {
        validate_operation_id(operation_id)
    }

    fn operation_path(&self, operation_id: &str) -> PathBuf {
        self.operation_root.join(format!("{operation_id}.json"))
    }
}

fn decode_operation(raw: &str, expected_id: Option<&str>) -> Result<ManagedCloneOperation> {
    let operation: ManagedCloneOperation = serde_json::from_str(raw)
        .map_err(|_| anyhow!("managed clone operation file is not valid JSON"))?;
    if let Some(expected_id) = expected_id {
        if operation.version != OPERATION_VERSION || operation.operation_id != expected_id {
            bail!("managed clone operation identity/version mismatch");
        }
    } else if operation.version != OPERATION_VERSION {
        bail!(
            "unsupported managed clone operation version {}",
            operation.version
        );
    }
    validate_operation_id(&operation.operation_id)?;
    Ok(operation)
}

fn validate_operation_id(operation_id: &str) -> Result<()> {
    if operation_id.len() != 32
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        bail!("invalid managed clone operation id");
    }
    Ok(())
}

fn destination_lock_path(repository_root: &Path, destination: &Path) -> PathBuf {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(destination.as_os_str().as_encoded_bytes());
    repository_root.join(format!(".nac-destination-{:x}.lock", digest))
}
