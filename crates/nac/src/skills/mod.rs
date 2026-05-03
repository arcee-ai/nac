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

mod discovery;
mod frontmatter;
mod registry;
mod resources;
mod tool;

pub use registry::SkillRegistry;
pub use tool::{auto_mounts, execute_activate_skill};

use discovery::*;
use frontmatter::*;
use resources::*;

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
