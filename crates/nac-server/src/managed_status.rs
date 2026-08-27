//! Credential-free liveness, managed readiness, and owner-facing host status.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;
use uuid::Uuid;

use crate::SessionManager;

const MANAGED_RUNTIME_UID: u32 = 10_001;
const MANAGED_RUNTIME_GID: u32 = 10_001;
const MAX_MODEL_CREDENTIAL_BYTES: u64 = 64 * 1024;
const REQUIRED_RUNTIME_TOOLS: &[&str] = &[
    "bash",
    "git",
    "gh",
    "ssh",
    "curl",
    "jq",
    "rg",
    "fd",
    "rsync",
    "make",
    "pkg-config",
    "cmake",
    "cc",
    "python3",
    "uv",
    "node",
    "npm",
    "corepack",
    "rustc",
    "cargo",
    "rustfmt",
    "cargo-clippy",
    "go",
    "tar",
    "gzip",
    "xz",
    "zip",
    "unzip",
    "tini",
];

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ReadinessCheck {
    name: &'static str,
    ready: bool,
    detail: String,
}

impl ReadinessCheck {
    fn pass(name: &'static str, detail: impl Into<String>) -> Self {
        Self {
            name,
            ready: true,
            detail: detail.into(),
        }
    }

    fn fail(name: &'static str, detail: impl Into<String>) -> Self {
        Self {
            name,
            ready: false,
            detail: detail.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ReadinessResponse {
    status: &'static str,
    managed: bool,
    version: &'static str,
    schema_version: i64,
    checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ManagedHostStatusResponse {
    managed: bool,
    ready: bool,
    version: &'static str,
    schema_version: i64,
    logical_host_id: String,
    owner: Option<String>,
    public_hostname: String,
    #[schema(value_type = String)]
    repository_root: PathBuf,
    model_ready: bool,
    model: ManagedModelStatus,
    github_status: &'static str,
    secret_count: usize,
    project_count: usize,
    session_count: usize,
    checks: Vec<ReadinessCheck>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub(crate) struct ManagedModelStatus {
    backend: nac_core::model::BackendKind,
    id: String,
    endpoint: String,
    display_name: &'static str,
}

#[utoipa::path(
    get,
    path = "/healthz",
    operation_id = "get_healthz",
    tag = "system",
    responses((status = 200, description = "Server event loop is responsive", body = crate::HealthResponse, content_type = "application/json"))
)]
pub(crate) async fn healthz_handler() -> Json<crate::HealthResponse> {
    Json(crate::HealthResponse { status: "ok" })
}

#[utoipa::path(
    get,
    path = "/readyz",
    operation_id = "get_readyz",
    tag = "system",
    responses(
        (status = 200, description = "Durable store and selected runtime are ready", body = ReadinessResponse, content_type = "application/json"),
        (status = 503, description = "A required readiness check failed", body = ReadinessResponse, content_type = "application/json")
    )
)]
pub(crate) async fn readyz_handler(
    State(manager): State<SessionManager>,
) -> (StatusCode, Json<ReadinessResponse>) {
    let managed = manager.managed_host().is_some();
    let snapshot = tokio::task::spawn_blocking(move || readiness_snapshot(&manager)).await;
    let response = match snapshot {
        Ok(response) => response,
        Err(error) => ReadinessResponse {
            status: "unavailable",
            managed,
            version: env!("CARGO_PKG_VERSION"),
            schema_version: nac_core::store::schema_version(),
            checks: vec![ReadinessCheck::fail(
                "readiness-task",
                format!("readiness task failed: {error}"),
            )],
        },
    };
    let status = if response.status == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(response))
}

#[utoipa::path(
    get,
    path = "/managed/status",
    operation_id = "get_managed_status",
    tag = "managed",
    responses(
        (status = 200, description = "Owner-facing managed host status without credential values", body = ManagedHostStatusResponse, content_type = "application/json"),
        (status = 404, description = "Managed NAC is not configured", body = crate::ApiErrorBody, content_type = "application/json")
    )
)]
pub(crate) async fn managed_status_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ManagedHostStatusResponse>, crate::ApiError> {
    if manager.managed_host().is_none() {
        return Err(crate::ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Managed NAC is not configured".to_string(),
        });
    }
    tokio::task::spawn_blocking(move || managed_status_snapshot(&manager))
        .await
        .map_err(|error| crate::ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("managed status task failed: {error}"),
        })?
        .map(Json)
        .map_err(|error| crate::ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        })
}

fn readiness_snapshot(manager: &SessionManager) -> ReadinessResponse {
    let checks = readiness_checks(
        manager,
        MANAGED_RUNTIME_UID,
        MANAGED_RUNTIME_GID,
        REQUIRED_RUNTIME_TOOLS,
    );
    ReadinessResponse {
        status: if checks.iter().all(|check| check.ready) {
            "ok"
        } else {
            "unavailable"
        },
        managed: manager.managed_host().is_some(),
        version: env!("CARGO_PKG_VERSION"),
        schema_version: nac_core::store::schema_version(),
        checks,
    }
}

fn managed_status_snapshot(manager: &SessionManager) -> anyhow::Result<ManagedHostStatusResponse> {
    let managed = manager
        .managed_host()
        .expect("managed status preflight requires managed configuration");
    let checks = readiness_checks(
        manager,
        MANAGED_RUNTIME_UID,
        MANAGED_RUNTIME_GID,
        REQUIRED_RUNTIME_TOOLS,
    );
    let model_ready = checks
        .iter()
        .find(|check| check.name == "model-credential")
        .is_some_and(|check| check.ready);
    let github_status = match managed.github_auth()?.status() {
        Ok(status) if status.connected => "connected",
        Ok(_) => "disconnected",
        Err(_) => "reauth-required",
    };
    let secret_count = managed.secret_store().list()?.len();
    let project_count = nac_core::store::list_projects(&manager.inner.store_path)?.len();
    let session_count = nac_core::sessions::list_sessions(&manager.inner.store_path)?.len();
    Ok(ManagedHostStatusResponse {
        managed: true,
        ready: checks.iter().all(|check| check.ready),
        version: env!("CARGO_PKG_VERSION"),
        schema_version: nac_core::store::schema_version(),
        logical_host_id: managed.logical_host_id.clone(),
        owner: managed.owner.clone(),
        public_hostname: managed.public_hostname.clone(),
        repository_root: managed.repository_root.clone(),
        model_ready,
        model: ManagedModelStatus {
            backend: managed.model_backend,
            id: managed.model_id.clone(),
            endpoint: managed.model_endpoint.clone(),
            display_name: "Managed Arcee",
        },
        github_status,
        secret_count,
        project_count,
        session_count,
        checks,
    })
}

fn readiness_checks(
    manager: &SessionManager,
    expected_uid: u32,
    expected_gid: u32,
    required_tools: &[&str],
) -> Vec<ReadinessCheck> {
    let mut checks = vec![
        match nac_core::store::check_readiness(&manager.inner.store_path) {
            Ok(()) => ReadinessCheck::pass("store", "SQLite store is open and migrated"),
            Err(error) => {
                ReadinessCheck::fail("store", format!("SQLite store is unavailable: {error}"))
            }
        },
    ];

    let Some(managed) = manager.managed_host() else {
        return checks;
    };

    checks.push(path_check(
        "state-root",
        &managed.state_root,
        expected_uid,
        expected_gid,
    ));
    checks.push(path_check(
        "repository-root",
        &managed.repository_root,
        expected_uid,
        expected_gid,
    ));
    checks.push(path_check(
        "home-root",
        &managed.home_root,
        expected_uid,
        expected_gid,
    ));
    checks.push(model_credential_check(
        &managed.model_credential_file,
        expected_uid,
        expected_gid,
    ));
    checks.push(runtime_tools_check(required_tools));
    checks.push(command_probe(&managed.repository_root));
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
        let owner_access = metadata.uid() == expected_uid && metadata.gid() == expected_gid;
        let kubernetes_group_access = metadata.uid() == 0 && metadata.gid() == expected_gid;
        if !owner_access && !kubernetes_group_access {
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
    ReadinessCheck::pass(name, "path is canonical, owned, and writable")
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
    if metadata.len() == 0 || metadata.len() > MAX_MODEL_CREDENTIAL_BYTES {
        return ReadinessCheck::fail(
            "model-credential",
            "credential file is empty or exceeds the managed size limit",
        );
    }
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
    let file = match OpenOptions::new().read(true).open(path) {
        Ok(file) => file,
        Err(error) => {
            return ReadinessCheck::fail(
                "model-credential",
                format!("credential file is unreadable: {error}"),
            )
        }
    };
    let mut contents = String::new();
    if let Err(error) = file
        .take(MAX_MODEL_CREDENTIAL_BYTES + 1)
        .read_to_string(&mut contents)
    {
        return ReadinessCheck::fail(
            "model-credential",
            format!("credential file is invalid: {error}"),
        );
    }
    if contents.trim().is_empty() {
        return ReadinessCheck::fail("model-credential", "credential file is blank");
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
mod tests {
    use super::*;

    #[test]
    fn path_and_model_checks_require_owned_canonical_private_writable_inputs() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nac-ready-{}", Uuid::new_v4().simple()));
        fs::create_dir(&root).unwrap();
        let credential = root.join("model-token");
        fs::write(&credential, "test-only-token").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();
            let metadata = fs::metadata(&root).unwrap();
            assert!(path_check("root", &root, metadata.uid(), metadata.gid()).ready);
            assert!(model_credential_check(&credential, metadata.uid(), metadata.gid()).ready);
            fs::set_permissions(&credential, fs::Permissions::from_mode(0o644)).unwrap();
            let failure = model_credential_check(&credential, metadata.uid(), metadata.gid());
            assert!(!failure.ready);
            assert!(!failure.detail.contains("test-only-token"));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_inventory_reports_only_missing_tool_names() {
        let check = runtime_tools_check(&["this-tool-does-not-exist-nac"]);
        assert!(!check.ready);
        assert!(check.detail.contains("this-tool-does-not-exist-nac"));
    }
}
