//! The remote command is exercised against a local POSIX shell, standing in for
//! the host's login shell: `ssh host '<command>'` hands the host exactly the
//! string built here, which its shell then runs with `-c`. No sshd is involved.

use std::path::{Path, PathBuf};

use super::*;

fn scratch(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nac_ssh_new_folder_{label}_{unique}"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::canonicalize(&root).unwrap()
}

fn folder(parent: &Path, name: &str) -> AuthorizedRemoteFolder {
    AuthorizedRemoteFolder::issue(
        &parent.display().to_string(),
        name,
        Vec::new(),
        Path::new("/nonexistent/store.db"),
    )
    .unwrap()
}

/// Runs the command line as the host's login shell would and parses its reply.
fn run_as_host(folder: &AuthorizedRemoteFolder) -> Result<String, NewFolderError> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(remote_new_folder_command(folder))
        .output()
        .expect("run sh");
    assert!(output.status.success(), "{output:?}");
    parse_reply(&output.stdout, folder)
}

fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn the_command_quotes_every_word_and_never_creates_parents() {
    let command = remote_new_folder_command(&folder(Path::new("/srv/it's here"), "a b; rm -rf ~"));
    assert!(command.starts_with("'sh' '-c' '"), "{command}");
    assert!(
        command.ends_with("'nac-new-folder' '/srv/it'\\''s here' 'a b; rm -rf ~'"),
        "{command}"
    );
    assert!(REMOTE_NEW_FOLDER_SCRIPT.contains("mkdir -- \"$name\""));
    assert!(!REMOTE_NEW_FOLDER_SCRIPT.contains("mkdir -p"));
}

#[test]
fn hostile_and_unicode_names_create_exactly_that_one_folder() {
    let root = scratch("names");
    let names = [
        "my project",
        "café ü 项目",
        "-rf",
        "$(touch pwned)",
        "`touch pwned`",
        "it's \"quoted\"",
        "semi; touch pwned",
        "*",
    ];
    for name in names {
        let before = entries(&root);
        let created = run_as_host(&folder(&root, name)).unwrap();
        assert_eq!(created, root.join(name).display().to_string());
        assert!(std::fs::symlink_metadata(root.join(name)).unwrap().is_dir());
        let mut expected = before;
        expected.push(name.to_string());
        expected.sort();
        assert_eq!(entries(&root), expected, "only {name:?} is new");
    }
    assert!(!root.join("pwned").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn an_existing_name_and_a_changed_parent_are_reported_without_writing() {
    let root = scratch("refusals");
    std::fs::create_dir(root.join("taken")).unwrap();
    std::fs::write(root.join("file"), "").unwrap();
    std::os::unix::fs::symlink(root.join("nowhere"), root.join("dangling")).unwrap();
    for name in ["taken", "file", "dangling"] {
        assert!(
            matches!(
                run_as_host(&folder(&root, name)),
                Err(NewFolderError::AlreadyExists(_))
            ),
            "{name}"
        );
    }
    assert!(!root.join("nowhere").exists());

    // The listed parent is now a symlink to somewhere else.
    let outside = root.join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("listed")).unwrap();
    assert!(matches!(
        run_as_host(&folder(&root.join("listed"), "child")),
        Err(NewFolderError::ParentChanged(_))
    ));
    assert!(entries(&outside).is_empty());

    assert!(matches!(
        run_as_host(&folder(&root.join("missing"), "child")),
        Err(NewFolderError::ParentNotFound(_))
    ));
    assert!(matches!(
        run_as_host(&folder(&root.join("file"), "child")),
        Err(NewFolderError::ParentNotADirectory(_))
    ));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn replies_map_to_definite_or_uncertain_outcomes() {
    let target = folder(Path::new("/srv"), "new");
    assert_eq!(parse_reply(b"created\n", &target).unwrap(), "/srv/new");
    assert!(matches!(
        parse_reply(b"failed\tmkdir: Permission denied\n", &target),
        Err(NewFolderError::Refused { reason, .. }) if reason == "mkdir: Permission denied"
    ));
    assert!(matches!(
        parse_reply(b"denied\n", &target),
        Err(NewFolderError::Refused { .. })
    ));
    assert!(matches!(
        parse_reply(b"moved\n", &target),
        Err(NewFolderError::ParentChanged(_))
    ));
    // Silence or garbage is not a success: the caller must look before retrying.
    assert!(matches!(
        parse_reply(b"", &target),
        Err(NewFolderError::Failed(_))
    ));
    assert!(matches!(
        parse_reply(b"unverified\n", &target),
        Err(NewFolderError::Failed(_))
    ));
}
