//! ALL-417 helper observations, not a new capture API.
use super::*;
use std::os::unix::fs::symlink;

#[test]
fn local_link_target_is_literal_but_not_rejected_for_escape() {
    let root = std::env::temp_dir().join(format!("nac-link-probe-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    symlink("../outside\n", root.join("link")).unwrap();
    let root = root.canonicalize().unwrap();
    assert_eq!(
        local_worktree(&root, "link", 1024).unwrap(),
        WorktreeRead::Symlink {
            target: b"../outside\n".to_vec(),
            escapes: false, // means parent directory, not link target containment
        }
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn local_parent_link_escape_is_flagged_after_external_bytes_are_read() {
    let root = std::env::temp_dir().join(format!("nac-parent-probe-{}", uuid::Uuid::new_v4()));
    let repo = root.join("repo");
    let outside = root.join("outside");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("secret"), b"fixture-external").unwrap();
    symlink(&outside, repo.join("parent")).unwrap();
    assert_eq!(
        local_worktree(&repo.canonicalize().unwrap(), "parent/secret", 1024).unwrap(),
        WorktreeRead::Regular {
            size: 16,
            escapes: true,
            bytes: Some(b"fixture-external".to_vec()),
        }
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn local_non_utf8_link_target_is_lossy() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let root = std::env::temp_dir().join(format!("nac-link-bytes-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    symlink(OsStr::from_bytes(b"missing-\xff"), root.join("link")).unwrap();
    assert_eq!(
        local_worktree(&root.canonicalize().unwrap(), "link", 1024).unwrap(),
        WorktreeRead::Symlink {
            target: "missing-\u{fffd}".as_bytes().to_vec(),
            escapes: false,
        }
    );
    std::fs::remove_dir_all(root).unwrap();
}
