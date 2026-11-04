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
