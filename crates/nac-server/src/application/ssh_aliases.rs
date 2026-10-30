//! Read-only discovery of literal OpenSSH host aliases configured for the
//! NAC server's own user.
//!
//! The walk reads `~/.ssh/config` and the `Include` files it can resolve
//! statically, and returns alias names only. It never runs a command, never
//! evaluates `Match` criteria or `%` tokens, and never reports a file's
//! contents, a resolved path, or any other directive's value. Each limit below
//! degrades to a partial result plus a content-free warning, so a broken or
//! hostile config can never break saved profiles or manual entry.

mod ssh_config;

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

use ssh_config::{Directive, HostPattern};

#[cfg(test)]
#[path = "ssh_aliases_tests.rs"]
mod tests;

/// Bytes read from any one file. Hand-written configs are a few kilobytes.
pub(crate) const MAX_FILE_BYTES: u64 = 256 * 1024;
/// Files read across the whole walk, the root config included.
pub(crate) const MAX_FILES: usize = 64;
/// Include nesting below the root config; matches OpenSSH's own limit.
pub(crate) const MAX_INCLUDE_DEPTH: usize = 16;
/// Aliases returned; beyond this a picker stops being useful.
pub(crate) const MAX_ALIASES: usize = 1000;
/// Directory entries examined to expand one `Include` glob.
pub(crate) const MAX_GLOB_ENTRIES: usize = 1024;

/// Why a discovery result may be incomplete. Each names a class of problem
/// only; none carries a path or file contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum AliasDiscoveryWarning {
    HomeUnavailable,
    UnreadableFile,
    OversizedFile,
    MissingInclude,
    IncludeCycle,
    IncludeDepthExceeded,
    FileLimitReached,
    AliasLimitReached,
    /// An Include that needs runtime evaluation (tokens, environment
    /// variables, directory or bracket globs) or whose glob is too large.
    UnsupportedInclude,
    /// An Include inside a `Match` block or a host-specific `Host` block,
    /// which OpenSSH applies only when that condition holds.
    ConditionalIncludeSkipped,
    MalformedLine,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AliasDiscovery {
    /// Literal aliases in first-seen order, without duplicates.
    pub(crate) aliases: Vec<String>,
    /// Host patterns that exist but cannot be listed (wildcards, negations
    /// and names ssh would not accept as a destination).
    pub(crate) undiscoverable_patterns: usize,
    /// Distinct warnings in first-seen order.
    pub(crate) warnings: Vec<AliasDiscoveryWarning>,
}

/// Discovers aliases from the server user's `~/.ssh/config`.
pub(crate) struct SshAliasApplication {
    home: Option<PathBuf>,
}

impl SshAliasApplication {
    pub(crate) fn for_server_user() -> Self {
        Self {
            home: crate::filesystem::home_dir(),
        }
    }

    pub(crate) async fn discover(self) -> anyhow::Result<AliasDiscovery> {
        Ok(tokio::task::spawn_blocking(move || discover(self.home.as_deref())).await?)
    }
}

pub(crate) fn discover(home: Option<&Path>) -> AliasDiscovery {
    let Some(home) = home.filter(|home| home.is_absolute()) else {
        let mut walk = Walk::new(PathBuf::new());
        walk.warn(AliasDiscoveryWarning::HomeUnavailable);
        return walk.finish();
    };
    let mut walk = Walk::new(home.to_path_buf());
    let root = home.join(".ssh").join("config");
    walk.visit(&root, 0, true);
    walk.finish()
}

struct Walk {
    home: PathBuf,
    result: AliasDiscovery,
    seen_aliases: HashSet<String>,
    /// Canonical files already read anywhere in the walk.
    visited: HashSet<PathBuf>,
    /// Canonical files on the current include chain, for cycle detection.
    chain: Vec<PathBuf>,
    files_read: usize,
}

impl Walk {
    fn new(home: PathBuf) -> Self {
        Self {
            home,
            result: AliasDiscovery::default(),
            seen_aliases: HashSet::new(),
            visited: HashSet::new(),
            chain: Vec::new(),
            files_read: 0,
        }
    }

    fn finish(self) -> AliasDiscovery {
        self.result
    }

    fn warn(&mut self, warning: AliasDiscoveryWarning) {
        if !self.result.warnings.contains(&warning) {
            self.result.warnings.push(warning);
        }
    }

    fn visit(&mut self, path: &Path, depth: usize, is_root: bool) {
        let canonical = match std::fs::canonicalize(path) {
            Ok(canonical) => canonical,
            // No ~/.ssh/config at all is the ordinary empty case.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !is_root {
                    self.warn(AliasDiscoveryWarning::MissingInclude);
                }
                return;
            }
            Err(_) => return self.warn(AliasDiscoveryWarning::UnreadableFile),
        };
        if self.chain.contains(&canonical) {
            return self.warn(AliasDiscoveryWarning::IncludeCycle);
        }
        // A file included twice without a cycle has already contributed.
        if self.visited.contains(&canonical) {
            return;
        }
        if self.files_read == MAX_FILES {
            return self.warn(AliasDiscoveryWarning::FileLimitReached);
        }
        self.files_read += 1;
        self.visited.insert(canonical.clone());
        let Some(text) = self.read(&canonical) else {
            return;
        };
        self.chain.push(canonical);
        self.walk_text(&text, depth);
        self.chain.pop();
    }

    fn read(&mut self, path: &Path) -> Option<String> {
        // Only regular files are opened, so a FIFO or device named by an
        // Include can neither block the walk nor stream unbounded data.
        match std::fs::metadata(path) {
            Ok(metadata) if !metadata.is_file() => {
                self.warn(AliasDiscoveryWarning::UnreadableFile);
                return None;
            }
            Ok(metadata) if metadata.len() > MAX_FILE_BYTES => {
                self.warn(AliasDiscoveryWarning::OversizedFile);
                return None;
            }
            Ok(_) => {}
            Err(_) => {
                self.warn(AliasDiscoveryWarning::UnreadableFile);
                return None;
            }
        }
        let mut bytes = Vec::new();
        let read = std::fs::File::open(path)
            .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes));
        if read.is_err() {
            self.warn(AliasDiscoveryWarning::UnreadableFile);
            return None;
        }
        // The size can grow between the stat and the read.
        if bytes.len() as u64 > MAX_FILE_BYTES {
            self.warn(AliasDiscoveryWarning::OversizedFile);
            return None;
        }
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn walk_text(&mut self, text: &str, depth: usize) {
        // Every file starts in the unconditional context of the Include that
        // reached it; only unconditional Includes are ever followed.
        let mut unconditional = true;
        for directive in ssh_config::parse(text) {
            match directive {
                Directive::Host(patterns) => {
                    unconditional = ssh_config::matches_every_host(&patterns);
                    for pattern in &patterns {
                        self.record(ssh_config::classify(pattern));
                    }
                }
                Directive::Match => unconditional = false,
                Directive::Include(_) if !unconditional => {
                    self.warn(AliasDiscoveryWarning::ConditionalIncludeSkipped);
                }
                Directive::Include(arguments) => {
                    for argument in arguments {
                        self.include(&argument, depth);
                    }
                }
                Directive::Malformed => self.warn(AliasDiscoveryWarning::MalformedLine),
            }
        }
    }

    fn record(&mut self, pattern: HostPattern) {
        match pattern {
            HostPattern::Undiscoverable => self.result.undiscoverable_patterns += 1,
            HostPattern::Literal(alias) => {
                if self.seen_aliases.contains(&alias) {
                    return;
                }
                if self.result.aliases.len() == MAX_ALIASES {
                    return self.warn(AliasDiscoveryWarning::AliasLimitReached);
                }
                self.seen_aliases.insert(alias.clone());
                self.result.aliases.push(alias);
            }
        }
    }

    fn include(&mut self, argument: &str, depth: usize) {
        if depth == MAX_INCLUDE_DEPTH {
            return self.warn(AliasDiscoveryWarning::IncludeDepthExceeded);
        }
        let Some(path) = self.resolve_include(argument) else {
            return self.warn(AliasDiscoveryWarning::UnsupportedInclude);
        };
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            return self.visit(&path, depth + 1, false);
        };
        if !name.contains(['*', '?']) {
            return self.visit(&path, depth + 1, false);
        }
        let Some(directory) = path.parent() else {
            return self.warn(AliasDiscoveryWarning::UnsupportedInclude);
        };
        let name = name.to_string();
        let Some(matches) = self.expand_glob(directory, &name) else {
            return;
        };
        for matched in matches {
            self.visit(&matched, depth + 1, false);
        }
    }

    /// Resolves an Include argument the way OpenSSH does for a user config:
    /// `~/` is the home directory, absolute paths stand, and anything else
    /// lives under `~/.ssh`. Anything needing runtime evaluation is refused.
    fn resolve_include(&self, argument: &str) -> Option<PathBuf> {
        if argument.contains(['%', '$', '[', ']', '{', '}']) {
            return None;
        }
        let path = if argument == "~" {
            self.home.clone()
        } else if let Some(rest) = argument.strip_prefix("~/") {
            self.home.join(rest)
        } else if argument.starts_with('~') {
            // `~user` names another account's home; do not guess at it.
            return None;
        } else if Path::new(argument).is_absolute() {
            PathBuf::from(argument)
        } else {
            self.home.join(".ssh").join(argument)
        };
        // Wildcards are supported only in the final component, where one
        // bounded directory listing can expand them.
        let parent_has_glob = path
            .parent()
            .is_some_and(|parent| parent.to_string_lossy().contains(['*', '?']));
        (!parent_has_glob).then_some(path)
    }

    fn expand_glob(&mut self, directory: &Path, pattern: &str) -> Option<Vec<PathBuf>> {
        let entries = match std::fs::read_dir(directory) {
            Ok(entries) => entries,
            // OpenSSH treats a glob that matches nothing as nothing to read.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => {
                self.warn(AliasDiscoveryWarning::UnreadableFile);
                return None;
            }
        };
        let mut matches = Vec::new();
        for (examined, entry) in entries.enumerate() {
            if examined == MAX_GLOB_ENTRIES {
                self.warn(AliasDiscoveryWarning::UnsupportedInclude);
                break;
            }
            let Ok(entry) = entry else { continue };
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            if ssh_config::glob_matches(pattern, file_name) {
                matches.push(entry.path());
            }
        }
        // glob(3) returns matches sorted, which fixes first-seen order.
        matches.sort();
        Some(matches)
    }
}
