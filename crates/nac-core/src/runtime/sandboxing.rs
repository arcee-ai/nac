use super::*;

pub(crate) fn effective_sandbox_options(
    options: SandboxOptions,
    config: &NacConfig,
) -> EffectiveSandboxOptions {
    let explicit_sandbox_config_flags_present = options.explicit_sandbox_config_flags_present();
    let sandbox_backend = options
        .sandbox_backend
        .as_deref()
        .or(config.sandbox.backend.as_deref())
        .map(|s| SandboxBackendType::from_str(s).unwrap_or_default())
        .unwrap_or_default();
    let sandbox_cpus = options.sandbox_cpus.or(config.sandbox.cpus).unwrap_or(2);
    let sandbox_mem = options
        .sandbox_mem
        .or(config.sandbox.memory_mib)
        .unwrap_or(2048);
    EffectiveSandboxOptions {
        sandbox: options.sandbox,
        no_mount_cwd: options.no_mount_cwd,
        mounts: options.mounts,
        mounts_ro: options.mounts_ro,
        internal_mounts: options
            .internal_mounts
            .into_iter()
            .map(|(host, guest, read_only)| MountSpec {
                host,
                guest,
                read_only,
            })
            .collect(),
        sandbox_image: options
            .sandbox_image
            .or_else(|| config.sandbox.image.clone()),
        sandbox_gpus: options.sandbox_gpus,
        sandbox_shm_size: options.sandbox_shm_size,
        sandbox_session_key: options.sandbox_session_key,
        sandbox_workdir: options.sandbox_workdir,
        sandbox_backend,
        sandbox_cpus,
        sandbox_mem,
        sandbox_activity_key: options.sandbox_activity_key,
        explicit_sandbox_config_flags_present,
    }
}

pub(super) fn validate_target_sandbox_options(
    ssh_host: Option<&str>,
    options: &EffectiveSandboxOptions,
    remote_label: &str,
) -> Result<()> {
    if ssh_host.is_some()
        && (options.sandbox_enabled() || options.explicit_sandbox_config_flags_present())
    {
        anyhow::bail!(
            "invalid remote {remote_label}: ssh_host and sandbox options cannot both be set"
        );
    }
    validate_sandbox_options(options)
}

pub(super) fn validate_sandbox_options(options: &EffectiveSandboxOptions) -> Result<()> {
    if !options.sandbox_enabled() && options.explicit_sandbox_config_flags_present() {
        anyhow::bail!("sandbox configuration flags require --sandbox");
    }
    Ok(())
}

pub async fn build_sandbox_session(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
) -> Result<Option<SandboxSession>> {
    build_sandbox_session_inner(options, cwd, None, None).await
}

pub(super) async fn build_sandbox_session_inner(
    options: &EffectiveSandboxOptions,
    cwd: &Path,
    owned_session_key: Option<String>,
    durable_store_path: Option<PathBuf>,
) -> Result<Option<SandboxSession>> {
    validate_sandbox_options(options)?;
    if !options.sandbox {
        return Ok(None);
    }

    let owner = owned_session_key.is_some() || options.sandbox_session_key.is_none();
    let session_key = owned_session_key
        .or_else(|| options.sandbox_session_key.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Everything between the fork (inside `cwd_mount`) and `launch_session`
    // is fallible, and `launch_session`'s rollback only covers
    // `SandboxSession::create` failing. A forked worktree predates the
    // session row, so nothing else would ever clean it up: roll it back here
    // when any intermediate step fails.
    let mut forked_worktree = None;
    let mut inferred_workdir = PathBuf::from(DEFAULT_SANDBOX_WORKDIR);
    let spec = (|| -> Result<SandboxSpec> {
        let mut mounts = Vec::new();
        if !options.no_mount_cwd {
            let cwd_mount = session_worktree::cwd_mount(cwd, &session_key, owner)?;
            mounts.extend(cwd_mount.git_dir_mounts);
            inferred_workdir = cwd_mount.workdir;
            forked_worktree = cwd_mount.worktree;
            mounts.push(MountSpec {
                host: cwd_mount.host,
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            });
        }
        mounts.extend(options.internal_mounts.clone());
        for mount in &options.mounts {
            mounts.push(parse_mount_spec(mount, false, cwd)?);
        }
        for mount in &options.mounts_ro {
            mounts.push(parse_mount_spec(mount, true, cwd)?);
        }

        let workdir = options.sandbox_workdir.clone().unwrap_or_else(|| {
            inferred_workdir
                .to_str()
                .expect("sandbox worktree paths are validated as UTF-8")
                .to_string()
        });
        let skills_workspace_dir = workspace_dir_from_mounts(&mounts, PathBuf::from(&workdir))
            .unwrap_or_else(|| cwd.to_path_buf());
        mounts.extend(skills::auto_mounts(
            &skills_workspace_dir,
            &mounts,
            &PathContext::new(cwd),
        )?);

        build_sandbox_spec(
            options.sandbox_backend,
            options
                .sandbox_image
                .as_deref()
                .unwrap_or(DEFAULT_SANDBOX_IMAGE)
                .to_string(),
            workdir,
            mounts,
            options
                .sandbox_gpus
                .iter()
                .map(|device| normalize_gpu_device(device))
                .collect(),
            Some(
                options
                    .sandbox_shm_size
                    .clone()
                    .unwrap_or_else(|| "0".to_string()),
            ),
            options.sandbox_cpus,
            options.sandbox_mem,
        )
    })();
    let mut spec = match spec {
        Ok(spec) => spec,
        Err(error) => {
            if let Some(worktree) = &forked_worktree {
                session_worktree::rollback(worktree);
            }
            return Err(error);
        }
    };
    spec.worktree = forked_worktree;
    // A launching UI polls setup activity under its own client-generated key;
    // without one, the session key is the correlation id. Bounded so a
    // caller cannot grow the activity map with unbounded keys.
    let activity_key = options
        .sandbox_activity_key
        .clone()
        .filter(|key| !key.is_empty() && key.len() <= 128)
        .unwrap_or_else(|| session_key.clone());
    let session = session_worktree::launch_session(
        spec,
        session_key,
        owner,
        activity_key,
        durable_store_path,
    )
    .await?;
    Ok(Some(session))
}

pub(crate) fn normalize_gpu_device(device: &str) -> String {
    if device == "all" {
        "nvidia.com/gpu=all".to_string()
    } else {
        device.to_string()
    }
}

pub(crate) fn workspace_dir_from_mounts(mounts: &[MountSpec], workdir: PathBuf) -> Option<PathBuf> {
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

pub(crate) fn effective_workspace_dir(
    current_dir: &Path,
    sandbox: Option<&SandboxSession>,
) -> Option<PathBuf> {
    if let Some(sandbox) = sandbox {
        return sandbox.host_workdir();
    }
    Some(current_dir.to_path_buf())
}
