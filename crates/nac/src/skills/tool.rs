use super::*;

pub fn auto_mounts(workspace_dir: &Path, existing_mounts: &[MountSpec]) -> Result<Vec<MountSpec>> {
    let sources = discover_skill_sources(Some(workspace_dir))?;
    let mut mounts = Vec::new();

    for source in sources {
        if !source.host_root.exists() {
            continue;
        }
        if existing_mounts
            .iter()
            .any(|mount| source.host_root.starts_with(&mount.host))
        {
            continue;
        }
        if mounts
            .iter()
            .any(|mount: &MountSpec| mount.host == source.host_root)
        {
            continue;
        }
        mounts.push(MountSpec {
            host: source.host_root,
            guest: source.guest_root,
            read_only: true,
        });
    }

    Ok(mounts)
}
