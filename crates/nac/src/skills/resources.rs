use super::*;

pub(super) fn list_skill_resources(skill_root: &Path) -> Result<Vec<String>> {
    let mut resources = Vec::new();
    for entry in ["scripts", "references", "assets"] {
        let dir = skill_root.join(entry);
        if !dir.is_dir() {
            continue;
        }
        collect_relative_files(skill_root, &dir, &mut resources)?;
        if resources.len() >= MAX_RESOURCE_ENTRIES {
            resources.truncate(MAX_RESOURCE_ENTRIES);
            break;
        }
    }
    resources.sort();
    Ok(resources)
}

fn collect_relative_files(
    skill_root: &Path,
    dir: &Path,
    resources: &mut Vec<String>,
) -> Result<()> {
    if resources.len() >= MAX_RESOURCE_ENTRIES {
        return Ok(());
    }

    for entry in fs::read_dir(dir).with_context(|| format!("failed to read '{}'", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_relative_files(skill_root, &path, resources)?;
            if resources.len() >= MAX_RESOURCE_ENTRIES {
                return Ok(());
            }
            continue;
        }
        if !path.is_file() {
            continue;
        }
        if let Ok(relative) = path.strip_prefix(skill_root) {
            resources.push(relative.display().to_string());
        }
        if resources.len() >= MAX_RESOURCE_ENTRIES {
            return Ok(());
        }
    }
    Ok(())
}

pub(super) fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
