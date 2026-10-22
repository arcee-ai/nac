use super::*;
use std::time::{Duration, Instant};

#[test]
fn retained_catalog_excludes_the_actual_cache_publisher_before_directory_creation() {
    let home = test_support::TempHome::new("retained-source-writer");
    let path = home.path().canonicalize().unwrap();
    let owner =
        CreateModelCatalogSource::capture(&path, Instant::now() + Duration::from_secs(30)).unwrap();
    let output = path.join("model-catalog/overlay.json");
    assert!(overlay::atomic_replace(&output, "{}").is_err());
    assert!(!output.parent().unwrap().exists());
    owner.check_current().unwrap();
    drop(owner);
    overlay::atomic_replace(&output, "{}").unwrap();
}

fn captured(home: &Path) -> CreateModelCatalogSource {
    CreateModelCatalogSource::capture(home, Instant::now() + Duration::from_secs(30)).unwrap()
}
fn overrides(tokens: u64) -> String {
    serde_json::json!({"overrides":[{"provider":"deepseek-chat","model":"retained-model","set":{"max_tokens":tokens}}]}).to_string()
}

#[test]
fn retained_catalog_parses_same_captured_layers_with_existing_tolerant_semantics() {
    let temp = test_support::TempHome::new("retained-source-parity");
    let home = temp.path().canonicalize().unwrap();
    std::fs::create_dir(home.join("model-catalog")).unwrap();
    for layer in [
        "overlay.json",
        "arcee-overlay.json",
        "anthropic-overlay.json",
    ] {
        std::fs::write(
            home.join("model-catalog").join(layer),
            "PRIVATE_CORRUPT_LAYER",
        )
        .unwrap();
    }
    std::fs::write(home.join("models.json"), overrides(1234)).unwrap();
    let (ordinary, warnings) = ModelCatalog::load_from_home(Some(&home));
    assert_eq!(warnings.len(), 3);
    let source = captured(&home);
    let actual = source
        .catalog()
        .unwrap()
        .resolve(BackendKind::DeepSeekChat, "retained-model");
    assert_eq!(actual.max_tokens, 1234);
    assert_eq!(
        actual,
        ordinary.resolve(BackendKind::DeepSeekChat, "retained-model")
    );
    std::fs::write(home.join("models.json"), overrides(5678)).unwrap();
    // Bounded DATA access keeps the SAME snapshot; physical checks veto it.
    assert_eq!(
        source
            .catalog()
            .unwrap()
            .resolve(BackendKind::DeepSeekChat, "retained-model")
            .max_tokens,
        1234
    );
    assert!(source.check_current().is_err());
    assert!(source.catalog().is_err());
}

#[test]
fn retained_catalog_fences_every_actual_cache_output_and_sidecar_after_denial() {
    let temp = test_support::TempHome::new("retained-all-publications");
    let home = temp.path().canonicalize().unwrap();
    let source = captured(&home);
    source.deny();
    for layer in [
        "overlay.json",
        "overlay.etag",
        "arcee-overlay.json",
        "arcee-overlay.sidecar",
        "anthropic-overlay.json",
        "anthropic-overlay.sidecar",
    ] {
        let output = home.join("model-catalog").join(layer);
        assert!(overlay::atomic_replace(&output, "PRIVATE_NEW_OUTPUT").is_err());
        assert!(!output.exists());
    }
    assert!(!home.join("model-catalog").exists());
    drop(source);
    overlay::atomic_replace(&home.join("model-catalog/overlay.json"), "{}").unwrap();
}

#[test]
fn retained_catalog_same_bytes_replacement_is_sticky_and_absence_is_bound() {
    let temp = test_support::TempHome::new("retained-catalog-identity");
    let home = temp.path().canonicalize().unwrap();
    let path = home.join("models.json");
    let original = home.join("original.json");
    std::fs::write(&path, overrides(1234)).unwrap();
    let source = captured(&home);
    std::fs::rename(&path, &original).unwrap();
    std::fs::write(&path, overrides(1234)).unwrap();
    assert!(source.check_current().is_err());
    std::fs::remove_file(&path).unwrap();
    std::fs::rename(&original, &path).unwrap();
    assert!(source.check_current().is_err());
    drop(source);
    let source = captured(&home);
    std::fs::create_dir(home.join("model-catalog")).unwrap();
    assert!(source.check_current().is_err());
}

#[test]
fn retained_catalog_refuses_symlinks_hardlinks_and_changed_ancestors() {
    use std::os::unix::fs::symlink;
    let temp = test_support::TempHome::new("retained-catalog-paths");
    let home = temp.path().canonicalize().unwrap();
    let raw = home.join("private-original.json");
    std::fs::write(&raw, "PRIVATE_SOURCE_CONTENT").unwrap();
    let path = home.join("models.json");
    symlink(&raw, &path).unwrap();
    assert!(
        CreateModelCatalogSource::capture(&home, Instant::now() + Duration::from_secs(30)).is_err()
    );
    std::fs::remove_file(&path).unwrap();
    std::fs::hard_link(&raw, &path).unwrap();
    let error = CreateModelCatalogSource::capture(&home, Instant::now() + Duration::from_secs(30))
        .err()
        .unwrap();
    assert!(!format!("{error:?} {error}").contains("PRIVATE_SOURCE_CONTENT"));
    std::fs::remove_file(&path).unwrap();
    let source = captured(&home);
    let renamed = home.with_file_name(format!("catalog-renamed-{}", uuid::Uuid::new_v4()));
    std::fs::rename(&home, &renamed).unwrap();
    assert!(source.check_current().is_err());
    std::fs::rename(&renamed, &home).unwrap();
    assert!(source.check_current().is_err());
}

#[test]
fn retained_catalog_shares_custody_and_expiry_does_not_release_other_owners() {
    let temp = test_support::TempHome::new("retained-catalog-concurrent");
    let home = temp.path().canonicalize().unwrap();
    let first = captured(&home);
    let second = captured(&home);
    first.deny();
    assert!(first.catalog().is_err());
    second.check_current().unwrap();
    drop(first);
    let output = home.join("model-catalog/overlay.json");
    assert!(overlay::atomic_replace(&output, "{}").is_err());
    assert!(CreateModelCatalogSource::capture(&home, Instant::now()).is_err());
    drop(second);
    overlay::atomic_replace(&output, "{}").unwrap();
}

#[test]
fn retained_catalog_missing_home_and_unsafe_catalog_directory_make_no_writes() {
    use std::os::unix::fs::symlink;
    let temp = test_support::TempHome::new("retained-catalog-missing");
    let home = temp.path().canonicalize().unwrap();
    let missing = home.join("missing");
    assert!(
        CreateModelCatalogSource::capture(&missing, Instant::now() + Duration::from_secs(30))
            .is_err()
    );
    assert!(!missing.exists());
    assert!(CreateModelCatalogSource::capture(
        Path::new("relative"),
        Instant::now() + Duration::from_secs(30)
    )
    .is_err());
    let other = home.join("other");
    std::fs::create_dir(&other).unwrap();
    symlink(&other, home.join("model-catalog")).unwrap();
    assert!(
        CreateModelCatalogSource::capture(&home, Instant::now() + Duration::from_secs(30)).is_err()
    );
}

#[test]
fn retained_catalog_original_expiry_denies_without_releasing_publication_fence() {
    let temp = test_support::TempHome::new("retained-catalog-expiry");
    let home = temp.path().canonicalize().unwrap();
    let cutoff = Instant::now() + Duration::from_secs(1);
    let source = CreateModelCatalogSource::capture(&home, cutoff).unwrap();
    assert_eq!(source.original_cutoff(), cutoff);
    std::thread::sleep(cutoff.saturating_duration_since(Instant::now()));
    assert!(source.catalog().is_err());
    assert!(source.check_current().is_err());
    assert!(overlay::atomic_replace(&home.join("model-catalog/overlay.json"), "{}").is_err());
    assert!(!home.join("model-catalog").exists());
}
