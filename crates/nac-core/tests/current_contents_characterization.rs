//! ALL-417: characterize run history; these assertions do not qualify launch capture.
#![cfg(unix)]

use nac_core::workspace::{capture, GitTarget};
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

struct Repo(PathBuf);
impl Repo {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-all417-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let repo = Self(root);
        repo.git(&["init", "-q"]);
        repo.git(&["config", "user.name", "fixture"]);
        repo.git(&["config", "user.email", "fixture@invalid"]);
        repo.git(&["config", "core.attributesFile", "/dev/null"]);
        repo.git(&["config", "core.excludesFile", "/dev/null"]);
        repo.git(&["config", "core.autocrlf", "false"]);
        repo.git(&["config", "core.filemode", "true"]);
        repo.put("tracked", b"base\n");
        repo.git(&["add", "."]);
        repo.git(&["commit", "-qm", "base"]);
        repo
    }
    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = Command::new("git")
            .current_dir(&self.0)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "{args:?}: {:?}", output);
        output.stdout
    }
    fn put(&self, name: &str, bytes: &[u8]) {
        fs::write(self.0.join(name), bytes).unwrap();
    }
    fn target(&self) -> GitTarget {
        GitTarget::local(&self.0)
    }
    fn source(&self) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        (
            self.git(&["rev-parse", "HEAD"]),
            fs::read(self.0.join(".git/index")).unwrap(),
            fs::read(self.0.join("tracked")).unwrap(),
        )
    }
    fn blob(&self, commit: &str, path: &str) -> Vec<u8> {
        self.git(&["cat-file", "blob", &format!("{commit}:{path}")])
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn history_preserves_source_and_ordinary_bytes_modes_links_from_nested_cwd() {
    let repo = Repo::new();
    repo.put("tracked", b"staged\n");
    repo.git(&["add", "tracked"]);
    repo.put("tracked", b"on disk\0\xff\n");
    repo.put("binary", b"\0\xff\x80\r\n");
    repo.put("exec", b"#!/bin/sh\n");
    fs::set_permissions(repo.0.join("exec"), fs::Permissions::from_mode(0o755)).unwrap();
    symlink("missing\n", repo.0.join("link")).unwrap();
    fs::create_dir(repo.0.join("nested")).unwrap();
    let before = repo.source();
    let revision = capture(&GitTarget::local(repo.0.join("nested")), "ordinary", None).unwrap();
    assert_eq!(repo.source(), before);
    assert_eq!(repo.blob(&revision.commit, "tracked"), b"on disk\0\xff\n");
    assert_eq!(repo.blob(&revision.commit, "binary"), b"\0\xff\x80\r\n");
    assert_eq!(repo.blob(&revision.commit, "link"), b"missing\n");
    let tree = String::from_utf8(repo.git(&["ls-tree", &revision.commit])).unwrap();
    assert!(tree.contains("100755 blob"));
    assert!(tree.contains("120000 blob"));
}

#[test]
fn fresh_history_index_silently_omits_tracked_files_matching_ignore() {
    let repo = Repo::new();
    repo.put(".gitignore", b"tracked\nignored/\n");
    fs::create_dir(repo.0.join("ignored")).unwrap();
    fs::write(repo.0.join("ignored/secret"), b"excluded").unwrap();
    let before = repo.source();
    let revision = capture(&repo.target(), "ignored-tracked", None).unwrap();
    let tree = String::from_utf8(repo.git(&["ls-tree", "-r", &revision.commit])).unwrap();
    assert!(
        !tree.contains("\ttracked\n"),
        "known launch fidelity failure"
    );
    assert!(!tree.contains("secret"));
    assert_eq!(repo.source(), before);
}

#[test]
fn history_normalizes_crlf_instead_of_capturing_disk_bytes() {
    let repo = Repo::new();
    repo.put(".gitattributes", b"*.txt text eol=lf\n");
    repo.put("line.txt", b"line\r\n");
    let revision = capture(&repo.target(), "crlf", None).unwrap();
    assert_eq!(repo.blob(&revision.commit, "line.txt"), b"line\n");
    assert_eq!(fs::read(repo.0.join("line.txt")).unwrap(), b"line\r\n");
}

#[test]
fn history_accepts_escaping_links_and_silently_drops_fifo() {
    let repo = Repo::new();
    symlink("/outside-secret", repo.0.join("absolute")).unwrap();
    symlink("../outside", repo.0.join("escape")).unwrap();
    let fifo = repo.0.join("pipe");
    assert!(Command::new("mkfifo")
        .arg(&fifo)
        .status()
        .unwrap()
        .success());
    let revision = capture(&repo.target(), "unsupported", None).unwrap();
    assert_eq!(repo.blob(&revision.commit, "absolute"), b"/outside-secret");
    assert_eq!(repo.blob(&revision.commit, "escape"), b"../outside");
    let tree = String::from_utf8(repo.git(&["ls-tree", &revision.commit])).unwrap();
    assert!(!tree.contains("\tpipe\n"));
}

#[test]
fn history_recaptures_same_identity_and_pins_chain_only_in_source() {
    let repo = Repo::new();
    let first = capture(&repo.target(), "retry", None).unwrap();
    repo.put("tracked", b"newer\n");
    let second = capture(&repo.target(), "retry", Some(&first.commit)).unwrap();
    assert_ne!(first.commit, second.commit);
    assert_eq!(repo.blob(&first.commit, "tracked"), b"base\n");
    repo.git(&["gc", "--prune=now"]);
    assert_eq!(repo.blob(&first.commit, "tracked"), b"base\n");
    assert_eq!(
        String::from_utf8(repo.git(&["rev-parse", "refs/nac/revisions/retry"]))
            .unwrap()
            .trim(),
        second.commit
    );
    assert!(Path::new(&repo.0)
        .join(".git/nac-revisions/index-retry")
        .exists());
}

#[test]
fn raw_history_preserves_non_utf8_link_targets_and_resulting_rename_deletion_paths() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let repo = Repo::new();
    fs::create_dir(repo.0.join("removed")).unwrap();
    fs::write(repo.0.join("removed/file"), b"deleted").unwrap();
    repo.put("old", b"renamed bytes\0\xff");
    repo.git(&["add", "--all"]);
    repo.git(&["commit", "-qm", "before deletes"]);
    fs::remove_dir_all(repo.0.join("removed")).unwrap();
    fs::rename(repo.0.join("old"), repo.0.join("renamed")).unwrap();
    symlink(OsStr::from_bytes(b"missing-\xff"), repo.0.join("link")).unwrap();
    let before = repo.source();
    let revision = capture(&repo.target(), "raw-link-and-paths", None).unwrap();
    assert_eq!(repo.blob(&revision.commit, "link"), b"missing-\xff");
    assert_eq!(
        repo.blob(&revision.commit, "renamed"),
        b"renamed bytes\0\xff"
    );
    let paths =
        String::from_utf8(repo.git(&["ls-tree", "-r", "--name-only", &revision.commit])).unwrap();
    assert!(!paths
        .lines()
        .any(|path| path == "old" || path == "removed/file"));
    assert_eq!(repo.source(), before);
}
