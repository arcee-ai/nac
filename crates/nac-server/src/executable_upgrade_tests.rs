use super::*;
use serde_json::{json, Value};

struct Fixture {
    root: PathBuf,
    executable: PathBuf,
    marker: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-upgrade-{}", uuid::Uuid::new_v4()));
        let resources = root.join("NAC with spaces.app/Contents/Resources");
        std::fs::create_dir_all(&resources).unwrap();
        let executable = resources.join("nac-web");
        std::fs::write(&executable, b"executable fixture").unwrap();
        Self {
            root,
            executable,
            marker: resources.join("PackageIdentity.json"),
        }
    }

    fn write_marker(&self, value: &Value) {
        std::fs::write(&self.marker, serde_json::to_vec(value).unwrap()).unwrap();
    }

    fn assert_rejected_identity(&self, build: BuildIdentity) {
        let error = ownership_for_executable(&self.executable, build).unwrap_err();
        assert!(
            error
                .to_string()
                .contains(WHOLE_APPLICATION_UPGRADE_GUIDANCE),
            "{error:#}"
        );
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn marker(build: BuildIdentity) -> Value {
    json!({
        "schema_version": 1,
        "purpose": "normal-app-preparation",
        "consumer_distribution": false,
        "engine_identity": {
            "product_version": build.product_version,
            "build_id": build.build_id,
            "source_revision": build.source_revision,
            "track": build.track,
        },
        // This is intentionally unrelated to current executable bytes. Signing
        // changes bytes, and the restriction is not a signature verifier.
        "engine_input": {"sha256": "pre-signing-input-fixture"},
        "asset_and_native_receipt_fixture": "x".repeat(19 * 1024),
    })
}

#[test]
fn every_bundled_track_and_package_purpose_requires_whole_app_replacement() {
    let fixture = Fixture::new();
    for track in ["dev", "beta", "stable"] {
        let build = BuildIdentity {
            track,
            ..build_identity::current()
        };
        for purpose in ["normal-app-preparation", "development-preview-fixture"] {
            for consumer in [false, true] {
                let mut value = marker(build);
                value["purpose"] = purpose.into();
                value["consumer_distribution"] = consumer.into();
                fixture.write_marker(&value);
                assert_eq!(
                    ownership_for_executable(&fixture.executable, build).unwrap(),
                    UpgradeOwnership::WholeApplication,
                    "track={track}, purpose={purpose}, consumer={consumer}"
                );
            }
        }
    }
}

#[test]
fn absent_malformed_future_and_mismatched_package_identity_fail_closed() {
    let fixture = Fixture::new();
    let build = build_identity::current();
    fixture.assert_rejected_identity(build);
    for bytes in [b"not JSON".as_slice(), b"{}", b"\xff"] {
        std::fs::write(&fixture.marker, bytes).unwrap();
        fixture.assert_rejected_identity(build);
    }
    let mut value = marker(build);
    value["schema_version"] = 2.into();
    fixture.write_marker(&value);
    fixture.assert_rejected_identity(build);
    for field in ["product_version", "source_revision", "track", "build_id"] {
        let mut value = marker(build);
        value["engine_identity"][field] = "stale-or-different".into();
        fixture.write_marker(&value);
        fixture.assert_rejected_identity(build);
    }
}

#[test]
fn package_read_bound_accepts_large_receipts_and_rejects_growth_past_limit() {
    let fixture = Fixture::new();
    let build = build_identity::current();
    let mut bytes = serde_json::to_vec(&marker(build)).unwrap();
    bytes.resize(PACKAGE_IDENTITY_LIMIT as usize, b' ');
    std::fs::write(&fixture.marker, &bytes).unwrap();
    assert_eq!(
        ownership_for_executable(&fixture.executable, build).unwrap(),
        UpgradeOwnership::WholeApplication
    );
    bytes.push(b' ');
    std::fs::write(&fixture.marker, &bytes).unwrap();
    fixture.assert_rejected_identity(build);
}

#[cfg(unix)]
#[test]
fn marker_symlinks_directories_and_fifos_are_never_read_as_package_identity() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let build = build_identity::current();
    let target = fixture.root.join("outside-marker");
    std::fs::write(&target, serde_json::to_vec(&marker(build)).unwrap()).unwrap();
    symlink(&target, &fixture.marker).unwrap();
    fixture.assert_rejected_identity(build);
    std::fs::remove_file(&target).unwrap();
    fixture.assert_rejected_identity(build);
    std::fs::remove_file(&fixture.marker).unwrap();
    std::fs::create_dir(&fixture.marker).unwrap();
    fixture.assert_rejected_identity(build);
    std::fs::remove_dir(&fixture.marker).unwrap();
    let path = std::ffi::CString::new(fixture.marker.as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: path is a valid NUL-terminated name in the owned fixture directory.
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    fixture.assert_rejected_identity(build);
}

#[test]
fn independent_executables_and_unrelated_marker_copies_remain_standalone() {
    let fixture = Fixture::new();
    let build = build_identity::current();
    fixture.write_marker(&marker(build));
    for relative in [
        "independent/nac-web",
        "not-an-app/Contents/Resources/nac-web",
        "tools/Contents/Resources/nac-web",
        "NAC with spaces.app/Contents/MacOS/nac-web",
    ] {
        let executable = fixture.root.join(relative);
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, b"independent copy").unwrap();
        std::fs::write(
            executable.parent().unwrap().join("PackageIdentity.json"),
            b"{}",
        )
        .unwrap();
        assert_eq!(
            ownership_for_executable(&executable, build).unwrap(),
            UpgradeOwnership::Standalone,
            "{}",
            executable.display()
        );
    }
}

#[cfg(unix)]
#[test]
fn invocation_symlinks_classify_the_canonical_target_in_both_directions() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let build = build_identity::current();
    fixture.write_marker(&marker(build));
    let alias = fixture.root.join("renamed-command");
    symlink(&fixture.executable, &alias).unwrap();
    assert_eq!(
        ownership_for_executable(&alias, build).unwrap(),
        UpgradeOwnership::WholeApplication
    );
    std::fs::remove_file(&fixture.executable).unwrap();
    let independent = fixture.root.join("independent-engine");
    std::fs::write(&independent, b"independent executable").unwrap();
    symlink(&independent, &fixture.executable).unwrap();
    assert_eq!(
        ownership_for_executable(&fixture.executable, build).unwrap(),
        UpgradeOwnership::Standalone
    );
}

#[test]
fn unresolvable_executable_never_defaults_to_standalone_upgrade() {
    let fixture = Fixture::new();
    std::fs::remove_file(&fixture.executable).unwrap();
    assert!(ownership_for_executable(&fixture.executable, build_identity::current()).is_err());
}
