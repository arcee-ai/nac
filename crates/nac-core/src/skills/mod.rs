use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;

use crate::paths::PathContext;
use crate::sandbox::{MountSpec, SandboxSession};
use crate::tools::ToolResult;

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
pub use tool::auto_mounts;

use discovery::*;
use frontmatter::*;
use resources::*;

#[derive(Clone, Debug)]
pub struct SkillRecord {
    pub name: String,
    pub description: String,
    pub compatibility: Option<String>,
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

    struct EnvVarGuard {
        name: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set_path(name: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(name);
            unsafe {
                std::env::set_var(name, value);
            }
            Self { name, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => unsafe { std::env::set_var(self.name, value) },
                None => unsafe { std::env::remove_var(self.name) },
            }
        }
    }

    fn isolate_user_skill_env(root: &Path) -> Vec<EnvVarGuard> {
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        vec![
            EnvVarGuard::set_path("HOME", &home),
            EnvVarGuard::set_path("NAC_HOME", &home.join(".config/nac")),
            EnvVarGuard::set_path("XDG_CONFIG_HOME", &home.join(".config")),
        ]
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
        let _env = isolate_user_skill_env(&root);
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

        let registry = SkillRegistry::load(Some(&repo), None, &PathContext::new(&repo))
            .unwrap()
            .unwrap();
        let entry = registry
            .catalog_entries()
            .into_iter()
            .find(|entry| entry.name == "build")
            .unwrap();
        assert_eq!(entry.description, "project nac");
        let activated = registry.activate("build");
        assert!(activated.content.contains("project nac body"));
    }

    #[test]
    fn missing_description_skips_skill() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let root = temp_dir("missing_desc");
        let _env = isolate_user_skill_env(&root);
        let skill_root = root.join("repo/.agents/skills/foo");
        fs::create_dir_all(&skill_root).unwrap();
        fs::create_dir_all(root.join("repo/.git")).unwrap();
        fs::write(
            skill_root.join(SKILL_FILENAME),
            "---\nname: foo\n---\n\nbody\n",
        )
        .unwrap();

        let repo = root.join("repo");
        let registry = SkillRegistry::load(Some(&repo), None, &PathContext::new(&repo)).unwrap();
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
            backend: crate::sandbox::SandboxBackendType::Podman,
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

        let registry = SkillRegistry::load(Some(&repo), Some(&sandbox), &PathContext::new(&repo))
            .unwrap()
            .unwrap();
        let activated = registry.activate("lint");
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
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let root = temp_dir("auto_mounts_covered");
        let _env = isolate_user_skill_env(&root);
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
            &PathContext::new(&repo),
        )
        .unwrap();
        assert!(mounts.is_empty());
    }

    #[test]
    fn user_skill_sources_use_explicit_path_context_for_relative_env_paths() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let root = temp_dir("relative_user_sources");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home_rel = PathBuf::from(format!("target/nac-skills-home-{unique}"));
        let nac_home_rel = PathBuf::from(format!("target/nac-skills-nac-home-{unique}"));
        let nac_home_skills = root.join(&nac_home_rel).join("skills");
        let agents_home_skills = root.join(&home_rel).join(".agents/skills");
        fs::create_dir_all(&nac_home_skills).unwrap();
        fs::create_dir_all(&agents_home_skills).unwrap();
        let ambient_home = std::env::current_dir().unwrap().join(&home_rel);
        let ambient_nac_home = std::env::current_dir().unwrap().join(&nac_home_rel);
        fs::create_dir_all(&ambient_home).unwrap();
        fs::create_dir_all(&ambient_nac_home).unwrap();
        write_skill(&nac_home_skills, "nac-home-skill", "nac home", "nac body");
        write_skill(
            &agents_home_skills,
            "agents-home-skill",
            "agents home",
            "agents body",
        );

        let original_home = std::env::var_os("HOME");
        let original_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("HOME", &home_rel);
            std::env::set_var("NAC_HOME", &nac_home_rel);
        }

        let registry = SkillRegistry::load(None, None, &PathContext::new(&root))
            .unwrap()
            .unwrap();
        let names: Vec<String> = registry
            .catalog_entries()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["agents-home-skill", "nac-home-skill"]);

        match original_home {
            Some(value) => unsafe { std::env::set_var("HOME", value) },
            None => unsafe { std::env::remove_var("HOME") },
        }
        match original_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = fs::remove_dir_all(ambient_home);
        let _ = fs::remove_dir_all(ambient_nac_home);
    }

    #[test]
    fn cwd_equals_home_produces_no_duplicate_sources() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let root = temp_dir("cwd_eq_home");
        let _env = isolate_user_skill_env(&root);
        // Use the isolated home directory as both workspace and home.
        // No .git inside, so find_project_root falls back to workspace_dir == home.
        let home = root.join("home");
        fs::create_dir_all(home.join(".agents/skills")).unwrap();
        write_skill(&home.join(".agents/skills"), "demo", "demo skill", "body");

        let sources = discover_skill_sources(Some(&home), &PathContext::new(&home)).unwrap();
        let mut seen = std::collections::HashSet::new();
        for source in &sources {
            assert!(
                seen.insert(source.host_root.clone()),
                "duplicate host_root: {}",
                source.host_root.display()
            );
        }
    }

    #[test]
    fn frontmatter_repairs_colons_and_ignores_disable_model_invocation() {
        let frontmatter = "name: lint\ndescription: Use when handling foo:bar tasks\ndisable-model-invocation: true\n";
        let parsed = parse_frontmatter(frontmatter).unwrap();
        assert_eq!(
            parsed.description.as_deref(),
            Some("Use when handling foo:bar tasks")
        );
    }
}
