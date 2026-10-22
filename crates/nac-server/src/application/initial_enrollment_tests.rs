use super::*;
use std::{fs, path::PathBuf};

struct Fixture {
    root: PathBuf,
    path: PathBuf,
    context: ImportOriginalContext,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("nac-original-context-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("context.json");
        let context = ImportOriginalContext {
            version: 1,
            environment: "test".into(),
            provider_instance_id: "provider-one".into(),
            operation_id: Uuid::new_v4().to_string(),
            original_input_sha256: "11".repeat(32),
            lifecycle_check_sequence: 0,
            lifecycle_check_sha256: "22".repeat(32),
            product_release_id: Uuid::new_v4().to_string(),
            product_artifact_sha256: "33".repeat(32),
            source_expires_at_unix_ms: 1_001_000,
            max_exchange_duration_ms: 60_000,
        };
        let fixture = Self {
            root,
            path,
            context,
        };
        fixture.write(&serde_json::to_vec(&fixture.context).unwrap());
        fixture
    }

    fn write(&self, bytes: &[u8]) {
        fs::write(&self.path, bytes).unwrap();
    }

    fn load(&self) -> Result<InitialEnrollmentContext> {
        InitialEnrollmentContext::load_at(
            &self.path,
            Instant::now(),
            UNIX_EPOCH + Duration::from_secs(1_000),
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn production_load_captures_current_clocks_before_reading_the_selected_file() {
    let fixture = Fixture::new();
    let mut context = fixture.context.clone();
    let utc_before = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    context.source_expires_at_unix_ms = i64::try_from(utc_before.as_millis()).unwrap() + 10_000;
    fixture.write(&serde_json::to_vec(&context).unwrap());
    let before = Instant::now();
    let snapshot = InitialEnrollmentContext::load(&fixture.path).unwrap();
    assert_eq!(snapshot.context(), &context);
    assert!(snapshot.deadline() > before);
    assert!(snapshot.deadline() <= Instant::now() + Duration::from_secs(10));
}

#[test]
fn original_context_is_a_snapshot_with_a_distinct_attempt_and_unchanged_deadline() {
    let fixture = Fixture::new();
    let snapshot = fixture.load().unwrap();
    let deadline = snapshot.deadline();
    let attempt = snapshot.attempt_id();
    assert!(!attempt.is_nil());
    assert_ne!(attempt.to_string(), snapshot.context().operation_id);
    fixture.write(b"{\"environment\":\"changed-after-read\"}");
    assert_eq!(snapshot.context(), &fixture.context);
    assert_eq!(snapshot.deadline(), deadline);
    assert_eq!(snapshot.attempt_id(), attempt);
    snapshot.check_current().unwrap();
    assert!(fixture.load().is_err());
}

#[test]
fn source_expiry_preserves_fractional_utc_and_caps_the_original_start() {
    let fixture = Fixture::new();
    let start = Instant::now();
    let utc = UNIX_EPOCH + Duration::from_micros(1_000_499_750);
    let snapshot = InitialEnrollmentContext::load_at(&fixture.path, start, utc).unwrap();
    assert_eq!(snapshot.deadline(), start + Duration::from_micros(500_250));
    let mut context = fixture.context.clone();
    context.max_exchange_duration_ms = 100;
    fixture.write(&serde_json::to_vec(&context).unwrap());
    let snapshot = InitialEnrollmentContext::load_at(&fixture.path, start, utc).unwrap();
    assert_eq!(snapshot.deadline(), start + Duration::from_millis(100));
}

#[test]
fn already_expired_original_scope_and_invalid_utc_cannot_be_rebased_on_receipt() {
    let fixture = Fixture::new();
    for utc in [UNIX_EPOCH, UNIX_EPOCH + Duration::from_millis(1_001_000)] {
        assert!(InitialEnrollmentContext::load_at(&fixture.path, Instant::now(), utc).is_err());
    }
    let old_start = Instant::now() - Duration::from_secs(2);
    let utc = UNIX_EPOCH + Duration::from_secs(1_000);
    assert!(InitialEnrollmentContext::load_at(&fixture.path, old_start, utc).is_err());
    let mut snapshot = fixture.load().unwrap();
    snapshot.deadline = Instant::now();
    assert!(snapshot.check_current().is_err());
    fixture.write(&serde_json::to_vec(&fixture.context).unwrap());
    assert!(snapshot.check_current().is_err());
}

#[test]
fn context_json_rejects_duplicate_unknown_missing_null_trailing_and_coerced_fields() {
    let fixture = Fixture::new();
    let raw = serde_json::to_string(&fixture.context).unwrap();
    let valid: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let mut malformed = vec![
        format!("{{\"version\":1,{}", &raw[1..]),
        format!("{{\"extra\":true,{}", &raw[1..]),
        format!("{raw} {{}}"),
        "{}".into(),
    ];
    for replacement in [
        serde_json::Value::Null,
        serde_json::json!("1"),
        serde_json::json!(1.0),
    ] {
        let mut value = valid.clone();
        value["version"] = replacement;
        malformed.push(value.to_string());
    }
    for raw in malformed {
        fixture.write(raw.as_bytes());
        assert!(fixture.load().is_err());
    }
    fixture.write(&[0xff, 0xfe]);
    assert!(fixture.load().is_err());
    let mut value = valid;
    value["environment"] = serde_json::json!("invalid environment");
    fixture.write(value.to_string().as_bytes());
    assert!(fixture.load().is_err());
}

#[test]
fn context_read_enforces_the_exact_nonempty_64_kib_bound() {
    let fixture = Fixture::new();
    let mut bytes = serde_json::to_vec(&fixture.context).unwrap();
    bytes.resize(MAX_CONTEXT_BYTES as usize, b' ');
    fixture.write(&bytes);
    fixture.load().unwrap();
    bytes.push(b' ');
    fixture.write(&bytes);
    assert!(fixture.load().is_err());
    fixture.write(b"");
    assert!(fixture.load().is_err());
    assert!(InitialEnrollmentContext::load(Path::new("relative.json")).is_err());
}

#[cfg(unix)]
#[test]
fn context_reader_denies_symlinks_writable_modes_and_nonregular_inputs() {
    use std::{
        ffi::CString,
        os::unix::{
            ffi::OsStrExt,
            fs::{symlink, PermissionsExt},
        },
    };
    let fixture = Fixture::new();
    for mode in [0o664, 0o646] {
        fs::set_permissions(&fixture.path, fs::Permissions::from_mode(mode)).unwrap();
        assert!(fixture.load().is_err());
    }
    fs::set_permissions(&fixture.path, fs::Permissions::from_mode(0o444)).unwrap();
    fixture.load().unwrap();
    let link = fixture.root.join("context-link");
    symlink(&fixture.path, &link).unwrap();
    assert!(InitialEnrollmentContext::load(&link).is_err());
    assert!(InitialEnrollmentContext::load(&fixture.root).is_err());
    let fifo = fixture.root.join("fifo");
    let c_path = CString::new(fifo.as_os_str().as_bytes()).unwrap();
    // SAFETY: c_path is a valid NUL-terminated path owned by this fixture.
    assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
    assert!(InitialEnrollmentContext::load(&fifo).is_err());
}
