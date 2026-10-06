use super::*;
use serde_json::{json, Value};
use std::fs;
use std::sync::{Arc, Barrier};

const KEY: &str = "synthetic-host-key-canary";

struct Fixture {
    root: PathBuf,
    input: PathBuf,
    store: ManagedHostKeyStore,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-static-key-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("bootstrap.json");
        let store = ManagedHostKeyStore::new(&root);
        Self { root, input, store }
    }

    fn deliver(&self, binding: &ManagedHostKeyBinding) {
        self.write(&self.input, &wire(binding));
    }

    fn write(&self, path: &Path, value: &Value) {
        write_auth_string_to_path(path, &serde_json::to_string(value).unwrap()).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn binding() -> ManagedHostKeyBinding {
    ManagedHostKeyBinding {
        bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
        managed_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".into(),
        host_incarnation_id: "cr-uid-1".into(),
        pvc_uid: "pvc-uid-1".into(),
        organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
        owner_epoch: 1,
        key_generation: 1,
        local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
        key_id: "provider-key-1".into(),
        clerk_instance_id: "instance-test".into(),
        inference_origin: "https://api.arcee.ai".into(),
    }
}

fn next_binding(previous: &ManagedHostKeyBinding) -> ManagedHostKeyBinding {
    ManagedHostKeyBinding {
        bootstrap_id: "b6a73906-20aa-449d-9723-8b9c9a3e5e98".into(),
        key_generation: previous.key_generation + 1,
        local_key_id: "a4a4c594-4684-465e-8bdd-3951f87ae0c0".into(),
        key_id: "provider-key-2".into(),
        ..previous.clone()
    }
}

fn wire(binding: &ManagedHostKeyBinding) -> Value {
    let mut wire = serde_json::to_value(binding).unwrap();
    wire["version"] = json!(3);
    wire["credential_kind"] = json!(KIND);
    wire["scopes"] = json!([SCOPE]);
    wire["api_key"] = json!(KEY);
    wire
}

fn snapshot(fixture: &Fixture) -> (Vec<u8>, Vec<u8>) {
    (
        fs::read(&fixture.store.authority).unwrap(),
        fs::read(&fixture.store.receipt).unwrap(),
    )
}

#[test]
fn initial_import_is_private_exact_and_restart_is_mount_free() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    fixture.store.import(&expected, &fixture.input).unwrap();
    let before = snapshot(&fixture);
    let receipt: Value = serde_json::from_slice(&before.1).unwrap();
    assert_eq!(receipt["version"], 3);
    assert_eq!(receipt["pvc_uid"], expected.pvc_uid);
    assert_eq!(receipt["local_key_id"], expected.local_key_id);
    assert!(receipt.get("api_key").is_none());
    assert!(!String::from_utf8(before.1.clone()).unwrap().contains(KEY));
    fs::remove_file(&fixture.input).unwrap();
    fixture.store.import(&expected, &fixture.input).unwrap();
    fixture.store.validate_local(&expected).unwrap();
    assert_eq!(snapshot(&fixture), before);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for path in [&fixture.store.authority, &fixture.store.receipt] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}

#[test]
fn strict_delivery_rejects_fields_classes_types_and_binding_without_writes() {
    for (field, wrong) in [
        ("version", json!(2)),
        ("version", json!(3.0)),
        ("credential_kind", json!("oauth_token")),
        ("scopes", json!([SCOPE, "admin"])),
        ("scopes", json!([])),
        ("owner_epoch", json!(true)),
        ("owner_epoch", json!(0)),
        ("key_generation", json!(-1)),
        ("key_generation", json!(u64::MAX)),
        ("api_key", json!(null)),
        ("api_key", json!("secret with spaces")),
        ("unexpected", json!(KEY)),
    ] {
        let fixture = Fixture::new();
        let expected = binding();
        let mut value = wire(&expected);
        value[field] = wrong;
        fixture.write(&fixture.input, &value);
        let error = fixture.store.import(&expected, &fixture.input).unwrap_err();
        assert!(!format!("{error:#}").contains(KEY), "{field}");
        assert!(!fixture.store.authority.exists(), "{field}");
        assert!(!fixture.store.receipt.exists(), "{field}");
    }
    for field in [
        "bootstrap_id",
        "managed_host_id",
        "host_incarnation_id",
        "pvc_uid",
        "organization_id",
        "local_key_id",
        "key_id",
        "clerk_instance_id",
        "inference_origin",
    ] {
        let fixture = Fixture::new();
        let expected = binding();
        let mut value = wire(&expected);
        value[field] = json!("wrong-binding");
        fixture.write(&fixture.input, &value);
        assert!(
            fixture.store.import(&expected, &fixture.input).is_err(),
            "{field}"
        );
        assert!(!fixture.store.authority.exists(), "{field}");
    }
}

#[test]
fn missing_duplicate_and_noncanonical_fields_fail_closed() {
    let expected = binding();
    for field in wire(&expected).as_object().unwrap().keys() {
        let fixture = Fixture::new();
        let mut value = wire(&expected);
        value.as_object_mut().unwrap().remove(field);
        fixture.write(&fixture.input, &value);
        assert!(
            fixture.store.import(&expected, &fixture.input).is_err(),
            "{field}"
        );
        assert!(!fixture.store.authority.exists());
    }
    let fixture = Fixture::new();
    let raw = serde_json::to_string(&wire(&expected)).unwrap();
    let duplicate = raw.replacen('{', "{\"owner_epoch\":1,", 1);
    write_auth_string_to_path(&fixture.input, &duplicate).unwrap();
    assert!(fixture.store.import(&expected, &fixture.input).is_err());
    let mut uppercase = expected.clone();
    uppercase.bootstrap_id.make_ascii_uppercase();
    assert!(uppercase.validate().is_err());
    let mut too_large = expected;
    too_large.owner_epoch = i64::MAX as u64 + 1;
    assert!(too_large.validate().is_err());
}

#[test]
fn committed_authority_recovers_projection_without_reading_stale_delivery() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    fixture
        .store
        .import_with_failpoint(&expected, &fixture.input, || bail!("synthetic crash"))
        .unwrap_err();
    let before = fs::read(&fixture.store.authority).unwrap();
    assert!(!fixture.store.receipt.exists());
    fixture.deliver(&next_binding(&expected));
    fixture.store.import(&expected, &fixture.input).unwrap();
    assert_eq!(fs::read(&fixture.store.authority).unwrap(), before);
    let receipt: Value =
        serde_json::from_slice(&fs::read(&fixture.store.receipt).unwrap()).unwrap();
    assert_eq!(receipt["bootstrap_id"], expected.bootstrap_id);
    fs::remove_file(&fixture.store.receipt).unwrap();
    fs::remove_file(&fixture.input).unwrap();
    fixture.store.validate_local(&expected).unwrap();
    assert_eq!(fs::read(&fixture.store.authority).unwrap(), before);
}

#[test]
fn projection_failure_preserves_committed_authority_for_retry() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    fixture
        .store
        .import_with_failpoint(&expected, &fixture.input, || {
            fs::create_dir(&fixture.store.receipt)?;
            Ok(())
        })
        .unwrap_err();
    let before = fs::read(&fixture.store.authority).unwrap();
    fs::remove_dir(&fixture.store.receipt).unwrap();
    fs::remove_file(&fixture.input).unwrap();
    fixture.store.import(&expected, &fixture.input).unwrap();
    assert_eq!(fs::read(&fixture.store.authority).unwrap(), before);
}

#[test]
fn corrupt_or_missing_authority_never_reimports_a_consumed_mount() {
    for corrupt in [true, false] {
        let fixture = Fixture::new();
        let expected = binding();
        fixture.deliver(&expected);
        fixture.store.import(&expected, &fixture.input).unwrap();
        let receipt = fs::read(&fixture.store.receipt).unwrap();
        if corrupt {
            write_auth_string_to_path(&fixture.store.authority, "{synthetic-corrupt-key-canary")
                .unwrap();
        } else {
            fs::remove_file(&fixture.store.authority).unwrap();
        }
        assert!(fixture.store.import(&expected, &fixture.input).is_err());
        assert_eq!(fs::read(&fixture.store.receipt).unwrap(), receipt);
        assert!(fixture.store.validate_local(&expected).is_err());
    }
}

#[test]
fn revocation_tombstones_and_same_owner_repair_preserve_consumed_history() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    fixture.store.import(&expected, &fixture.input).unwrap();
    let next = next_binding(&expected);
    fixture.deliver(&next);
    let before = snapshot(&fixture);
    assert!(fixture
        .store
        .repair(&expected, &next, &fixture.input)
        .is_err());
    assert!(fixture.store.import(&next, &fixture.input).is_err());
    assert_eq!(snapshot(&fixture), before);
    fixture.store.record_revocation(&expected).unwrap();
    fixture.store.import(&expected, &fixture.input).unwrap();
    assert!(fixture.store.validate_local(&expected).is_err());
    fixture
        .store
        .repair(&expected, &next, &fixture.input)
        .unwrap();
    fs::remove_file(&fixture.input).unwrap();
    fixture
        .store
        .repair(&expected, &next, &fixture.input)
        .unwrap();
    fixture.store.validate_local(&next).unwrap();
    let authority = fixture.store.read_authority().unwrap().unwrap();
    assert_eq!(
        authority.consumed_bootstrap_ids,
        [expected.bootstrap_id.clone(), next.bootstrap_id.clone()]
    );
    assert!(fixture.store.import(&expected, &fixture.input).is_err());
    assert!(fixture.store.record_revocation(&expected).is_err());
}

#[test]
fn repair_rejects_reuse_owner_transfer_and_stale_predecessor() {
    for field in [
        "owner_epoch",
        "pvc_uid",
        "host_incarnation_id",
        "organization_id",
        "key_generation",
        "bootstrap_id",
    ] {
        let fixture = Fixture::new();
        let expected = binding();
        fixture.deliver(&expected);
        fixture.store.import(&expected, &fixture.input).unwrap();
        fixture.store.record_revocation(&expected).unwrap();
        let before = snapshot(&fixture);
        let mut next = serde_json::to_value(next_binding(&expected)).unwrap();
        next[field] = match field {
            "owner_epoch" => json!(2),
            "key_generation" => json!(1),
            "bootstrap_id" => json!(expected.bootstrap_id),
            _ => json!("replacement"),
        };
        let next: ManagedHostKeyBinding = serde_json::from_value(next).unwrap();
        fixture.deliver(&next);
        assert!(
            fixture
                .store
                .repair(&expected, &next, &fixture.input)
                .is_err(),
            "{field}"
        );
        assert_eq!(snapshot(&fixture), before);
    }
}

#[cfg(unix)]
#[test]
fn no_follow_mount_authority_and_projection_paths_preserve_targets() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let expected = binding();
    let target = fixture.root.join("target");
    fixture.write(&target, &wire(&expected));
    symlink(&target, &fixture.input).unwrap();
    let before = fs::read(&target).unwrap();
    assert!(fixture.store.import(&expected, &fixture.input).is_err());
    assert_eq!(fs::read(&target).unwrap(), before);
    fs::remove_file(&fixture.input).unwrap();
    fixture.deliver(&expected);
    fixture.store.import(&expected, &fixture.input).unwrap();
    fs::remove_file(&fixture.store.receipt).unwrap();
    symlink(&target, &fixture.store.receipt).unwrap();
    assert!(fixture.store.validate_local(&expected).is_err());
    assert_eq!(fs::read(&target).unwrap(), before);
    fs::remove_file(&fixture.store.authority).unwrap();
    symlink(&target, &fixture.store.authority).unwrap();
    assert!(fixture.store.import(&expected, &fixture.input).is_err());
    assert_eq!(fs::read(&target).unwrap(), before);
}

#[test]
fn racing_import_and_repair_have_one_original_authority_and_one_successor() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    let run = |previous: Option<ManagedHostKeyBinding>, next: ManagedHostKeyBinding| {
        let barrier = Arc::new(Barrier::new(3));
        let threads = (0..2)
            .map(|_| {
                let barrier = barrier.clone();
                let store = fixture.store.clone();
                let input = fixture.input.clone();
                let previous = previous.clone();
                let next = next.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    match previous {
                        Some(previous) => store.repair(&previous, &next, &input),
                        None => store.import(&next, &input),
                    }
                    .unwrap();
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        for thread in threads {
            thread.join().unwrap();
        }
    };
    run(None, expected.clone());
    fixture.store.record_revocation(&expected).unwrap();
    let next = next_binding(&expected);
    fixture.deliver(&next);
    run(Some(expected.clone()), next.clone());
    let authority = fixture.store.read_authority().unwrap().unwrap();
    assert_eq!(
        authority.consumed_bootstrap_ids,
        [expected.bootstrap_id, next.bootstrap_id]
    );
    assert_eq!(authority.generation_watermark, 2);
}

#[test]
fn importer_process_helper() {
    let Some(root) = std::env::var_os("NAC_STATIC_KEY_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    ManagedHostKeyStore::new(&root)
        .import(&binding(), &root.join("bootstrap.json"))
        .unwrap();
}

#[test]
fn separate_process_importers_share_the_durable_lock() {
    let fixture = Fixture::new();
    fixture.deliver(&binding());
    let children = (0..2)
        .map(|_| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "model::managed_host_key::tests::importer_process_helper",
                    "--nocapture",
                ])
                .env("NAC_STATIC_KEY_TEST_ROOT", &fixture.root)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    for child in children {
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let authority = fixture.store.read_authority().unwrap().unwrap();
    assert_eq!(authority.consumed_bootstrap_ids, [binding().bootstrap_id]);
    fixture.store.validate_local(&binding()).unwrap();
}

#[test]
fn retained_legacy_authorization_blocks_import_and_use_without_clearing_it() {
    let fixture = Fixture::new();
    let expected = binding();
    fixture.deliver(&expected);
    let legacy = fixture.root.join("arcee_auth.json");
    fs::write(&legacy, b"retained-former-user-credential").unwrap();
    assert!(fixture.store.import(&expected, &fixture.input).is_err());
    assert!(!fixture.store.authority.exists());
    assert_eq!(
        fs::read(&legacy).unwrap(),
        b"retained-former-user-credential"
    );
    fs::remove_file(&legacy).unwrap();
    fixture.store.import(&expected, &fixture.input).unwrap();
    fs::write(&legacy, b"retained-former-user-credential").unwrap();
    assert!(fixture.store.validate_local(&expected).is_err());
    let capability = TrustedManagedHostKey::new(&fixture.root, expected.clone()).unwrap();
    assert!(capability.credential().is_err());
    fixture.store.record_revocation(&expected).unwrap();
    assert_eq!(
        fs::read(&legacy).unwrap(),
        b"retained-former-user-credential"
    );
}
