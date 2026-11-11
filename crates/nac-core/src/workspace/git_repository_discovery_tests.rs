//! Optional Local Git discovery without weakening strict repository callers.
use super::*;
use std::os::unix::process::ExitStatusExt;

fn output(code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
    Output {
        status: std::process::ExitStatus::from_raw(code << 8),
        stdout: stdout.to_vec(),
        stderr: stderr.to_vec(),
    }
}

#[test]
fn only_definite_ordinary_nonrepository_is_absence() {
    let plain = output(
        128,
        b"",
        b"fatal: not a git repository (or any of the parent directories): .git\n",
    );
    assert!(ordinary_nonrepository(&plain));
    let target = GitTarget::local("/unused");
    assert!(target.repo_root_from_output(plain).is_err()); // Strict mode unchanged.
    for (code, message) in [
        (128, "fatal: not a git repository: /broken/gitdir"),
        (128, "fatal: invalid gitfile format: .git"),
        (128, "fatal: detected dubious ownership in repository"),
        (128, "fatal: unable to read .git: Permission denied"),
        (127, "git: command not found"),
        (1, "fatal: not a git repository (different exit status)"),
    ] {
        let value = output(code, b"", message.as_bytes());
        assert!(!ordinary_nonrepository(&value), "{code}: {message}");
        assert!(target.repo_root_from_output(value).is_err());
    }
    for bytes in [b"".as_slice(), b"\xff".as_slice()] {
        let value = output(0, bytes, b"");
        assert!(!ordinary_nonrepository(&value));
        assert!(target.repo_root_from_output(value).is_err());
    }
}

#[test]
fn local_optional_discovery_distinguishes_plain_broken_and_unavailable() {
    let root = std::env::temp_dir().join(format!("nac-optional-git-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let target = GitTarget::local(root.clone());
    assert_eq!(target.local_repo_root_if_present().unwrap(), None);
    assert!(target.repo_root().is_err());
    std::fs::write(root.join(".git"), "gitdir: missing-gitdir\n").unwrap();
    assert!(target.local_repo_root_if_present().is_err());
    std::fs::remove_file(root.join(".git")).unwrap();
    std::fs::remove_dir(&root).unwrap();
    assert!(target.local_repo_root_if_present().is_err()); // Missing cwd/spawn failure.
}

struct RepositoryFixture(PathBuf);

impl Drop for RepositoryFixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

fn assert_literal_git_root(suffix: &str) {
    use std::os::unix::{ffi::OsStrExt, fs::MetadataExt};

    let fixture = RepositoryFixture(
        std::env::temp_dir().join(format!("nac-git-root-record-{}", uuid::Uuid::new_v4())),
    );
    let sibling = fixture.0.join("repo 日本語");
    let repo = fixture.0.join(format!("repo 日本語{suffix}"));
    std::fs::create_dir_all(&sibling).unwrap();
    std::fs::create_dir_all(repo.join("nested/cwd")).unwrap();
    assert!(StdCommand::new("git")
        .args(["init", "--quiet"])
        .arg(&repo)
        .status()
        .unwrap()
        .success());
    let repo = repo.canonicalize().unwrap();
    let sibling = sibling.canonicalize().unwrap();
    assert_ne!(
        std::fs::metadata(&repo).unwrap().ino(),
        std::fs::metadata(&sibling).unwrap().ino()
    );
    for cwd in [repo.clone(), repo.join("nested/cwd")] {
        let target = GitTarget::local(cwd);
        let raw = target
            .output(target.root(), &["rev-parse", "--show-toplevel"])
            .unwrap();
        assert!(raw.status.success());
        assert_eq!(raw.stdout, [repo.as_os_str().as_bytes(), b"\n"].concat());
        let strict = target.repo_root().unwrap();
        let optional = target.local_repo_root_if_present().unwrap().unwrap();
        assert_eq!(strict, repo, "strict root must preserve {suffix:?}");
        assert_eq!(optional, repo, "optional root must preserve {suffix:?}");
        assert_eq!(
            std::fs::metadata(strict).unwrap().ino(),
            std::fs::metadata(&repo).unwrap().ino()
        );
    }
}

#[test]
fn actual_git_root_preserves_trailing_space_with_existing_sibling() {
    assert_literal_git_root(" ");
}

#[test]
fn actual_git_root_preserves_trailing_tab_with_existing_sibling() {
    assert_literal_git_root("\t");
}

#[test]
fn actual_git_root_preserves_unix_newline_and_carriage_return_bytes() {
    for suffix in ["\n", "\r", "\r\n", "\nembedded\n", "\u{2003}"] {
        assert_literal_git_root(suffix);
    }
}

fn synthetic_ssh_target() -> GitTarget {
    // Parsing alone must not canonicalize a remote path or contact this host.
    GitTarget::ssh(
        SshConnection::new("git-record.invalid"),
        PathBuf::from("/remote/cwd"),
        Path::new("/unused-local"),
    )
}

#[test]
fn ssh_git_root_removes_only_one_record_lf() {
    let target = synthetic_ssh_target();
    for path in [
        "/remote/repo",
        "/remote/repo ",
        "/remote/repo\t",
        "/remote/repo\r",
        "/remote/repo\n",
        "/remote/repo\r\n",
        "/remote/embedded\nrepo\n",
    ] {
        let record = format!("{path}\n");
        assert_eq!(
            target
                .repo_root_from_output(output(0, record.as_bytes(), b""))
                .unwrap(),
            PathBuf::from(path),
            "literal remote root {path:?}"
        );
    }
    assert_eq!(
        target
            .repo_root_from_output(output(0, b"/remote/no-terminator ", b""))
            .unwrap(),
        PathBuf::from("/remote/no-terminator ")
    );
}

#[test]
fn git_root_record_keeps_utf8_empty_and_ssh_failure_contracts() {
    let target = synthetic_ssh_target();
    for bytes in [b"".as_slice(), b"\n".as_slice()] {
        assert!(target
            .repo_root_from_output(output(0, bytes, b""))
            .unwrap_err()
            .to_string()
            .contains("git repository not found"));
    }
    assert!(target
        .repo_root_from_output(output(0, b"/remote/\xff\n", b""))
        .unwrap_err()
        .to_string()
        .contains("git repository path is not valid UTF-8"));
    for (code, stderr, diagnostic) in [
        (255, "connection refused", "cannot reach ssh host"),
        (
            127,
            "git: command not found",
            "git is not installed on ssh host",
        ),
        (128, "fatal: corrupt gitdir", "is not a git repository"),
    ] {
        assert!(target
            .repo_root_from_output(output(code, b"/remote/repo\n", stderr.as_bytes()))
            .unwrap_err()
            .to_string()
            .contains(diagnostic));
    }
    assert!(target
        .local_repo_root_if_present()
        .unwrap_err()
        .to_string()
        .contains("requires a Local target"));
}
