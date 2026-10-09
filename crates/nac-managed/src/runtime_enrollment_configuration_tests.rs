//! Real owned filesystem probes; public synthetic inputs never enroll a peer.
#![cfg(unix)]
use super::*;
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::{
        ffi::OsStrExt,
        fs::{symlink, MetadataExt, PermissionsExt},
    },
};

struct Fixture {
    root: PathBuf,
    expected: RuntimeEnrollmentExpectations,
    document: Value,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-enrollment-candidate-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap(); // fixture selection only, never loader resolution
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let metadata = fs::symlink_metadata(&root).unwrap();
        let configuration_path = root.join("candidate.json");
        let credentials = RuntimeEnrollmentCredentialFiles {
            certificate_chain: root.join("public-fixture-cert.der"),
            private_key: root.join("public-fixture-key.der"),
            peer_ca: root.join("public-fixture-ca.der"),
        };
        let host = ManagedHostKeyConfig {
            bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
            managed_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".into(),
            host_incarnation_id: "fixture-cr-1".into(),
            pvc_uid: "fixture-pvc-1".into(),
            organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
            owner_epoch: 1,
            key_generation: 2,
            local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
            key_id: "fixture-provider-key-1".into(),
            clerk_instance_id: "fixture-instance-1".into(),
            inference_origin: "https://fixture.invalid".into(),
        };
        let release = RuntimeEnrollmentReleaseBinding {
            release_id: "fixture-release".into(),
            source_revision: "a".repeat(40),
            artifact_sha256: "b".repeat(64),
        };
        let peer = RuntimeEnrollmentPeer {
            purpose: RuntimeEnrollmentPurpose::IssuerControl,
            leaf_sha256: "c".repeat(64),
            ca_sha256: "d".repeat(64),
        };
        let expected = RuntimeEnrollmentExpectations {
            configuration_path: configuration_path.clone(),
            mount: RuntimeEnrollmentMountExpectation {
                path: root.clone(),
                device: metadata.dev(),
                inode: metadata.ino(),
                owner_uid: metadata.uid(),
                owner_gid: metadata.gid(),
            },
            file_owner_uid: metadata.uid(),
            file_owner_gid: metadata.gid(),
            role: RuntimeEnrollmentRole::IssuerClient,
            host_binding: host.clone(),
            runtime_release_binding: release.clone(),
            enrollment_generation: 3,
            maximum_valid_until_epoch_ms: now_ms().unwrap() + 120_000,
            peer: peer.clone(),
            local_credential_files: credentials.clone(),
        };
        let document = json!({"version":1,"role":"issuer-client","host_binding":host,
            "runtime_release_binding":{"release_id":release.release_id,"source_revision":release.source_revision,"artifact_sha256":release.artifact_sha256},
            "enrollment_generation":3,"valid_until_epoch_ms":now_ms().unwrap()+60_000,
            "peer":{"purpose":"issuer-control","leaf_sha256":peer.leaf_sha256,"ca_sha256":peer.ca_sha256},
            "local_credential_files":{"certificate_chain":credentials.certificate_chain,"private_key":credentials.private_key,"peer_ca":credentials.peer_ca}});
        for (path, mode) in [
            (&credentials.certificate_chain, 0o644),
            (&credentials.private_key, 0o600),
            (&credentials.peer_ca, 0o644),
        ] {
            fs::write(
                path,
                b"publicly known synthetic fixture; no certificate qualification",
            )
            .unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        }
        let fixture = Self {
            root,
            expected,
            document,
        };
        fixture.write(&fixture.document);
        fixture
    }
    fn write(&self, document: &Value) {
        self.raw(&serde_json::to_vec(document).unwrap());
    }
    fn raw(&self, bytes: &[u8]) {
        fs::write(&self.expected.configuration_path, bytes).unwrap();
        fs::set_permissions(
            &self.expected.configuration_path,
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
    }
    fn load(&self) -> Result<Option<RuntimeEnrollmentConfigurationCandidate>> {
        RuntimeEnrollmentConfigurationCandidate::load_optional(
            Some(&self.expected.configuration_path),
            &self.expected,
        )
    }
    fn finish(self) {
        fs::remove_dir_all(&self.root).unwrap();
        assert!(!self.root.exists(), "fixture root removed");
    }
}

#[test]
fn optional_absence_does_no_io_even_with_invalid_unavailable_expectations() {
    let mut f = Fixture::new();
    fs::remove_dir_all(&f.root).unwrap();
    f.expected.mount.path = PathBuf::from("relative-and-missing");
    f.expected.mount.owner_uid = u32::MAX;
    f.expected.peer.leaf_sha256.clear();
    assert_eq!(
        RuntimeEnrollmentConfigurationCandidate::load_optional(None, &f.expected).unwrap(),
        None
    );
    assert!(!f.root.exists());
}

#[test]
fn configuration_candidate_retains_nonsecret_paths_without_authority_or_tls_qualification() {
    let f = Fixture::new();
    let candidate = f.load().unwrap().unwrap();
    assert_eq!(candidate.host_binding, f.expected.host_binding);
    assert_eq!(
        candidate.local_credential_files,
        f.expected.local_credential_files
    );
    let debug = format!("{candidate:?}");
    assert!(
        !debug.contains("publicly known synthetic fixture"),
        "credential file bytes never returned"
    );
    // These are not certificates/keys. The parser deliberately cannot convert
    // its successful observation into certificate enrollment or current proof.
    f.finish();
}

#[test]
fn all_host_release_peer_role_and_generation_bindings_are_independently_compared() {
    let f = Fixture::new();
    for section in ["host_binding", "runtime_release_binding", "peer"] {
        for name in f.document[section].as_object().unwrap().keys() {
            let mut document = f.document.clone();
            document[section][name] = Value::Null;
            f.write(&document);
            assert!(f.load().is_err(), "wrong {section}.{name}");
        }
    }
    for (name, wrong) in [
        ("role", json!("runtime-observer")),
        ("enrollment_generation", json!(4)),
        ("version", json!(2)),
        ("valid_until_epoch_ms", json!(now_ms().unwrap() - 1)),
        (
            "valid_until_epoch_ms",
            json!(f.expected.maximum_valid_until_epoch_ms + 1),
        ),
    ] {
        let mut document = f.document.clone();
        document[name] = wrong;
        f.write(&document);
        assert!(f.load().is_err(), "wrong {name}");
    }
    // Syntactically valid source substitution also fails, not only malformed DTOs.
    for section in ["host_binding", "runtime_release_binding", "peer"] {
        for (name, original) in f.document[section].as_object().unwrap() {
            if name == "purpose" {
                continue;
            }
            let mut document = f.document.clone();
            document[section][name] = if original.is_number() {
                json!(original.as_u64().unwrap() + 1)
            } else {
                json!(format!("{}x", original.as_str().unwrap()))
            };
            f.write(&document);
            assert!(f.load().is_err(), "substituted {section}.{name}");
        }
    }
    f.finish();
}

#[test]
fn duplicate_unknown_nested_objects_and_noncanonical_scalar_values_fail_closed() {
    let f = Fixture::new();
    let base = serde_json::to_string(&f.document).unwrap();
    for (name, value) in [
        ("version", "1"),
        ("enrollment_generation", "3"),
        ("role", "\"issuer-client\""),
    ] {
        f.raw(format!("{{\"{name}\":{value},{}", &base[1..]).as_bytes());
        assert!(f.load().is_err(), "duplicate {name}");
    }
    for (section, name) in [
        ("host_binding", "key_generation"),
        ("runtime_release_binding", "release_id"),
        ("peer", "purpose"),
        ("local_credential_files", "private_key"),
    ] {
        let value = serde_json::to_string(&f.document[section][name]).unwrap();
        let marker = format!("\"{section}\":{{");
        f.raw(
            base.replace(&marker, &format!("{marker}\"{name}\":{value},"))
                .as_bytes(),
        );
        assert!(f.load().is_err(), "duplicate nested {name}");
    }
    for section in [
        "",
        "host_binding",
        "runtime_release_binding",
        "peer",
        "local_credential_files",
    ] {
        let mut document = f.document.clone();
        let object = if section.is_empty() {
            &mut document
        } else {
            &mut document[section]
        };
        object["raw_key"] = json!("untrusted-inline-value");
        f.write(&document);
        assert!(f.load().is_err(), "unknown in {section}");
    }
    for value in [
        json!(-1),
        json!(0),
        json!(1.0),
        json!(true),
        json!("3"),
        json!(9223372036854775808_u64),
    ] {
        let mut document = f.document.clone();
        document["enrollment_generation"] = value;
        f.write(&document);
        assert!(f.load().is_err());
    }
    for raw in [b"[]".as_slice(), b"null", b"", b"{}{}", b"\xff"] {
        f.raw(raw);
        assert!(f.load().is_err());
    }
    f.finish();
}

#[test]
fn invalid_expected_bindings_are_rejected_even_when_manifest_echoes_them() {
    for variant in 0..14 {
        let mut f = Fixture::new();
        match variant {
            0 => {
                f.expected.host_binding.bootstrap_id = "4712BC5E-30D5-421A-B416-8291D9F7D8F9".into()
            }
            1 => f.expected.host_binding.local_key_id = "not-a-uuid".into(),
            2 => f.expected.host_binding.owner_epoch = 0,
            3 => f.expected.host_binding.key_generation = i64::MAX as u64 + 1,
            4 => f.expected.host_binding.pvc_uid = "x".repeat(257),
            5 => f.expected.host_binding.clerk_instance_id = "bad\ninstance".into(),
            6 => f.expected.host_binding.inference_origin.push('/'),
            7 => f.expected.runtime_release_binding.source_revision = "A".repeat(40),
            8 => f.expected.runtime_release_binding.artifact_sha256 = "0".repeat(64),
            9 => f.expected.peer.ca_sha256 = "g".repeat(64),
            10 => f.expected.peer.leaf_sha256 = "0".repeat(64),
            11 => f.expected.enrollment_generation = 0,
            12 => f.expected.peer.purpose = RuntimeEnrollmentPurpose::RuntimeObservation,
            _ => f.expected.maximum_valid_until_epoch_ms = now_ms().unwrap() - 1,
        }
        f.document["host_binding"] = serde_json::to_value(&f.expected.host_binding).unwrap();
        f.document["runtime_release_binding"]["source_revision"] =
            json!(f.expected.runtime_release_binding.source_revision);
        f.document["runtime_release_binding"]["artifact_sha256"] =
            json!(f.expected.runtime_release_binding.artifact_sha256);
        f.document["peer"]["leaf_sha256"] = json!(f.expected.peer.leaf_sha256);
        f.document["peer"]["ca_sha256"] = json!(f.expected.peer.ca_sha256);
        f.document["peer"]["purpose"] = match f.expected.peer.purpose {
            RuntimeEnrollmentPurpose::IssuerControl => json!("issuer-control"),
            RuntimeEnrollmentPurpose::RuntimeObservation => json!("runtime-observation"),
        };
        f.document["enrollment_generation"] = json!(f.expected.enrollment_generation);
        f.write(&f.document);
        assert!(
            f.load().is_err(),
            "invalid independent expected binding {variant}"
        );
        f.finish();
    }
}

#[test]
fn fixed_mount_path_file_ownership_and_private_key_permissions_use_actual_metadata() {
    for variant in 0..12 {
        let mut f = Fixture::new();
        match variant {
            0 => f.expected.mount.owner_uid = f.expected.mount.owner_uid.wrapping_add(1),
            1 => f.expected.mount.owner_gid = f.expected.mount.owner_gid.wrapping_add(1),
            2 => f.expected.file_owner_uid = f.expected.file_owner_uid.wrapping_add(1),
            3 => f.expected.file_owner_gid = f.expected.file_owner_gid.wrapping_add(1),
            4 => f.expected.mount.device = f.expected.mount.device.wrapping_add(1),
            5 => f.expected.mount.inode = f.expected.mount.inode.wrapping_add(1),
            6 => fs::set_permissions(&f.root, fs::Permissions::from_mode(0o770)).unwrap(),
            7 => fs::set_permissions(
                &f.expected.configuration_path,
                fs::Permissions::from_mode(0o620),
            )
            .unwrap(),
            8 => fs::set_permissions(
                &f.expected.local_credential_files.private_key,
                fs::Permissions::from_mode(0o640),
            )
            .unwrap(),
            9 => fs::set_permissions(
                &f.expected.local_credential_files.peer_ca,
                fs::Permissions::from_mode(0o646),
            )
            .unwrap(),
            10 => {
                f.expected.local_credential_files.peer_ca =
                    f.expected.local_credential_files.private_key.clone()
            }
            _ => {
                f.expected.local_credential_files.peer_ca =
                    PathBuf::from("/unexpected/mount/ca.der")
            }
        }
        assert!(
            f.load().is_err(),
            "actual selected metadata mismatch {variant}"
        );
        f.finish();
    }
    let f = Fixture::new();
    assert!(RuntimeEnrollmentConfigurationCandidate::load_optional(
        Some(&f.root.join("other.json")),
        &f.expected
    )
    .is_err());
    f.finish();
}

#[test]
fn symlinks_at_leaf_mount_and_intermediate_directory_never_resolve() {
    for credential in [false, true] {
        let f = Fixture::new();
        let selected = if credential {
            &f.expected.local_credential_files.private_key
        } else {
            &f.expected.configuration_path
        };
        let target = f.root.join("redirected");
        fs::rename(selected, &target).unwrap();
        symlink(&target, selected).unwrap();
        assert!(f.load().is_err());
        f.finish();
    }
    let mut f = Fixture::new();
    let link = f.root.with_extension("mount-link");
    symlink(&f.root, &link).unwrap();
    f.expected.mount.path = link.clone();
    f.expected.configuration_path = link.join("candidate.json");
    f.expected.local_credential_files.certificate_chain = link.join("public-fixture-cert.der");
    f.expected.local_credential_files.private_key = link.join("public-fixture-key.der");
    f.expected.local_credential_files.peer_ca = link.join("public-fixture-ca.der");
    assert!(f.load().is_err());
    fs::remove_file(link).unwrap();
    f.finish();

    let mut f = Fixture::new();
    let nested = f.root.join("nested");
    symlink(&f.root, &nested).unwrap();
    f.expected.configuration_path = nested.join("candidate.json");
    assert!(f.load().is_err());
    f.finish();
}

#[test]
fn actual_fifo_directory_empty_and_oversized_files_are_bounded_and_nonblocking() {
    let f = Fixture::new();
    for size in [0, MAX_BYTES + 1] {
        f.raw(&vec![b' '; size as usize]);
        assert!(f.load().is_err());
    }
    f.raw(&vec![b' '; MAX_BYTES as usize]);
    let mount = mounted::Mount::open(&f.expected.mount).unwrap();
    let mut loaded = mount
        .open_file(&f.expected.configuration_path, &f.expected, false)
        .unwrap();
    assert_eq!(loaded.read_bounded().unwrap().len(), MAX_BYTES as usize);
    fs::remove_file(&f.expected.configuration_path).unwrap();
    fs::create_dir(&f.expected.configuration_path).unwrap();
    assert!(f.load().is_err());
    fs::remove_dir(&f.expected.configuration_path).unwrap();
    let name =
        std::ffi::CString::new(f.expected.configuration_path.as_os_str().as_bytes()).unwrap();
    // SAFETY: NUL-terminated disposable fixture path; no existing file replaced.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let started = std::time::Instant::now();
    assert!(f.load().is_err());
    assert!(
        started.elapsed() < std::time::Duration::from_secs(1),
        "FIFO open never waits for a writer"
    );
    f.finish();
}

#[test]
fn retained_fd_readback_and_mount_mutation_are_detected_without_racy_sleeps() {
    let f = Fixture::new();
    let mount = mounted::Mount::open(&f.expected.mount).unwrap();
    let mut before = mount
        .open_file(&f.expected.configuration_path, &f.expected, false)
        .unwrap();
    before.read_bounded().unwrap();
    f.raw(b"changed-after-first-read");
    assert!(before.check_unchanged().is_err());
    assert!(mount
        .open_file(&f.expected.configuration_path, &f.expected, false)
        .unwrap()
        .same_file(&before)
        .is_err());
    fs::set_permissions(&f.root, fs::Permissions::from_mode(0o750)).unwrap();
    assert!(mount.check_unchanged().is_err());
    f.finish();

    let f = Fixture::new();
    let selected = mounted::Mount::open(&f.expected.mount).unwrap();
    let replaced = f.root.with_extension("replaced-mount");
    fs::rename(&f.root, &replaced).unwrap();
    fs::create_dir(&f.root).unwrap();
    fs::set_permissions(&f.root, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        mounted::Mount::open(&f.expected.mount).is_err(),
        "replacement inode cannot adopt selected mount"
    );
    assert!(selected.check_unchanged().is_err());
    fs::remove_dir_all(replaced).unwrap();
    f.finish();
}

#[test]
fn reviewed_role_purpose_pairs_parse_only_as_configuration_candidates() {
    for (role, purpose, role_text, purpose_text) in [
        (
            RuntimeEnrollmentRole::NativeOwner,
            RuntimeEnrollmentPurpose::IssuerControl,
            "native-owner",
            "issuer-control",
        ),
        (
            RuntimeEnrollmentRole::RuntimeObserver,
            RuntimeEnrollmentPurpose::RuntimeObservation,
            "runtime-observer",
            "runtime-observation",
        ),
        (
            RuntimeEnrollmentRole::IssuerClient,
            RuntimeEnrollmentPurpose::IssuerControl,
            "issuer-client",
            "issuer-control",
        ),
    ] {
        let mut f = Fixture::new();
        f.expected.role = role;
        f.expected.peer.purpose = purpose;
        f.document["role"] = json!(role_text);
        f.document["peer"]["purpose"] = json!(purpose_text);
        f.write(&f.document);
        assert_eq!(f.load().unwrap().unwrap().role, role);
        f.finish();
    }
}

#[test]
fn actual_open_descriptors_are_close_on_exec_and_nonblocking() {
    let f = Fixture::new();
    // Open the same private adapter descriptor; fcntl interrogates the kernel.
    let mount = mounted::Mount::open(&f.expected.mount).unwrap();
    let loaded = mount
        .open_file(&f.expected.configuration_path, &f.expected, false)
        .unwrap();
    let (descriptor_flags, status_flags) = loaded.fixture_descriptor_flags();
    assert_ne!(descriptor_flags & libc::FD_CLOEXEC, 0);
    assert_ne!(status_flags & libc::O_NONBLOCK, 0);
    f.finish();
}
