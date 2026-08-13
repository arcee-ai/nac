//! Golden tests: the recorded models.dev fixture must regenerate the
//! checked-in nac-core baseline byte-for-byte. Schema drift or mapping
//! changes fail loudly here at regen time — after a deliberate live regen,
//! re-record `fixtures/models-dev-api.json` from the same payload (the
//! binary's `--save-raw` option) and review the catalog diff together.

use nac_catalog_gen as gen;
use std::path::PathBuf;

const FIXTURE: &str = include_str!("../fixtures/models-dev-api.json");
const OVERRIDES: &str = include_str!("../overrides.toml");

fn checked_in_catalog() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../nac-core/src/model/catalog/data/catalog.json");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()))
}

#[test]
fn recorded_fixture_regenerates_the_checked_in_catalog() {
    let generation = gen::generate(FIXTURE, OVERRIDES).expect("fixture generates");
    assert_eq!(
        generation.catalog_json,
        checked_in_catalog(),
        "fixture regeneration differs from the checked-in catalog — regen \
         deliberately, review the diff, and re-record the fixture"
    );
}

#[test]
fn manifest_check_rejects_malformed_or_invalid_utc_timestamps() {
    let generation = gen::generate(FIXTURE, OVERRIDES).unwrap();
    let expected = gen::manifest(
        &generation.catalog,
        &generation.catalog_json,
        "fixture",
        None,
    );
    for generated_at in [
        "xxxx-xx-xxTxx:xx:xxZ",
        "2026-00-01T00:00:00Z",
        "2026-02-29T00:00:00Z",
        "2024-02-30T00:00:00Z",
        "2026-01-01T24:00:00Z",
        "2026-01-01T00:60:00Z",
        "2026-01-01T00:00:60Z",
    ] {
        let mut checked = expected.clone();
        checked.generated_at = generated_at.to_string();
        let json = gen::manifest_json(&checked).unwrap();
        assert!(
            gen::check_manifest(&json, &expected).is_err(),
            "accepted {generated_at}"
        );
    }

    let mut leap_day = expected.clone();
    leap_day.generated_at = "2024-02-29T23:59:59Z".to_string();
    gen::check_manifest(&gen::manifest_json(&leap_day).unwrap(), &expected).unwrap();
}

#[test]
fn manifest_check_validates_catalog_and_provenance() {
    let generation = gen::generate(FIXTURE, OVERRIDES).unwrap();
    let expected = gen::manifest(
        &generation.catalog,
        &generation.catalog_json,
        "fixture",
        Some("etag".into()),
    );
    let checked = gen::manifest_json(&expected).unwrap();
    gen::check_manifest(&checked, &expected).unwrap();
    let mut stale: serde_json::Value = serde_json::from_str(&checked).unwrap();
    stale["sha256"] = "stale".into();
    assert!(gen::check_manifest(&serde_json::to_string(&stale).unwrap(), &expected).is_err());
}
