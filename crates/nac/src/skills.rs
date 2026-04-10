use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::paths::nac_home_dir;
use crate::sandbox::{MountSpec, SandboxSession};
use crate::tools::{require_str, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

const SKILL_FILENAME: &str = "SKILL.md";
const MAX_SCAN_DEPTH: usize = 6;
const MAX_SCAN_DIRS: usize = 2_000;
const MAX_RESOURCE_ENTRIES: usize = 64;
const PROJECT_NAC_SKILLS_GUEST_ROOT: &str = "/nac/skills/project/nac";
const PROJECT_AGENTS_SKILLS_GUEST_ROOT: &str = "/nac/skills/project/agents";
const USER_NAC_HOME_SKILLS_GUEST_ROOT: &str = "/nac/skills/user/nac-home";
const USER_AGENTS_HOME_SKILLS_GUEST_ROOT: &str = "/nac/skills/user/agents-home";

#[derive(Clone)]
pub struct SkillRegistry {
    skills: Arc<HashMap<String, SkillRecord>>,
}

#[derive(Clone, Debug)]
pub struct SkillRecord {
    pub name: String,
    pub description: String,
    pub compatibility: Option<String>,
    pub skill_md_path: PathBuf,
    pub skill_root_host: PathBuf,
    pub skill_root_visible: PathBuf,
    pub body: String,
    pub resources: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillCatalogEntry {
    pub name: String,
    pub description: String,
    pub compatibility: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SkillSource {
    host_root: PathBuf,
    guest_root: PathBuf,
    precedence: u8,
}

#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: Option<String>,
    compatibility: Option<String>,
    #[allow(dead_code)]
    license: Option<String>,
    #[allow(dead_code)]
    metadata: Option<serde_yaml::Value>,
    #[allow(dead_code)]
    #[serde(rename = "allowed-tools")]
    allowed_tools: Option<serde_yaml::Value>,
}

impl SkillRegistry {
    pub fn load(
        workspace_dir: Option<&Path>,
        sandbox: Option<&SandboxSession>,
    ) -> Result<Option<Arc<Self>>> {
        let sources = discover_skill_sources(workspace_dir)?;
        if sources.is_empty() {
            return Ok(None);
        }

        let mut skills = HashMap::new();
        let mut shadowed = HashSet::new();

        for source in sources {
            let visible_root = match visible_root_for_source(&source, sandbox) {
                Some(path) => path,
                None => continue,
            };
            for skill_dir in discover_skill_dirs(&source.host_root)? {
                let skill_md_path = skill_dir.join(SKILL_FILENAME);
                let Some(parsed) = parse_skill_file(&skill_md_path)? else {
                    continue;
                };

                let relative = skill_dir
                    .strip_prefix(&source.host_root)
                    .unwrap_or_else(|_| Path::new(""));
                let skill_root_visible = join_path(&visible_root, relative);
                let record = SkillRecord {
                    name: parsed.name.clone(),
                    description: parsed.description,
                    compatibility: parsed.compatibility,
                    skill_md_path,
                    skill_root_host: skill_dir.clone(),
                    skill_root_visible,
                    body: parsed.body,
                    resources: list_skill_resources(&skill_dir)?,
                };

                if skills.contains_key(&parsed.name) {
                    shadowed.insert(parsed.name);
                    continue;
                }
                skills.insert(parsed.name.clone(), record);
            }
        }

        for name in shadowed {
            eprintln!(
                "Skill '{}' is shadowed by a higher-precedence definition",
                name
            );
        }

        if skills.is_empty() {
            return Ok(None);
        }

        Ok(Some(Arc::new(Self {
            skills: Arc::new(skills),
        })))
    }

    pub fn tool_definition(&self) -> ToolDefinition {
        let mut names: Vec<String> = self.skills.keys().cloned().collect();
        names.sort();
        ToolDefinition {
            def_type: "function".to_string(),
            function: FunctionDef {
                name: "activate_skill".to_string(),
                description:
                    "Load the full instructions for an available skill by name before proceeding."
                        .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "enum": names,
                            "description": "Name of the skill to activate"
                        }
                    },
                    "required": ["name"]
                }),
            },
        }
    }

    pub fn catalog_message(&self) -> Option<String> {
        let catalog = self.catalog_entries();
        if catalog.is_empty() {
            return None;
        }

        let mut content = String::from(
            "The following skills provide specialized instructions for specific tasks. \
             When a task clearly matches a skill's description, call activate_skill(name) \
             before proceeding. After activation, follow the returned instructions and \
             resolve any relative paths against the returned skill directory.\n\n<available_skills>",
        );

        for entry in catalog {
            content.push_str("\n  <skill>");
            content.push_str(&format!("\n    <name>{}</name>", escape_xml(&entry.name)));
            content.push_str(&format!(
                "\n    <description>{}</description>",
                escape_xml(&entry.description)
            ));
            if let Some(compatibility) = entry.compatibility {
                content.push_str(&format!(
                    "\n    <compatibility>{}</compatibility>",
                    escape_xml(&compatibility)
                ));
            }
            content.push_str("\n  </skill>");
        }
        content.push_str("\n</available_skills>");
        Some(content)
    }

    pub fn catalog_entries(&self) -> Vec<SkillCatalogEntry> {
        let mut entries: Vec<SkillCatalogEntry> = self
            .skills
            .values()
            .map(|skill| SkillCatalogEntry {
                name: skill.name.clone(),
                description: skill.description.clone(),
                compatibility: skill.compatibility.clone(),
            })
            .collect();
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        entries
    }

    pub fn has_skill(&self, name: &str) -> bool {
        self.skills.contains_key(name)
    }

    pub fn activate(&self, name: &str, already_active: bool) -> ToolResult {
        let Some(skill) = self.skills.get(name) else {
            return ToolResult {
                content: format!("Error: unknown skill '{}'", name),
                is_error: true,
            };
        };

        let mut content = String::new();
        if already_active {
            content.push_str(&format!(
                "<skill_content name=\"{}\" already_active=\"true\">\n",
                escape_xml(&skill.name)
            ));
            content.push_str(
                "This skill is already active in the current conversation, so its instructions are not being re-injected.\n\n",
            );
        } else {
            content.push_str(&format!(
                "<skill_content name=\"{}\">\n",
                escape_xml(&skill.name)
            ));
            if let Some(compatibility) = &skill.compatibility {
                content.push_str(&format!("Compatibility: {}\n\n", compatibility));
            }
            content.push_str(&skill.body);
            if !skill.body.ends_with('\n') {
                content.push('\n');
            }
            content.push('\n');
        }

        content.push_str(&format!(
            "Skill directory: {}\n",
            skill.skill_root_visible.display()
        ));
        content.push_str("Relative paths in this skill are relative to the skill directory.\n");
        if !skill.resources.is_empty() {
            content.push_str("<skill_resources>\n");
            for resource in &skill.resources {
                content.push_str(&format!("  <file>{}</file>\n", escape_xml(resource)));
            }
            content.push_str("</skill_resources>\n");
        }
        content.push_str("</skill_content>");

        ToolResult {
            content,
            is_error: false,
        }
    }
}

#[cfg(test)]
impl SkillRegistry {
    pub(crate) fn load_for_test(records: Vec<SkillRecord>) -> Self {
        let skills = records
            .into_iter()
            .map(|record| (record.name.clone(), record))
            .collect();
        Self {
            skills: Arc::new(skills),
        }
    }
}

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

fn discover_skill_sources(workspace_dir: Option<&Path>) -> Result<Vec<SkillSource>> {
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

    if let Some(nac_home) = nac_home_dir() {
        sources.push(SkillSource {
            host_root: nac_home.join("skills"),
            guest_root: PathBuf::from(USER_NAC_HOME_SKILLS_GUEST_ROOT),
            precedence: 2,
        });
    }

    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        sources.push(SkillSource {
            host_root: home.join(".agents").join("skills"),
            guest_root: PathBuf::from(USER_AGENTS_HOME_SKILLS_GUEST_ROOT),
            precedence: 3,
        });
    }

    sources.sort_by_key(|source| source.precedence);
    Ok(sources)
}

fn visible_root_for_source(
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

fn discover_skill_dirs(root: &Path) -> Result<Vec<PathBuf>> {
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

fn parse_skill_file(path: &Path) -> Result<Option<ParsedSkillFile>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read skill file '{}'", path.display()))?;
    let Some((frontmatter_raw, body_raw)) = split_frontmatter(&raw) else {
        eprintln!(
            "Skill file '{}' is missing YAML frontmatter and will be skipped",
            path.display()
        );
        return Ok(None);
    };

    let frontmatter = match parse_frontmatter(frontmatter_raw) {
        Ok(frontmatter) => frontmatter,
        Err(error) => {
            eprintln!(
                "Skill file '{}' has invalid frontmatter and will be skipped: {:#}",
                path.display(),
                error
            );
            return Ok(None);
        }
    };

    let name = frontmatter.name.trim().to_string();
    if name.is_empty() {
        eprintln!(
            "Skill file '{}' has an empty name and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    if let Some(parent) = path
        .parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
    {
        if parent != name {
            eprintln!(
                "Skill '{}' in '{}' does not match parent directory name '{}'; loading anyway",
                name,
                path.display(),
                parent
            );
        }
    }

    let Some(description) = frontmatter
        .description
        .map(|value| value.trim().to_string())
    else {
        eprintln!(
            "Skill file '{}' is missing a description and will be skipped",
            path.display()
        );
        return Ok(None);
    };
    if description.is_empty() {
        eprintln!(
            "Skill file '{}' has an empty description and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    let body = body_raw.trim().to_string();
    if body.is_empty() {
        eprintln!(
            "Skill file '{}' has no body content and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    Ok(Some(ParsedSkillFile {
        name,
        description,
        compatibility: frontmatter
            .compatibility
            .map(|value| value.trim().to_string()),
        body,
    }))
}

fn parse_frontmatter(raw: &str) -> Result<SkillFrontmatter> {
    match serde_yaml::from_str(raw) {
        Ok(frontmatter) => Ok(frontmatter),
        Err(_) => {
            let repaired = repair_frontmatter(raw);
            serde_yaml::from_str(&repaired).map_err(|error| anyhow!(error))
        }
    }
}

fn repair_frontmatter(raw: &str) -> String {
    let mut repaired = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            repaired.push(line.to_string());
            continue;
        }

        let Some((key, value)) = line.split_once(':') else {
            repaired.push(line.to_string());
            continue;
        };
        let key_trimmed = key.trim();
        let value_trimmed = value.trim();
        if !matches!(
            key_trimmed,
            "name" | "description" | "compatibility" | "license"
        ) {
            repaired.push(line.to_string());
            continue;
        }
        if value_trimmed.is_empty()
            || value_trimmed.starts_with('"')
            || value_trimmed.starts_with('\'')
            || value_trimmed.starts_with('[')
            || value_trimmed.starts_with('{')
            || value_trimmed.starts_with('|')
            || value_trimmed.starts_with('>')
        {
            repaired.push(line.to_string());
            continue;
        }

        repaired.push(format!(
            "{}: {}",
            key_trimmed,
            serde_json::to_string(value_trimmed).unwrap_or_else(|_| "\"\"".to_string())
        ));
    }
    repaired.join("\n")
}

fn split_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    let frontmatter = &rest[..end];
    let body = &rest[end + 5..];
    Some((frontmatter, body))
}

fn list_skill_resources(skill_root: &Path) -> Result<Vec<String>> {
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

fn find_project_root(workspace_dir: &Path) -> Option<PathBuf> {
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

fn join_path(base: &Path, suffix: &Path) -> PathBuf {
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

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

struct ParsedSkillFile {
    name: String,
    description: String,
    compatibility: Option<String>,
    body: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::{SandboxSpec, DEFAULT_SANDBOX_IMAGE, DEFAULT_SANDBOX_WORKDIR};
    use crate::TEST_ENV_LOCK;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nac_skills_test_{}_{}", label, unique));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_skill(root: &Path, name: &str, description: &str, body: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(SKILL_FILENAME),
            format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"),
        )
        .unwrap();
        dir
    }

    #[test]
    fn project_sources_override_user_sources() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let root = temp_dir("precedence");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let project_skills = repo.join(".nac/skills");
        let agents_skills = repo.join(".agents/skills");
        let user_skills = root.join("home/.config/nac/skills");
        fs::create_dir_all(&project_skills).unwrap();
        fs::create_dir_all(&agents_skills).unwrap();
        fs::create_dir_all(&user_skills).unwrap();

        write_skill(&user_skills, "build", "user", "user body");
        write_skill(
            &agents_skills,
            "build",
            "project agents",
            "project agents body",
        );
        write_skill(&project_skills, "build", "project nac", "project nac body");

        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", root.join("home/.config/nac"));
        }

        let registry = SkillRegistry::load(Some(&repo), None).unwrap().unwrap();
        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let entry = registry
            .catalog_entries()
            .into_iter()
            .find(|entry| entry.name == "build")
            .unwrap();
        assert_eq!(entry.description, "project nac");
        let activated = registry.activate("build", false);
        assert!(activated.content.contains("project nac body"));
    }

    #[test]
    fn missing_description_skips_skill() {
        let root = temp_dir("missing_desc");
        let skill_root = root.join("repo/.agents/skills/foo");
        fs::create_dir_all(&skill_root).unwrap();
        fs::create_dir_all(root.join("repo/.git")).unwrap();
        fs::write(
            skill_root.join(SKILL_FILENAME),
            "---\nname: foo\n---\n\nbody\n",
        )
        .unwrap();

        let registry = SkillRegistry::load(Some(&root.join("repo")), None).unwrap();
        assert!(registry.is_none());
    }

    #[test]
    fn activation_uses_guest_path_when_sandboxed() {
        let root = temp_dir("sandboxed_path");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let project_skills = repo.join(".agents/skills");
        fs::create_dir_all(&project_skills).unwrap();
        let skill_dir = write_skill(&project_skills, "lint", "lint code", "body");

        let sandbox = SandboxSession::new_for_test(SandboxSpec {
            image: DEFAULT_SANDBOX_IMAGE.to_string(),
            mounts: vec![
                MountSpec {
                    host: repo.clone(),
                    guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                    read_only: false,
                },
                MountSpec {
                    host: project_skills.clone(),
                    guest: PathBuf::from(PROJECT_AGENTS_SKILLS_GUEST_ROOT),
                    read_only: true,
                },
            ],
            workdir: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
        });

        let registry = SkillRegistry::load(Some(&repo), Some(&sandbox))
            .unwrap()
            .unwrap();
        let activated = registry.activate("lint", false);
        assert!(
            activated.content.contains("/workspace/.agents/skills/lint")
                || activated
                    .content
                    .contains(&format!("{}/lint", PROJECT_AGENTS_SKILLS_GUEST_ROOT))
        );
        assert!(activated.content.contains("body"));
        assert_eq!(skill_dir, project_skills.join("lint"));
    }

    #[test]
    fn auto_mounts_skip_paths_already_covered_by_workspace_mount() {
        let root = temp_dir("auto_mounts_covered");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join(".agents/skills")).unwrap();

        let mounts = auto_mounts(
            &repo,
            &[MountSpec {
                host: repo.clone(),
                guest: PathBuf::from(DEFAULT_SANDBOX_WORKDIR),
                read_only: false,
            }],
        )
        .unwrap();
        assert!(mounts.is_empty());
    }

    #[test]
    fn repair_frontmatter_handles_unquoted_colons() {
        let frontmatter = "name: lint\ndescription: Use when handling foo:bar tasks\n";
        let parsed = parse_frontmatter(frontmatter).unwrap();
        assert_eq!(
            parsed.description.as_deref(),
            Some("Use when handling foo:bar tasks")
        );
    }

    #[test]
    fn repeated_activation_returns_short_notice() {
        let root = temp_dir("activation_dedupe");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let project_skills = repo.join(".agents/skills");
        fs::create_dir_all(&project_skills).unwrap();
        write_skill(&project_skills, "lint", "lint code", "full body");

        let registry = SkillRegistry::load(Some(&repo), None).unwrap().unwrap();
        let first = registry.activate("lint", false);
        let second = registry.activate("lint", true);

        assert!(first.content.contains("full body"));
        assert!(second.content.contains("already active"));
        assert!(!second.content.contains("full body"));
    }
}
