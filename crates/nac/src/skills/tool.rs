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

pub async fn execute_activate_skill(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let Some(registry) = &runtime.skills else {
        return ToolResult {
            content: "Error: no skills are available".to_string(),
            is_error: true,
        };
    };

    let name = match require_str(&args, "name") {
        Ok(value) => value,
        Err(error) => return error,
    };

    if !registry.has_skill(&name) {
        return ToolResult {
            content: format!("Error: unknown skill '{}'", name),
            is_error: true,
        };
    }

    let already_active = {
        let mut activated = runtime.activated_skills.lock().await;
        let already_active = activated.contains(&name);
        if !already_active {
            activated.insert(name.clone());
        }
        already_active
    };

    registry.activate(&name, already_active)
}
