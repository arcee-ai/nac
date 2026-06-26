use super::*;

#[derive(Debug, Serialize, Deserialize)]
struct PersistedSandboxSpec {
    #[serde(default)]
    backend: SandboxBackendType,
    image: String,
    workdir: String,
    mounts: Vec<PersistedMountSpec>,
    #[serde(default)]
    gpu_devices: Vec<String>,
    #[serde(default = "default_sandbox_shm_size")]
    shm_size: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedMountSpec {
    host: String,
    guest: String,
    read_only: bool,
}

fn default_sandbox_shm_size() -> Option<String> {
    Some("0".to_string())
}

pub(super) fn serialize_sandbox(spec: &SandboxSpec) -> Result<String> {
    let persisted = PersistedSandboxSpec {
        backend: spec.backend,
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
    };
    serde_json::to_string(&persisted).context("failed to serialize sandbox spec")
}

pub(super) fn deserialize_sandbox(raw: Option<String>) -> Result<Option<SandboxSpec>> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let persisted: PersistedSandboxSpec =
        serde_json::from_str(&raw).context("failed to parse sandbox spec")?;
    Ok(Some(SandboxSpec {
        backend: persisted.backend,
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
    }))
}
