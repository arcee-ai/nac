//! Directory listing for the in-app path picker.
//!
//! Browsers deliberately withhold absolute paths from `<input type="file">`,
//! `webkitdirectory` and the File System Access API, so a working directory or
//! config file can only be chosen against the filesystem this server sees.
//! Listing stays metadata-only: names, kinds and absolute paths, never
//! contents.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Entries returned for one directory. The picker is a navigation aid, so an
/// enormous directory is truncated rather than serialized in full.
const MAX_ENTRIES: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[derive(utoipa::ToSchema)]
pub enum BrowseKind {
    /// Directories only, for picking a working directory.
    #[default]
    Directory,
    /// Directories plus `.toml` files, for picking a configuration file.
    Toml,
    /// Directories plus every file, for picking one that carries no telling
    /// extension — an ssh key or `~/.ssh/config`, say.
    File,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct BrowseQuery {
    /// Absolute path to list. A leading `~` expands to the home directory.
    pub path: Option<String>,
    #[serde(default)]
    pub kind: BrowseKind,
    /// Dot-prefixed names are hidden unless explicitly requested.
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct BrowseEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct BrowseListing {
    /// Canonical path of the listed directory.
    pub path: String,
    /// `None` at a filesystem root, which is where upward navigation stops.
    pub parent: Option<String>,
    pub home: Option<String>,
    pub entries: Vec<BrowseEntry>,
    pub truncated: bool,
}

#[derive(Debug)]
pub enum BrowseError {
    NotFound(String),
    NotADirectory(String),
    Unreadable { path: String, reason: String },
}

impl std::fmt::Display for BrowseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(path) => write!(formatter, "path '{path}' does not exist"),
            Self::NotADirectory(path) => write!(formatter, "path '{path}' is not a directory"),
            Self::Unreadable { path, reason } => {
                write!(formatter, "could not read directory '{path}': {reason}")
            }
        }
    }
}

impl std::error::Error for BrowseError {}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn expand_home(path: &str, home: Option<PathBuf>) -> PathBuf {
    let Some(rest) = path.strip_prefix('~') else {
        return PathBuf::from(path);
    };
    let Some(home) = home else {
        return PathBuf::from(path);
    };
    match rest.strip_prefix('/') {
        Some(relative) => home.join(relative),
        // `~user` names another account's home, which this shorthand does not
        // resolve; leave it to fail as a literal path instead of guessing.
        None if rest.is_empty() => home,
        None => PathBuf::from(path),
    }
}

fn keeps_entry(kind: BrowseKind, is_directory: bool, path: &Path) -> bool {
    if is_directory {
        return true;
    }
    match kind {
        BrowseKind::Directory => false,
        BrowseKind::Toml => path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("toml")),
        BrowseKind::File => true,
    }
}

/// List `query.path`, falling back to `fallback` when the caller has no path yet.
pub fn browse(query: &BrowseQuery, fallback: &Path) -> Result<BrowseListing, BrowseError> {
    let requested = query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());
    let target = match requested {
        Some(path) => expand_home(path, home_dir()),
        None => fallback.to_path_buf(),
    };

    // Canonicalizing keeps the picker on real paths: `..` segments collapse and
    // symlinked directories report where they actually lead.
    let target = std::fs::canonicalize(&target)
        .map_err(|_| BrowseError::NotFound(target.display().to_string()))?;
    if !target.is_dir() {
        return Err(BrowseError::NotADirectory(target.display().to_string()));
    }

    let reader = std::fs::read_dir(&target).map_err(|error| BrowseError::Unreadable {
        path: target.display().to_string(),
        reason: error.to_string(),
    })?;

    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in reader {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !query.hidden && name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        // Follows symlinks so a link to a directory is navigable; an entry we
        // cannot stat at all (a broken link, say) is not worth offering.
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let is_directory = metadata.is_dir();
        if !keeps_entry(query.kind, is_directory, &path) {
            continue;
        }
        if entries.len() == MAX_ENTRIES {
            truncated = true;
            break;
        }
        entries.push(BrowseEntry {
            name,
            path: path.display().to_string(),
            is_directory,
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(BrowseListing {
        path: target.display().to_string(),
        parent: target
            .parent()
            .map(|parent| parent.display().to_string())
            .filter(|parent| !parent.is_empty()),
        home: home_dir().map(|home| home.display().to_string()),
        entries,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory tree with one subdirectory, one `.toml` file and one
    /// unrelated file. Returns the canonical root, which is what listings echo.
    fn sample_tree(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_browse_test_{label}_{unique}"));
        std::fs::create_dir_all(root.join("project")).unwrap();
        std::fs::write(root.join("config.toml"), "").unwrap();
        std::fs::write(root.join("notes.txt"), "").unwrap();
        std::fs::canonicalize(&root).unwrap()
    }

    fn query(root: &Path, kind: BrowseKind) -> BrowseQuery {
        BrowseQuery {
            path: Some(root.display().to_string()),
            kind,
            hidden: false,
        }
    }

    fn names(listing: &BrowseListing) -> Vec<&str> {
        listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect()
    }

    #[test]
    fn picking_a_working_directory_shows_directories_only() {
        let root = sample_tree("directories");

        let listing = browse(&query(&root, BrowseKind::Directory), Path::new("/")).unwrap();

        assert_eq!(names(&listing), vec!["project"]);
        assert_eq!(listing.path, root.display().to_string());
        assert!(listing.entries[0].is_directory);
        assert_eq!(
            listing.entries[0].path,
            root.join("project").display().to_string()
        );
        assert!(!listing.truncated);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn picking_a_config_file_adds_toml_files_and_nothing_else() {
        let root = sample_tree("toml");
        std::fs::write(root.join("OTHER.TOML"), "").unwrap();

        let listing = browse(&query(&root, BrowseKind::Toml), Path::new("/")).unwrap();

        assert_eq!(
            names(&listing),
            vec!["project", "config.toml", "OTHER.TOML"]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dot_prefixed_entries_are_listed_only_when_asked_for() {
        let root = sample_tree("hidden");
        std::fs::create_dir(root.join(".cache")).unwrap();

        let hidden_off = browse(&query(&root, BrowseKind::Directory), Path::new("/")).unwrap();
        assert_eq!(names(&hidden_off), vec!["project"]);

        let hidden_on = browse(
            &BrowseQuery {
                hidden: true,
                ..query(&root, BrowseKind::Directory)
            },
            Path::new("/"),
        )
        .unwrap();
        assert_eq!(names(&hidden_on), vec![".cache", "project"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn entries_are_ordered_directories_first_then_by_name_ignoring_case() {
        let root = sample_tree("sorting");
        std::fs::create_dir(root.join("Alpha")).unwrap();
        std::fs::create_dir(root.join("beta")).unwrap();
        std::fs::write(root.join("Apply.toml"), "").unwrap();

        let listing = browse(&query(&root, BrowseKind::Toml), Path::new("/")).unwrap();

        assert_eq!(
            names(&listing),
            vec!["Alpha", "beta", "project", "Apply.toml", "config.toml"]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_caller_without_a_path_yet_lands_on_the_fallback() {
        let root = sample_tree("fallback");

        for path in [None, Some(String::new()), Some("   ".to_string())] {
            let listing = browse(
                &BrowseQuery {
                    path,
                    ..Default::default()
                },
                &root,
            )
            .unwrap();
            assert_eq!(listing.path, root.display().to_string());
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn relative_segments_collapse_so_navigation_stays_on_real_paths() {
        let root = sample_tree("canonical");

        let listing = browse(
            &BrowseQuery {
                path: Some(root.join("project").join("..").display().to_string()),
                ..Default::default()
            },
            Path::new("/"),
        )
        .unwrap();

        assert_eq!(listing.path, root.display().to_string());
        assert_eq!(
            listing.parent.as_deref(),
            Some(root.parent().unwrap().display().to_string().as_str())
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn upward_navigation_stops_at_the_filesystem_root() {
        let listing = browse(
            &BrowseQuery {
                path: Some("/".to_string()),
                ..Default::default()
            },
            Path::new("/"),
        )
        .unwrap();

        assert_eq!(listing.parent, None);
    }

    #[test]
    fn a_missing_path_and_a_file_path_are_reported_differently() {
        let root = sample_tree("errors");

        let missing = browse(
            &BrowseQuery {
                path: Some(root.join("nope").display().to_string()),
                ..Default::default()
            },
            Path::new("/"),
        )
        .unwrap_err();
        assert!(
            matches!(&missing, BrowseError::NotFound(path) if path.ends_with("nope")),
            "unexpected error: {missing:?}"
        );

        let file = browse(
            &BrowseQuery {
                path: Some(root.join("notes.txt").display().to_string()),
                ..Default::default()
            },
            Path::new("/"),
        )
        .unwrap_err();
        assert!(
            matches!(&file, BrowseError::NotADirectory(path) if path.ends_with("notes.txt")),
            "unexpected error: {file:?}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_leading_tilde_resolves_against_the_home_directory() {
        let home = PathBuf::from("/home/operator");

        assert_eq!(expand_home("~", Some(home.clone())), home);
        assert_eq!(expand_home("~/", Some(home.clone())), home);
        assert_eq!(
            expand_home("~/projects/nac", Some(home.clone())),
            home.join("projects/nac")
        );
        // `~user` names another account, so it is left to fail as a literal path.
        assert_eq!(
            expand_home("~other", Some(home.clone())),
            PathBuf::from("~other")
        );
        assert_eq!(
            expand_home("/var/tmp", Some(home)),
            PathBuf::from("/var/tmp")
        );
        assert_eq!(expand_home("~", None), PathBuf::from("~"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_followed_and_broken_ones_are_skipped() {
        let root = sample_tree("symlinks");
        std::os::unix::fs::symlink(root.join("project"), root.join("link-to-dir")).unwrap();
        std::os::unix::fs::symlink(root.join("gone"), root.join("dangling")).unwrap();

        let listing = browse(&query(&root, BrowseKind::Directory), Path::new("/")).unwrap();

        assert_eq!(names(&listing), vec!["link-to-dir", "project"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_enormous_directory_is_truncated_rather_than_serialized_in_full() {
        let root = sample_tree("truncation");
        for index in 0..=MAX_ENTRIES {
            std::fs::create_dir(root.join(format!("dir-{index:05}"))).unwrap();
        }

        let listing = browse(&query(&root, BrowseKind::Directory), Path::new("/")).unwrap();

        assert!(listing.truncated);
        assert_eq!(listing.entries.len(), MAX_ENTRIES);

        let _ = std::fs::remove_dir_all(&root);
    }
}
