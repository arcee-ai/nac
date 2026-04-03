use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::paths::{nac_config_path, nac_home_dir};

const AGENTS_MD_MAX_BYTES: usize = 32 * 1024;
const AGENTS_MD_NOTICE: &str =
    "Below are instructions from the user's AGENTS.md configuration files. More specific files override broader ones when they conflict.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentsMdFile {
    pub path: PathBuf,
    pub content: String,
}

#[derive(Clone, Debug, Default)]
pub struct AgentsMdBundle {
    files: Vec<AgentsMdFile>,
}

#[derive(Debug, Default, Deserialize)]
struct AgentsMdConfigFile {
    #[serde(default)]
    project_doc_fallback_filenames: Vec<String>,
    #[serde(default = "default_max_bytes")]
    project_doc_max_bytes: usize,
}

#[derive(Debug, Clone)]
struct AgentsMdSettings {
    fallback_filenames: Vec<String>,
    max_bytes: usize,
}

impl AgentsMdBundle {
    pub fn load(workspace_dir: Option<&Path>) -> Result<Self> {
        let settings = load_settings();
        let mut files = Vec::new();

        if let Some(global_file) = select_non_empty_file(
            nac_home_dir().as_deref(),
            &["AGENTS.override.md", "AGENTS.md"],
        )? {
            files.push(global_file);
        }

        if let Some(workspace_dir) = workspace_dir {
            let root =
                find_project_root(workspace_dir).unwrap_or_else(|| workspace_dir.to_path_buf());
            for dir in dirs_from_root_to_scope(&root, workspace_dir) {
                let mut names = vec!["AGENTS.override.md", "AGENTS.md"];
                for fallback in &settings.fallback_filenames {
                    names.push(fallback.as_str());
                }
                if let Some(file) = select_non_empty_file(Some(&dir), &names)? {
                    files.push(file);
                }
            }
        }

        Ok(Self {
            files: truncate_files_to_limit(files, settings.max_bytes),
        })
    }

    pub fn status_text(&self) -> String {
        match self.files.len() {
            0 => "off".to_string(),
            1 => "1 file loaded".to_string(),
            count => format!("{count} files loaded"),
        }
    }

    pub fn system_message(&self) -> Option<String> {
        if self.files.is_empty() {
            return None;
        }

        Some(render_system_message(&self.files))
    }

    pub fn files(&self) -> &[AgentsMdFile] {
        &self.files
    }
}

fn render_system_message(files: &[AgentsMdFile]) -> String {
    let docs = files
        .iter()
        .map(|file| file.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    format!("{AGENTS_MD_NOTICE}\n\n{docs}")
}

fn truncate_files_to_limit(files: Vec<AgentsMdFile>, max_bytes: usize) -> Vec<AgentsMdFile> {
    let mut kept = Vec::new();
    let mut used_bytes = 0usize;

    for mut file in files {
        let separator_bytes = if kept.is_empty() { 0 } else { 2 };
        let remaining = max_bytes.saturating_sub(used_bytes + separator_bytes);
        if remaining == 0 {
            break;
        }

        if file.content.len() > remaining {
            file.content = truncate_utf8_to_bytes(&file.content, remaining);
            kept.push(file);
            break;
        }

        used_bytes += separator_bytes + file.content.len();
        kept.push(file);
    }

    kept
}

fn select_non_empty_file(dir: Option<&Path>, filenames: &[&str]) -> Result<Option<AgentsMdFile>> {
    let Some(dir) = dir else {
        return Ok(None);
    };

    for name in filenames {
        let path = dir.join(name);
        if !path.is_file() {
            continue;
        }
        if let Some(file) = read_non_empty_file(&path)? {
            return Ok(Some(file));
        }
    }

    Ok(None)
}

fn read_non_empty_file(path: &Path) -> Result<Option<AgentsMdFile>> {
    let content = fs::read_to_string(path)
        .with_context(|| format!("failed to read AGENTS.md file '{}'", path.display()))?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(Some(AgentsMdFile {
        path: path.to_path_buf(),
        content: trimmed.to_string(),
    }))
}

fn find_project_root(workspace_dir: &Path) -> Option<PathBuf> {
    let mut current = Some(workspace_dir);
    while let Some(dir) = current {
        if dir.join(".git").is_dir() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

fn dirs_from_root_to_scope(root: &Path, scope: &Path) -> Vec<PathBuf> {
    if !scope.starts_with(root) {
        return vec![scope.to_path_buf()];
    }

    let mut dirs = vec![root.to_path_buf()];
    let mut current = root.to_path_buf();
    if let Ok(relative) = scope.strip_prefix(root) {
        for component in relative.components() {
            current.push(component.as_os_str());
            dirs.push(current.clone());
        }
    }
    dirs
}

fn truncate_utf8_to_bytes(content: &str, max_bytes: usize) -> String {
    if content.len() <= max_bytes {
        return content.to_string();
    }

    let mut end = max_bytes.min(content.len());
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    content[..end].to_string()
}

fn load_settings() -> AgentsMdSettings {
    let mut settings = AgentsMdSettings {
        fallback_filenames: Vec::new(),
        max_bytes: AGENTS_MD_MAX_BYTES,
    };

    let Some(path) = nac_config_path() else {
        return settings;
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return settings;
    };
    let Ok(config) = toml::from_str::<AgentsMdConfigFile>(&raw) else {
        return settings;
    };

    settings.fallback_filenames = config.project_doc_fallback_filenames;
    settings.max_bytes = config.project_doc_max_bytes.max(1);
    settings
}

fn default_max_bytes() -> usize {
    AGENTS_MD_MAX_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn temp_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nac_agents_md_{label}_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn loads_global_and_project_files_in_order() {
        let _guard = ENV_LOCK.lock().unwrap();
        let root = temp_dir("hierarchy");
        let nac_home = root.join("nac-home");
        let project_root = root.join("repo");
        let nested = project_root.join("src").join("deep");

        fs::create_dir_all(&nac_home).unwrap();
        fs::create_dir_all(project_root.join(".git")).unwrap();
        fs::create_dir_all(&nested).unwrap();
        fs::write(nac_home.join("AGENTS.md"), "global").unwrap();
        fs::write(project_root.join("AGENTS.md"), "root").unwrap();
        fs::write(
            project_root.join("src").join("AGENTS.override.md"),
            "src override",
        )
        .unwrap();
        fs::write(nested.join("AGENTS.md"), "deep").unwrap();

        let original_nac_home = env::var_os("NAC_HOME");
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let bundle = AgentsMdBundle::load(Some(&nested)).unwrap();
        let contents: Vec<&str> = bundle
            .files()
            .iter()
            .map(|file| file.content.as_str())
            .collect();
        assert_eq!(contents, vec!["global", "root", "src override", "deep"]);

        match original_nac_home {
            Some(value) => unsafe { env::set_var("NAC_HOME", value) },
            None => unsafe { env::remove_var("NAC_HOME") },
        }
    }

    #[test]
    fn git_file_does_not_mark_project_root() {
        let root = temp_dir("git_file_not_root");
        let project_root = root.join("repo");
        let nested = project_root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(project_root.join(".git"), "gitdir: /tmp/fake").unwrap();

        assert!(find_project_root(&nested).is_none());
    }

    #[test]
    fn non_git_scope_only_loads_current_directory_file() {
        let _guard = ENV_LOCK.lock().unwrap();
        let root = temp_dir("non_git");
        let parent = root.join("parent");
        let child = parent.join("child");
        fs::create_dir_all(&child).unwrap();
        fs::write(parent.join("AGENTS.md"), "parent").unwrap();
        fs::write(child.join("AGENTS.md"), "child").unwrap();

        let bundle = AgentsMdBundle::load(Some(&child)).unwrap();
        let contents: Vec<&str> = bundle
            .files()
            .iter()
            .map(|file| file.content.as_str())
            .collect();
        assert_eq!(contents, vec!["child"]);
    }

    #[test]
    fn truncation_preserves_order_until_limit() {
        let files = vec![
            AgentsMdFile {
                path: PathBuf::from("/repo/AGENTS.md"),
                content: "broad broad broad broad".to_string(),
            },
            AgentsMdFile {
                path: PathBuf::from("/repo/src/AGENTS.md"),
                content: "specific specific specific".to_string(),
            },
        ];

        let trimmed = truncate_files_to_limit(files, 30);
        assert_eq!(trimmed.len(), 2);
        assert_eq!(trimmed[0].content, "broad broad broad broad");
        assert!(trimmed[1].content.len() < "specific specific specific".len());
    }

    #[test]
    fn empty_override_falls_back_to_agents_md() {
        let root = temp_dir("empty_override");
        fs::write(root.join("AGENTS.override.md"), "\n\n").unwrap();
        fs::write(root.join("AGENTS.md"), "fallback").unwrap();

        let selected =
            select_non_empty_file(Some(&root), &["AGENTS.override.md", "AGENTS.md"]).unwrap();
        assert_eq!(selected.unwrap().content, "fallback");
    }

    #[test]
    fn project_fallback_filenames_are_respected() {
        let _guard = ENV_LOCK.lock().unwrap();
        let root = temp_dir("fallback_names");
        let nac_home = root.join("nac-home");
        let project = root.join("repo");
        fs::create_dir_all(&nac_home).unwrap();
        fs::create_dir_all(project.join(".git")).unwrap();
        fs::write(
            nac_home.join("config.toml"),
            "project_doc_fallback_filenames = [\"TEAM_GUIDE.md\"]\n",
        )
        .unwrap();
        fs::write(project.join("TEAM_GUIDE.md"), "team guide").unwrap();

        let original_nac_home = env::var_os("NAC_HOME");
        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let bundle = AgentsMdBundle::load(Some(&project)).unwrap();
        assert_eq!(bundle.files().len(), 1);
        assert_eq!(bundle.files()[0].content, "team guide");

        match original_nac_home {
            Some(value) => unsafe { env::set_var("NAC_HOME", value) },
            None => unsafe { env::remove_var("NAC_HOME") },
        }
    }
}
