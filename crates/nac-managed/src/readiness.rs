//! Managed-host readiness facts and credential-safe local probes.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use uuid::Uuid;

use crate::configuration::{ManagedHostConfig, ManagedModelCredentialSource};

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ReadinessCheck {
    pub name: &'static str,
    pub ready: bool,
    pub detail: String,
}

impl ReadinessCheck {
    pub fn pass(name: &'static str, detail: impl Into<String>) -> Self {
        Self {
            name,
            ready: true,
            detail: detail.into(),
        }
    }

    pub fn fail(name: &'static str, detail: impl Into<String>) -> Self {
        Self {
            name,
            ready: false,
            detail: detail.into(),
        }
    }
}

/// Managed-only readiness probes. Durable store readiness remains an injected
/// delivery/application concern because this crate does not own SQLite.
pub fn host_checks(
    managed: &ManagedHostConfig,
    expected_uid: u32,
    expected_gid: u32,
    required_tools: &[&str],
) -> Vec<ReadinessCheck> {
    let mut checks = vec![
        path_check(
            "state-root",
            &managed.state_root,
            expected_uid,
            expected_gid,
        ),
        path_check(
            "repository-root",
            &managed.repository_root,
            expected_uid,
            expected_gid,
        ),
        path_check("home-root", &managed.home_root, expected_uid, expected_gid),
        runtime_tools_check(required_tools),
        command_probe(&managed.repository_root),
    ];
    if managed.model_credential_source == ManagedModelCredentialSource::MountedApiKey {
        checks.insert(
            3,
            model_credential_check(&managed.model_credential_file, expected_uid, expected_gid),
        );
    }
    checks
}

fn path_check(
    name: &'static str,
    path: &Path,
    expected_uid: u32,
    expected_gid: u32,
) -> ReadinessCheck {
    let canonical = match path.canonicalize() {
        Ok(canonical) => canonical,
        Err(error) => return ReadinessCheck::fail(name, format!("path is unavailable: {error}")),
    };
    if canonical != path {
        return ReadinessCheck::fail(name, "path is not canonical");
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => metadata,
        Ok(_) => return ReadinessCheck::fail(name, "path is not a directory"),
        Err(error) => return ReadinessCheck::fail(name, format!("path metadata failed: {error}")),
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if !ownership_is_accepted(metadata.uid(), metadata.gid(), expected_uid, expected_gid) {
            return ReadinessCheck::fail(
                name,
                format!(
                    "path owner is {}:{}; expected {expected_uid}:{expected_gid}",
                    metadata.uid(),
                    metadata.gid()
                ),
            );
        }
    }
    let probe_path = path.join(format!(".nac-readiness-{}", Uuid::new_v4().simple()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe_path)?;
        file.write_all(b"ready")?;
        file.sync_all()?;
        drop(file);
        fs::remove_file(&probe_path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&probe_path);
        return ReadinessCheck::fail(name, format!("path is not writable: {error}"));
    }
    ReadinessCheck::pass(
        name,
        "path is canonical, runtime-owned or group-accessible, and writable",
    )
}

#[cfg(unix)]
fn ownership_is_accepted(
    actual_uid: u32,
    actual_gid: u32,
    expected_uid: u32,
    expected_gid: u32,
) -> bool {
    actual_gid == expected_gid && (actual_uid == expected_uid || actual_uid == 0)
}

fn model_credential_check(path: &Path, expected_uid: u32, expected_gid: u32) -> ReadinessCheck {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return ReadinessCheck::fail("model-credential", "credential path is a symlink")
        }
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return ReadinessCheck::fail("model-credential", "credential path is not a file"),
        Err(error) => {
            return ReadinessCheck::fail(
                "model-credential",
                format!("credential file is unavailable: {error}"),
            )
        }
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let owner_access = metadata.uid() == expected_uid && metadata.gid() == expected_gid;
        let kubernetes_group_access = metadata.uid() == 0 && metadata.gid() == expected_gid;
        if !owner_access && !kubernetes_group_access {
            return ReadinessCheck::fail(
                "model-credential",
                "credential file has unexpected ownership",
            );
        }
        let mode = metadata.permissions().mode();
        if mode & 0o007 != 0 || (kubernetes_group_access && mode & 0o040 == 0) {
            return ReadinessCheck::fail(
                "model-credential",
                "credential file permissions do not restrict access to the runtime owner/group",
            );
        }
    }
    match nac_credential_store::read_mounted_credential_string(path) {
        Ok(Some(contents)) if !contents.trim().is_empty() => {}
        Ok(Some(_)) => {
            return ReadinessCheck::fail("model-credential", "credential file is blank");
        }
        Ok(None) => {
            return ReadinessCheck::fail("model-credential", "credential file is unavailable");
        }
        Err(error) => {
            return ReadinessCheck::fail(
                "model-credential",
                format!("credential file is invalid: {error}"),
            );
        }
    }
    ReadinessCheck::pass("model-credential", "model backend credential is present")
}

fn runtime_tools_check(required_tools: &[&str]) -> ReadinessCheck {
    let missing = required_tools
        .iter()
        .copied()
        .filter(|tool| find_executable(tool).is_none())
        .collect::<Vec<_>>();
    if missing.is_empty() {
        ReadinessCheck::pass("runtime-tools", "required coding tools are present")
    } else {
        ReadinessCheck::fail(
            "runtime-tools",
            format!("required tools are missing: {}", missing.join(", ")),
        )
    }
}

fn find_executable(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|directory| directory.join(name))
            .find(|candidate| {
                let Ok(metadata) = fs::metadata(candidate) else {
                    return false;
                };
                if !metadata.is_file() {
                    return false;
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    metadata.permissions().mode() & 0o111 != 0
                }
                #[cfg(not(unix))]
                {
                    true
                }
            })
    })
}

fn command_probe(repository_root: &Path) -> ReadinessCheck {
    let result = Command::new("/bin/sh")
        .args(["-c", "test \"$#\" -eq 0", "nac-readiness"])
        .env_clear()
        .current_dir(repository_root)
        .status();
    match result {
        Ok(status) if status.success() => {
            ReadinessCheck::pass("local-command", "local command backend is usable")
        }
        Ok(status) => ReadinessCheck::fail(
            "local-command",
            format!("local command probe exited with {status}"),
        ),
        Err(error) => ReadinessCheck::fail(
            "local-command",
            format!("local command probe failed: {error}"),
        ),
    }
}

#[cfg(test)]
#[path = "readiness_tests.rs"]
mod tests;
