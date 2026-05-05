use super::*;

pub(super) trait SandboxCliArgs {
    fn sandbox_enabled(&self) -> bool;
    fn no_mount_cwd(&self) -> bool;
    fn mounts(&self) -> &[String];
    fn mounts_ro(&self) -> &[String];
    fn sandbox_image(&self) -> &str;
    fn sandbox_gpus(&self) -> &[String];
    fn sandbox_shm_size(&self) -> Option<&String>;
    fn sandbox_session_key(&self) -> Option<&String>;
    fn sandbox_workdir(&self) -> Option<&String>;
}

impl SandboxCliArgs for SandboxArgs {
    fn sandbox_enabled(&self) -> bool {
        self.sandbox
    }

    fn no_mount_cwd(&self) -> bool {
        self.no_mount_cwd
    }

    fn mounts(&self) -> &[String] {
        &self.mounts
    }

    fn mounts_ro(&self) -> &[String] {
        &self.mounts_ro
    }

    fn sandbox_image(&self) -> &str {
        &self.sandbox_image
    }

    fn sandbox_gpus(&self) -> &[String] {
        &self.sandbox_gpus
    }

    fn sandbox_shm_size(&self) -> Option<&String> {
        self.sandbox_shm_size.as_ref()
    }

    fn sandbox_session_key(&self) -> Option<&String> {
        self.sandbox_session_key.as_ref()
    }

    fn sandbox_workdir(&self) -> Option<&String> {
        self.sandbox_workdir.as_ref()
    }
}

pub(super) async fn build_sandbox_session<Cli: SandboxCliArgs>(
    cli: &Cli,
    cwd: &Path,
) -> Result<Option<SandboxSession>> {
    let sandbox_flags_present = cli.no_mount_cwd()
        || !cli.mounts().is_empty()
        || !cli.mounts_ro().is_empty()
        || cli.sandbox_session_key().is_some()
        || cli.sandbox_workdir().is_some()
        || cli.sandbox_image() != DEFAULT_SANDBOX_IMAGE
        || !cli.sandbox_gpus().is_empty()
        || cli.sandbox_shm_size().is_some();

    if !cli.sandbox_enabled() {
        if sandbox_flags_present {
            anyhow::bail!("sandbox configuration flags require --sandbox");
        }
        return Ok(None);
    }

    let mut mounts = Vec::new();
    if !cli.no_mount_cwd() {
        mounts.push(parse_mount_spec(
            &format!("{}:{}", cwd.display(), DEFAULT_SANDBOX_WORKDIR),
            false,
            cwd,
        )?);
    }
    for mount in cli.mounts() {
        mounts.push(parse_mount_spec(mount, false, cwd)?);
    }
    for mount in cli.mounts_ro() {
        mounts.push(parse_mount_spec(mount, true, cwd)?);
    }

    let workdir = cli
        .sandbox_workdir()
        .cloned()
        .unwrap_or_else(|| DEFAULT_SANDBOX_WORKDIR.to_string());
    let skills_workspace_dir = workspace_dir_from_mounts(&mounts, PathBuf::from(&workdir))
        .unwrap_or_else(|| cwd.to_path_buf());
    mounts.extend(skills::auto_mounts(&skills_workspace_dir, &mounts)?);

    let spec = build_sandbox_spec(
        cli.sandbox_image().to_string(),
        workdir,
        mounts,
        cli.sandbox_gpus()
            .iter()
            .map(|device| normalize_gpu_device(device))
            .collect(),
        Some(
            cli.sandbox_shm_size()
                .cloned()
                .unwrap_or_else(|| "0".to_string()),
        ),
    )?;
    let owner = cli.sandbox_session_key().is_none();
    let session_key = cli
        .sandbox_session_key()
        .cloned()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session = SandboxSession::create(spec, session_key, owner).await?;
    Ok(Some(session))
}

pub(super) fn normalize_gpu_device(device: &str) -> String {
    if device == "all" {
        "nvidia.com/gpu=all".to_string()
    } else {
        device.to_string()
    }
}

pub(super) fn workspace_dir_from_mounts(
    mounts: &[crate::sandbox::MountSpec],
    workdir: PathBuf,
) -> Option<PathBuf> {
    for mount in mounts {
        if workdir.starts_with(&mount.guest) {
            let suffix = workdir
                .strip_prefix(&mount.guest)
                .unwrap_or_else(|_| Path::new(""));
            let mut host = mount.host.clone();
            for component in suffix.components() {
                if let std::path::Component::Normal(part) = component {
                    host.push(part);
                }
            }
            return Some(host);
        }
    }
    None
}
