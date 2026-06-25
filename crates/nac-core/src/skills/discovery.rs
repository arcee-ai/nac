use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SkillSource {
    pub(super) host_root: PathBuf,
    pub(super) guest_root: PathBuf,
    pub(super) precedence: u8,
}

pub(super) fn discover_skill_sources(
    workspace_dir: Option<&Path>,
    paths: &PathContext,
) -> Result<Vec<SkillSource>> {
    let mut sources = Vec::new();

    if let Some(workspace_dir) = workspace_dir {
        let root = find_project_root(workspace_dir).unwrap_or_else(|| workspace_dir.to_path_buf());
        sources.push(SkillSource {
            host_root: root.join(".nac").join("skills"),
            guest_root: PathBuf::from(PROJECT_NAC_SKILLS_GUEST_ROOT),
            precedence: 0,
        });
        sources.push(SkillSource {
            host_root: root.join(".agents").join("skills"),
            guest_root: PathBuf::from(PROJECT_AGENTS_SKILLS_GUEST_ROOT),
            precedence: 1,
        });
    }

    if let Some(nac_home) = paths.nac_home_dir() {
        sources.push(SkillSource {
            host_root: nac_home.join("skills"),
            guest_root: PathBuf::from(USER_NAC_HOME_SKILLS_GUEST_ROOT),
            precedence: 2,
        });
    }

    if let Some(home) = paths.home_dir() {
        sources.push(SkillSource {
            host_root: home.join(".agents").join("skills"),
            guest_root: PathBuf::from(USER_AGENTS_HOME_SKILLS_GUEST_ROOT),
            precedence: 3,
        });
    }

    sources.sort_by_key(|source| source.precedence);
    sources.dedup_by(|a, b| a.host_root == b.host_root);
    Ok(sources)
}

pub(super) fn visible_root_for_source(
    source: &SkillSource,
    sandbox: Option<&SandboxSession>,
) -> Option<PathBuf> {
    if !source.host_root.exists() {
        return None;
    }

    if let Some(sandbox) = sandbox {
        return sandbox
            .resolve_path(&source.host_root.display().to_string())
            .ok();
    }

    Some(source.host_root.clone())
}

pub(super) fn discover_skill_dirs(root: &Path) -> Result<Vec<PathBuf>> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut scanned = 0usize;

    while let Some((dir, depth)) = queue.pop_front() {
        if scanned >= MAX_SCAN_DIRS {
            break;
        }
        scanned += 1;

        let skill_md = dir.join(SKILL_FILENAME);
        if skill_md.is_file() {
            found.push(dir);
            continue;
        }

        if depth >= MAX_SCAN_DEPTH {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if matches!(
                name,
                ".git" | "node_modules" | "target" | ".venv" | "__pycache__"
            ) {
                continue;
            }
            queue.push_back((path, depth + 1));
        }
    }

    found.sort();
    Ok(found)
}

pub(super) fn find_project_root(workspace_dir: &Path) -> Option<PathBuf> {
    let mut current = Some(workspace_dir);
    while let Some(dir) = current {
        let git_marker = dir.join(".git");
        if git_marker.is_dir() || git_marker.is_file() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

pub(super) fn join_path(base: &Path, suffix: &Path) -> PathBuf {
    if suffix.as_os_str().is_empty() {
        return base.to_path_buf();
    }
    let mut out = base.to_path_buf();
    for component in suffix.components() {
        if let std::path::Component::Normal(part) = component {
            out.push(part);
        }
    }
    out
}
