use super::*;
use std::os::unix::fs::symlink;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("nac-reveal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn existing_spaces_unicode_and_directories_resolve_without_creation_or_fallback() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("日本語 space")).unwrap();
    std::fs::write(fixture.0.join("日本語 space/🦀.txt"), "fixture").unwrap();
    for relative in ["日本語 space", "日本語 space/🦀.txt"] {
        let target = LocalRevealTarget::resolve(&fixture.0, relative).unwrap();
        assert_eq!(target.path, fixture.0.join(relative));
        target.revalidate().unwrap();
    }
    for relative in [
        "",
        ".",
        "../outside",
        "/tmp/absolute",
        "file:///tmp/a",
        "missing/child",
        "bad\0path",
    ] {
        assert!(
            LocalRevealTarget::resolve(&fixture.0, relative).is_err(),
            "{relative}"
        );
    }
    assert!(!fixture.0.join("missing").exists());
}

#[test]
fn all_symlinks_are_rejected_even_when_their_target_is_inside() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("real")).unwrap();
    std::fs::write(fixture.0.join("real/file"), "fixture").unwrap();
    symlink("real/file", fixture.0.join("file-link")).unwrap();
    symlink("real", fixture.0.join("directory-link")).unwrap();
    symlink("/tmp", fixture.0.join("outside-link")).unwrap();
    for relative in [
        "file-link",
        "directory-link",
        "directory-link/file",
        "outside-link/a",
    ] {
        assert!(
            LocalRevealTarget::resolve(&fixture.0, relative).is_err(),
            "{relative}"
        );
    }
    assert!(LocalRevealTarget::resolve(&fixture.0.join("directory-link"), "file").is_err());
}

#[test]
fn moved_replaced_or_symlinked_ancestors_invalidate_a_resolved_target() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("folder")).unwrap();
    std::fs::write(fixture.0.join("folder/file"), "fixture").unwrap();
    let target = LocalRevealTarget::resolve(&fixture.0, "folder/file").unwrap();
    std::fs::rename(fixture.0.join("folder"), fixture.0.join("moved")).unwrap();
    assert!(target.revalidate().is_err());
    symlink("moved", fixture.0.join("folder")).unwrap();
    assert!(target.revalidate().is_err());
    std::fs::remove_file(fixture.0.join("folder")).unwrap();
    std::fs::create_dir(fixture.0.join("folder")).unwrap();
    std::fs::write(fixture.0.join("folder/file"), "replacement").unwrap();
    assert!(target.revalidate().is_err());
}
