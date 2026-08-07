use super::*;

#[derive(Debug, Serialize, Deserialize)]
struct PersistedSandboxSpec {
    // Raw string rather than `SandboxBackendType` so removed/unknown backend
    // names in old session rows parse tolerantly (see `deserialize_sandbox`).
    #[serde(default = "default_backend")]
    backend: String,
    image: String,
    workdir: String,
    mounts: Vec<PersistedMountSpec>,
    #[serde(default)]
    gpu_devices: Vec<String>,
    #[serde(default = "default_sandbox_shm_size")]
    shm_size: Option<String>,
    #[serde(default = "default_cpus")]
    cpus: u8,
    #[serde(default = "default_memory_mib")]
    memory_mib: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedMountSpec {
    host: String,
    guest: String,
    read_only: bool,
}

fn default_backend() -> String {
    // Rows written before the backend field existed are Podman rows.
    SandboxBackendType::default().as_str().to_string()
}

fn default_sandbox_shm_size() -> Option<String> {
    Some("0".to_string())
}

fn default_cpus() -> u8 {
    2
}

fn default_memory_mib() -> u32 {
    2048
}

pub(super) fn serialize_sandbox(spec: &SandboxSpec) -> Result<String> {
    let persisted = PersistedSandboxSpec {
        backend: spec.backend.as_str().to_string(),
        image: spec.image.clone(),
        workdir: spec.workdir.display().to_string(),
        mounts: spec
            .mounts
            .iter()
            .map(|mount| PersistedMountSpec {
                host: mount.host.display().to_string(),
                guest: mount.guest.display().to_string(),
                read_only: mount.read_only,
            })
            .collect(),
        gpu_devices: spec.gpu_devices.clone(),
        shm_size: spec.shm_size.clone(),
        cpus: spec.cpus,
        memory_mib: spec.memory_mib,
    };
    serde_json::to_string(&persisted).context("failed to serialize sandbox spec")
}

pub(crate) fn deserialize_sandbox(raw: Option<String>) -> Result<Option<SandboxSpec>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let persisted: PersistedSandboxSpec =
        serde_json::from_str(&raw).context("failed to parse sandbox spec")?;
    // Parse-tolerate removed backends: session rows written while the smolvm
    // backend existed (or naming any backend this build does not provide) must
    // still load. The session resumes without a sandbox rather than failing.
    let backend = match SandboxBackendType::from_str(&persisted.backend) {
        Ok(backend) => backend,
        Err(_) => {
            eprintln!(
                "nac: stored sandbox backend '{}' is not available in this build; \
                 session will run without a sandbox",
                persisted.backend
            );
            return Ok(None);
        }
    };
    Ok(Some(SandboxSpec {
        backend,
        image: persisted.image,
        workdir: PathBuf::from(persisted.workdir),
        mounts: persisted
            .mounts
            .into_iter()
            .map(|mount| crate::sandbox::MountSpec {
                host: PathBuf::from(mount.host),
                guest: PathBuf::from(mount.guest),
                read_only: mount.read_only,
            })
            .collect(),
        gpu_devices: persisted.gpu_devices,
        shm_size: persisted.shm_size,
        cpus: persisted.cpus,
        memory_mib: persisted.memory_mib,
    }))
}
