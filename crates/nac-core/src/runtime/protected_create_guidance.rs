//! Fixed preparation traversal under original participant/context and retained
//! source descriptors. Never an ordinary loader or model-visible file tool.
use super::*;
use crate::{agents_md::AgentsMdFile, configuration_source_files::DirectoryPath};
use anyhow::ensure;
use std::{
    collections::{HashSet, VecDeque},
    ffi::OsStr,
    path::{Component, Path},
};

impl ProtectedCreateGuidance {
    pub(in crate::runtime) fn prepare(
        reads: Arc<create_guidance_source::GuidanceReadOwner>,
        context: Arc<ProtectedExecutionContext>,
        session_id: String,
    ) -> Result<Self> {
        let (global, raw, cwd) = reads.global_and_workspace()?;
        // The same parsed source must first supply an actual protected MCP
        // connection owner when endpoints are enabled. No ordinary transport
        // or silent empty registry is substituted for configured behavior.
        ensure!(
            !McpRegistry::preparation_has_enabled_servers(&raw)?,
            "configured MCP requires protected endpoint construction"
        );
        let (fallback, max_bytes) = AgentsMdBundle::preparation_settings(&raw);
        ensure!(
            fallback.iter().all(|name| {
                let mut parts = Path::new(name).components();
                matches!(parts.next(), Some(Component::Normal(_))) && parts.next().is_none()
            }),
            "protected guidance fallback must be a single source component"
        );
        let mut files = Vec::new();
        if let Some(home) = global.path_context()?.nac_home_dir() {
            let directory = DirectoryPath::capture(&home)?;
            if let Some(file) = select(&reads, &directory, &["AGENTS.override.md", "AGENTS.md"])? {
                files.push(file);
            }
        }
        let project = project_root(&reads, &cwd)?;
        let mut directories = vec![project.clone()];
        let mut current = project.clone();
        for part in cwd.strip_prefix(&project)?.components() {
            let Component::Normal(part) = part else {
                anyhow::bail!("guidance workspace path differs");
            };
            current.push(part);
            directories.push(current.clone());
        }
        let mut names = vec!["AGENTS.override.md", "AGENTS.md"];
        names.extend(fallback.iter().map(String::as_str));
        for directory in directories {
            if let Some(file) = select(&reads, &DirectoryPath::capture(&directory)?, &names)? {
                files.push(file);
            }
        }
        let mut roots = vec![
            DirectoryPath::capture(&project.join(".nac/skills"))?,
            DirectoryPath::capture(&project.join(".agents/skills"))?,
        ];
        roots.extend(global.original_skill_roots()?);
        let mut seen = HashSet::new();
        let mut skill_files = Vec::new();
        for root in roots {
            if !seen.insert(root.path().to_owned()) {
                continue;
            }
            for directory in skill_directories(&reads, root)? {
                let Some(text) = reads.read_text(&directory, OsStr::new("SKILL.md"))? else {
                    continue;
                };
                let resources = resources(&reads, &directory)?;
                skill_files.push((directory.path().join("SKILL.md"), text, resources));
            }
        }
        let skills = SkillRegistry::from_preparation_files(skill_files)?;
        reads.check_current()?;
        Ok(Self {
            original_global: global,
            original_context: context,
            session_id,
            agents_md: AgentsMdBundle::from_preparation_files(files, max_bytes),
            skills,
            mcp: None,
            _reads: reads,
        })
    }
}
fn select(
    reads: &create_guidance_source::GuidanceReadOwner,
    directory: &DirectoryPath,
    names: &[&str],
) -> Result<Option<AgentsMdFile>> {
    for name in names {
        if let Some(text) = reads.read_text(directory, OsStr::new(name))? {
            if !text.trim().is_empty() {
                return Ok(Some(AgentsMdFile {
                    path: directory.path().join(name),
                    content: text.trim().to_owned(),
                }));
            }
        }
    }
    Ok(None)
}
fn project_root(reads: &create_guidance_source::GuidanceReadOwner, cwd: &Path) -> Result<PathBuf> {
    for path in cwd.ancestors() {
        let directory = DirectoryPath::capture(path)?;
        if reads
            .entries(&directory)?
            .iter()
            .any(|(name, dir, file)| name == OsStr::new(".git") && (*dir || *file))
        {
            return Ok(path.to_owned());
        }
    }
    Ok(cwd.to_owned())
}
fn skill_directories(
    reads: &create_guidance_source::GuidanceReadOwner,
    root: DirectoryPath,
) -> Result<Vec<DirectoryPath>> {
    let mut pending = VecDeque::from([(root, 0_usize)]);
    let mut found = Vec::new();
    let mut scanned = 0;
    while let Some((directory, depth)) = pending.pop_front() {
        if scanned >= skills::MAX_SCAN_DIRS {
            break;
        }
        scanned += 1;
        let entries = reads.entries(&directory)?;
        if entries
            .iter()
            .any(|(name, _, file)| name == OsStr::new("SKILL.md") && *file)
        {
            found.push(directory);
            continue;
        }
        if depth >= skills::MAX_SCAN_DEPTH {
            continue;
        }
        for (name, is_dir, _) in entries {
            if !is_dir
                || matches!(
                    name.to_str(),
                    Some(".git" | "node_modules" | "target" | ".venv" | "__pycache__")
                )
            {
                continue;
            }
            pending.push_back((directory.descend(Path::new(&name))?, depth + 1));
        }
    }
    found.sort_by(|left, right| left.path().cmp(right.path()));
    Ok(found)
}
fn resources(
    reads: &create_guidance_source::GuidanceReadOwner,
    root: &DirectoryPath,
) -> Result<Vec<String>> {
    let mut found = Vec::new();
    for name in ["scripts", "references", "assets"] {
        collect_resources(
            reads,
            root.path(),
            root.descend(Path::new(name))?,
            &mut found,
        )?;
        if found.len() >= skills::MAX_RESOURCE_ENTRIES {
            break;
        }
    }
    found.sort();
    Ok(found)
}
fn collect_resources(
    reads: &create_guidance_source::GuidanceReadOwner,
    root: &Path,
    directory: DirectoryPath,
    found: &mut Vec<String>,
) -> Result<()> {
    for (name, is_dir, is_file) in reads.entries(&directory)? {
        if found.len() >= skills::MAX_RESOURCE_ENTRIES {
            break;
        }
        if is_dir {
            collect_resources(reads, root, directory.descend(Path::new(&name))?, found)?;
        } else if is_file {
            found.push(
                directory
                    .path()
                    .join(name)
                    .strip_prefix(root)?
                    .display()
                    .to_string(),
            );
        }
    }
    Ok(())
}
