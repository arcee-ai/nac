use super::*;
use crate::permissions::PermissionEffect;

/// A fresh canonical directory, so listed and canonical spellings agree the way
/// they do for a real picker listing.
fn scratch(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nac_new_folder_{label}_{unique}"));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::canonicalize(&root).unwrap()
}

fn entries(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn store(root: &Path) -> PathBuf {
    root.join("store.db")
}

fn create(parent: &Path, name: &str) -> Result<PathBuf, NewFolderError> {
    AuthorizedLocalFolder::issue(
        &parent.display().to_string(),
        name,
        Vec::new(),
        Path::new("/nonexistent/store.db"),
    )?
    .create()
}

#[test]
fn exactly_one_named_folder_is_created_under_the_listed_parent() {
    let root = scratch("one");
    let parent = root.join("projects");
    std::fs::create_dir(&parent).unwrap();
    std::fs::create_dir(parent.join("existing")).unwrap();

    for name in [
        "my project",
        "café ü 项目",
        "-rf",
        "$(touch pwned)",
        "it's",
        ".config",
    ] {
        let before = entries(&parent);
        let created = create(&parent, name).unwrap();
        assert_eq!(created, parent.join(name));
        assert!(std::fs::symlink_metadata(&created).unwrap().is_dir());
        let mut expected = before.clone();
        expected.push(name.to_string());
        expected.sort();
        assert_eq!(entries(&parent), expected, "only '{name}' is new");
        assert!(entries(&created).is_empty(), "nothing is created inside it");
    }
    assert!(!root.join("pwned").exists() && !parent.join("pwned").exists());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn names_that_are_not_exactly_one_folder_are_refused_before_anything_happens() {
    let root = scratch("names");
    let long = "a".repeat(MAX_FOLDER_NAME_BYTES + 1);
    let invalid = [
        "",
        "   ",
        " leading",
        "trailing ",
        "\ttab",
        ".",
        "..",
        "a/b",
        "../escape",
        "/abs",
        "a\\b",
        "nul\0byte",
        "line\nbreak",
        long.as_str(),
    ];
    for name in invalid {
        let error = create(&root, name).unwrap_err();
        assert!(
            matches!(error, NewFolderError::InvalidName(_)),
            "{name:?} must be rejected as a name, got {error:?}"
        );
    }
    assert!(entries(&root).is_empty());
    let longest = "é".repeat(MAX_FOLDER_NAME_BYTES / 2);
    assert!(create(&root, &longest).is_ok());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn an_existing_name_is_reported_and_never_replaced() {
    let root = scratch("collision");
    std::fs::create_dir(root.join("folder")).unwrap();
    std::fs::write(root.join("folder").join("keep.txt"), "kept").unwrap();
    std::fs::write(root.join("file"), "file").unwrap();
    let elsewhere = root.join("elsewhere");
    std::os::unix::fs::symlink(&elsewhere, root.join("dangling")).unwrap();

    for name in ["folder", "file", "dangling"] {
        let error = create(&root, name).unwrap_err();
        assert!(
            matches!(&error, NewFolderError::AlreadyExists(path) if path.ends_with(name)),
            "{name}: {error:?}"
        );
        assert_eq!(
            error.to_string(),
            format!("'{}' already exists", root.join(name).display())
        );
    }
    assert_eq!(
        std::fs::read_to_string(root.join("folder/keep.txt")).unwrap(),
        "kept"
    );
    assert_eq!(std::fs::read_to_string(root.join("file")).unwrap(), "file");
    assert!(!elsewhere.exists(), "a dangling link is not followed");
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn a_parent_reached_through_a_symlink_is_refused() {
    let root = scratch("symlink_parent");
    let real = root.join("real");
    std::fs::create_dir(&real).unwrap();
    std::os::unix::fs::symlink(&real, root.join("link")).unwrap();

    let error = create(&root.join("link"), "child").unwrap_err();

    assert!(
        matches!(error, NewFolderError::ParentChanged(_)),
        "{error:?}"
    );
    assert!(entries(&real).is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn a_parent_swapped_for_a_symlink_after_authorization_is_not_followed() {
    let root = scratch("swapped_parent");
    let parent = root.join("listed");
    let outside = root.join("outside");
    std::fs::create_dir(&parent).unwrap();
    std::fs::create_dir(&outside).unwrap();
    let issued = AuthorizedLocalFolder::issue(
        &parent.display().to_string(),
        "child",
        Vec::new(),
        &store(&root),
    )
    .unwrap();

    // Between the listing/authorization and the create, the parent moves and a
    // symlink to somewhere else takes its place.
    std::fs::rename(&parent, root.join("moved")).unwrap();
    std::os::unix::fs::symlink(&outside, &parent).unwrap();
    let error = issued.create().unwrap_err();

    assert!(
        matches!(error, NewFolderError::ParentChanged(_)),
        "{error:?}"
    );
    assert!(
        entries(&outside).is_empty(),
        "nothing escapes through the link"
    );
    assert!(entries(&root.join("moved")).is_empty());

    // An ancestor swapped the same way is caught too.
    let deep = root.join("a/b");
    std::fs::create_dir_all(&deep).unwrap();
    let issued = AuthorizedLocalFolder::issue(
        &deep.display().to_string(),
        "child",
        Vec::new(),
        &store(&root),
    )
    .unwrap();
    std::fs::rename(root.join("a"), root.join("a-moved")).unwrap();
    std::fs::create_dir(outside.join("b")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("a")).unwrap();
    assert!(matches!(
        issued.create(),
        Err(NewFolderError::ParentChanged(_))
    ));
    assert!(entries(&outside.join("b")).is_empty());
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn a_parent_that_moved_away_or_never_was_a_folder_is_reported() {
    let root = scratch("moved_parent");
    let parent = root.join("gone");
    std::fs::create_dir(&parent).unwrap();
    let issued = AuthorizedLocalFolder::issue(
        &parent.display().to_string(),
        "child",
        Vec::new(),
        &store(&root),
    )
    .unwrap();
    std::fs::rename(&parent, root.join("renamed")).unwrap();
    assert!(matches!(
        issued.create(),
        Err(NewFolderError::ParentNotFound(_))
    ));
    assert!(entries(&root.join("renamed")).is_empty());

    assert!(matches!(
        create(&parent, "child"),
        Err(NewFolderError::ParentNotFound(_))
    ));
    std::fs::write(root.join("file"), "").unwrap();
    assert!(matches!(
        create(&root.join("file"), "child"),
        Err(NewFolderError::ParentNotADirectory(_))
    ));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn only_an_absolute_listed_parent_is_accepted() {
    let root = scratch("parent_spelling");
    std::fs::create_dir(root.join("x")).unwrap();
    for parent in [
        "relative/path".to_string(),
        "~".to_string(),
        "~/projects".to_string(),
        String::new(),
        format!("{}/x/..", root.display()),
        format!("{}/./x", root.display()),
    ] {
        let error =
            AuthorizedLocalFolder::issue(&parent, "child", Vec::new(), &store(&root)).unwrap_err();
        assert!(
            matches!(error, NewFolderError::InvalidRequest(_)),
            "{parent:?}: {error:?}"
        );
    }
    assert_eq!(entries(&root), vec!["x"]);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn hard_and_configured_deny_refuse_while_ask_needs_no_approval() {
    let root = scratch("policy");
    let deny = vec![PermissionRule::new(
        "edit",
        format!("{}/secret*", root.display()),
        PermissionEffect::Deny,
    )];

    let error = AuthorizedLocalFolder::issue(
        &root.display().to_string(),
        "secret stuff",
        deny.clone(),
        &store(&root),
    )
    .unwrap_err();
    assert!(
        matches!(&error, NewFolderError::Denied { reason, .. } if reason.contains("configured permission rules deny")),
        "{error:?}"
    );

    let error = AuthorizedLocalFolder::issue(
        &root.display().to_string(),
        ".git",
        Vec::new(),
        &store(&root),
    )
    .unwrap_err();
    assert!(
        matches!(&error, NewFolderError::Denied { reason, .. } if reason.contains("Git metadata")),
        "{error:?}"
    );

    // The store itself is hard-denied even under an Allow-everything rule.
    let error = AuthorizedLocalFolder::issue(
        &root.display().to_string(),
        "store.db",
        vec![PermissionRule::new("*", "*", PermissionEffect::Allow)],
        &store(&root),
    )
    .unwrap_err();
    assert!(
        matches!(&error, NewFolderError::Denied { reason, .. } if reason.contains("session store")),
        "{error:?}"
    );
    assert!(entries(&root).is_empty());

    // Ask is answered by the invocation itself: no approval request is made.
    let ask = vec![PermissionRule::new("edit", "*", PermissionEffect::Ask)];
    let created =
        AuthorizedLocalFolder::issue(&root.display().to_string(), "public", ask, &store(&root))
            .unwrap()
            .create()
            .unwrap();
    assert_eq!(created, root.join("public"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn remote_authority_validates_the_same_way_without_touching_this_machine() {
    let store = Path::new("/nonexistent/store.db");
    let folder = AuthorizedRemoteFolder::issue("/srv/work", "new one", Vec::new(), store).unwrap();
    assert_eq!(folder.path(), "/srv/work/new one");
    assert_eq!(
        AuthorizedRemoteFolder::issue("/", "top", Vec::new(), store)
            .unwrap()
            .path(),
        "/top"
    );
    assert_eq!(
        AuthorizedRemoteFolder::issue("/srv/work/", "x", Vec::new(), store)
            .unwrap()
            .path(),
        "/srv/work/x"
    );
    assert!(!Path::new("/srv/work/new one").exists());

    for (parent, name) in [
        ("/srv/work", ".."),
        ("/srv/work", "a/b"),
        ("~", "x"),
        ("srv", "x"),
    ] {
        assert!(AuthorizedRemoteFolder::issue(parent, name, Vec::new(), store).is_err());
    }
    let deny = vec![PermissionRule::new(
        "edit",
        "/srv/*",
        PermissionEffect::Deny,
    )];
    assert!(matches!(
        AuthorizedRemoteFolder::issue("/srv/work", "x", deny, store),
        Err(NewFolderError::Denied { .. })
    ));
    assert!(matches!(
        AuthorizedRemoteFolder::issue("/srv/work", ".git", Vec::new(), store),
        Err(NewFolderError::Denied { .. })
    ));
}
