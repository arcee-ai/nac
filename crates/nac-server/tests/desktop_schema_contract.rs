#![cfg(unix)]
#![allow(
    clippy::missing_assert_message,
    clippy::unwrap_used,
    reason = "disposable integration fixtures and pure admission controls fail immediately"
)]

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::{
    fd::AsRawFd,
    unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    unix::net::UnixStream,
    unix::process::CommandExt,
};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use anyhow::{ensure, Context, Result};
use nac_core::sessions::StoreProcessLease;
use nac_process::ProcessTreeGuard;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const BINARY: &str = env!("CARGO_BIN_EXE_nac-web");
const GUIDANCE: &str = "The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.";
const LIMIT: usize = 16 * 1024;
const KEYS: [&str; 4] = [
    "NAC_DESKTOP_SCHEMA_ENGINE",
    "NAC_DESKTOP_SCHEMA_SHA256",
    "NAC_DESKTOP_SCHEMA_IDENTITY",
    "NAC_DESKTOP_SCHEMA_OUTPUT",
];

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn regular_bytes(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.len() <= limit,
        "expected a bounded regular file"
    );
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "file exceeded its read bound");
    Ok(bytes)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Identity {
    product_version: String,
    build_id: String,
    source_revision: String,
    track: String,
}

struct Override {
    engine: PathBuf,
    sha256: String,
    identity: Identity,
    output: PathBuf,
}

fn parse_override(values: &BTreeMap<String, String>) -> Result<Option<Override>> {
    ensure!(
        values.keys().all(|key| KEYS.contains(&key.as_str())),
        "unknown test adapter setting"
    );
    if values.is_empty() {
        return Ok(None);
    }
    ensure!(
        values.len() == KEYS.len(),
        "all explicit target settings are required; no fallback"
    );
    let identity: Identity = serde_json::from_str(&values[KEYS[2]])?;
    ensure!(
        !identity.product_version.is_empty()
            && !identity.build_id.is_empty()
            && ["dev", "beta", "stable"].contains(&identity.track.as_str())
            && identity.source_revision.len() == 40
            && identity
                .source_revision
                .bytes()
                .all(|c| c.is_ascii_hexdigit()),
        "invalid expected identity/source"
    );
    let sha256 = values[KEYS[1]].clone();
    ensure!(
        sha256.len() == 64 && sha256.bytes().all(|c| c.is_ascii_hexdigit()),
        "invalid expected digest"
    );
    Ok(Some(Override {
        engine: PathBuf::from(&values[KEYS[0]]),
        sha256,
        identity,
        output: PathBuf::from(&values[KEYS[3]]),
    }))
}

struct OutputRoot(PathBuf);
impl OutputRoot {
    fn create(path: &Path, app: &Path) -> Result<Self> {
        ensure!(
            path.is_absolute() && !path.starts_with(app),
            "output must be absolute and outside the package"
        );
        let parent = path.parent().context("output has no parent")?;
        ensure!(
            parent.canonicalize()? == parent,
            "output parent must be canonical"
        );
        let metadata = std::fs::metadata(parent)?;
        // SAFETY: geteuid observes this test actor's identity without changing it.
        ensure!(
            metadata.uid() == unsafe { libc::geteuid() }
                && metadata.permissions().mode() & 0o022 == 0,
            "output parent is not exclusively owned"
        );
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .context("output must be a fresh owned directory")?;
        Ok(Self(path.to_path_buf()))
    }
    fn write(&self, scenario: &str, proof: &Value) -> Result<()> {
        let metadata = std::fs::symlink_metadata(&self.0)?;
        // SAFETY: only observe the executing test actor's uid.
        ensure!(
            metadata.is_dir()
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.permissions().mode() & 0o777 == 0o700,
            "output ownership changed"
        );
        let bytes = serde_json::to_vec_pretty(proof)?;
        ensure!(bytes.len() <= 64 * 1024, "evidence exceeds its bound");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(self.0.join(format!("{scenario}.json")))?;
        file.write_all(&bytes)?;
        Ok(())
    }
}

struct Target {
    engine: PathBuf,
    expected: Option<(String, Identity)>,
    output: Option<OutputRoot>,
}
impl Target {
    fn bind(selection: Option<Override>) -> Result<Self> {
        let Some(selection) = selection else {
            return Ok(Self {
                engine: BINARY.into(),
                expected: None,
                output: None,
            });
        };
        ensure!(
            selection.engine.is_absolute() && selection.engine.canonicalize()? == selection.engine,
            "target must be an absolute canonical path"
        );
        let resources = selection
            .engine
            .parent()
            .context("target has no resources")?;
        let contents = resources.parent().context("target has no Contents")?;
        let app = contents.parent().context("target has no app")?;
        ensure!(
            selection.engine.file_name().is_some_and(|v| v == "nac-web")
                && resources.file_name().is_some_and(|v| v == "Resources")
                && contents.file_name().is_some_and(|v| v == "Contents")
                && app.extension().is_some_and(|v| v == "app"),
            "target must remain in its actual app bundle"
        );
        let observed: Identity = serde_json::from_slice(&regular_bytes(
            &resources.join("engine-identity.json"),
            LIMIT as u64,
        )?)?;
        ensure!(
            observed == selection.identity,
            "expected source/identity differs from the bound package"
        );
        let marker: Value = serde_json::from_slice(&regular_bytes(
            &resources.join("PackageIdentity.json"),
            2 * 1024 * 1024,
        )?)?;
        ensure!(
            marker["schema_version"] == 1
                && marker["engine_identity"] == serde_json::to_value(&selection.identity)?,
            "sealed identity differs"
        );
        ensure!(
            digest(&regular_bytes(&selection.engine, 512 * 1024 * 1024)?) == selection.sha256,
            "signed target digest mismatch"
        );
        let output = OutputRoot::create(&selection.output, app)?;
        Ok(Self {
            engine: selection.engine,
            expected: Some((selection.sha256, selection.identity)),
            output: Some(output),
        })
    }
    fn command(&self, root: &Path) -> Result<Command> {
        if let Some((sha, _)) = &self.expected {
            ensure!(
                digest(&regular_bytes(&self.engine, 512 * 1024 * 1024)?) == *sha,
                "target changed before spawn"
            );
        }
        let mut command = Command::new(&self.engine);
        command
            .env_clear()
            .env("HOME", root.join("home"))
            .env("NAC_HOME", root.join("nac"))
            .env("TMPDIR", root.join("tmp"))
            .env("PATH", "/usr/bin:/bin")
            .env("NAC_TELEMETRY", "disabled")
            .current_dir(root)
            .stdin(Stdio::null());
        Ok(command)
    }
}

fn target() -> Result<&'static Target> {
    static TARGET: OnceLock<std::result::Result<Target, String>> = OnceLock::new();
    TARGET
        .get_or_init(|| {
            let mut values = BTreeMap::new();
            for (key, value) in std::env::vars_os() {
                if key.to_string_lossy().starts_with("NAC_DESKTOP_SCHEMA_") {
                    values.insert(
                        key.into_string().map_err(|_| "non-UTF8 adapter key")?,
                        value.into_string().map_err(|_| "non-UTF8 adapter value")?,
                    );
                }
            }
            parse_override(&values)
                .and_then(Target::bind)
                .map_err(|error| format!("{error:#}"))
        })
        .as_ref()
        .map_err(|error| anyhow::anyhow!("{error}"))
}

struct Fixture {
    path: PathBuf,
    settled: bool,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.settled {
            let _ = std::fs::remove_dir_all(&self.path);
        } else {
            eprintln!("Retained unsettled fixture: {}", self.path.display());
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    bytes: Option<Vec<u8>>,
    modified: Option<SystemTime>,
}
fn snapshot(path: &Path) -> Snapshot {
    match std::fs::read(path) {
        Ok(bytes) => Snapshot {
            bytes: Some(bytes),
            modified: Some(std::fs::metadata(path).unwrap().modified().unwrap()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Snapshot {
            bytes: None,
            modified: None,
        },
        Err(error) => panic!("snapshot failed: {error}"),
    }
}
fn sqlite_snapshot(path: &Path) -> [Snapshot; 3] {
    ["", "-wal", "-shm"].map(|suffix| {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        snapshot(Path::new(&name))
    })
}
fn databases(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            found.extend(databases(&entry.path()));
        } else if entry.path().extension().is_some_and(|ext| ext == "db") {
            found.push(entry.path());
        }
    }
    found.sort();
    found
}
fn snapshot_proof(values: &[Snapshot]) -> Value {
    json!(values
        .iter()
        .map(|value| value.bytes.as_ref().map(|bytes| digest(bytes)))
        .collect::<Vec<_>>())
}

async fn settle(owner: &mut ProcessTreeGuard, child: &mut tokio::process::Child) -> Result<Value> {
    let reaped = child.try_wait()?.is_some();
    let port = if reaped {
        "finish_checked"
    } else {
        "terminate"
    };
    let result = tokio::time::timeout(Duration::from_secs(12), async {
        if reaped {
            owner.mark_leader_reaped();
            owner.finish_checked().await
        } else {
            owner.terminate(child).await
        }
    })
    .await
    .context("supervision cleanup deadline")?;
    result.context("owned process tree cleanup failed")?;
    ensure!(child.try_wait()?.is_some(), "owned child was not reaped");
    Ok(json!({"port":port,"result":"ok","direct_child_reaped":true,
        "descendants":"settled by existing owner; no independent census invented",
        "supervision_metadata":"owner-injected NAC_PROCESS_TREE/NAC_PROCESS_TREE_ROOT in otherwise closed child environment"}))
}

async fn capture(
    target: &Target,
    root: &Path,
    args: &[&str],
    role: &str,
    proof: &mut Value,
) -> Result<Vec<u8>> {
    let output_path = root.join(format!("{role}.stdout"));
    let mut command = target.command(root)?;
    command
        .args(args)
        .stdout(File::create(&output_path)?)
        .stderr(File::create(root.join(format!("{role}.stderr")))?);
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let (mut child, mut owner) = ProcessTreeGuard::spawn_supervised(&mut command)?;
    let owned_pid = child.id();
    let observation = tokio::time::timeout(Duration::from_secs(13), child.wait()).await;
    let cleanup = settle(&mut owner, &mut child).await;
    proof[role] = json!({"owned_child_pid_observed":owned_pid,"cleanup":cleanup.as_ref().ok(),"cleanup_error":cleanup.as_ref().err().map(|e| format!("{e:#}"))});
    cleanup?;
    ensure!(
        observation.context("metadata helper deadline")??.success(),
        "metadata helper failed"
    );
    regular_bytes(&output_path, LIMIT as u64)
}

async fn observe(
    mut command: Command,
    parent: UnixStream,
    child_endpoint: UnixStream,
    hello: &Value,
    root: &Path,
    proof: &mut Value,
) -> Result<(Value, Vec<u8>)> {
    command
        .stdout(Stdio::null())
        .stderr(File::create(root.join("serving.stderr"))?);
    let mut command = tokio::process::Command::from(command);
    command.kill_on_drop(true);
    let (mut child, mut owner) = ProcessTreeGuard::spawn_supervised(&mut command)?;
    drop(child_endpoint);
    let owned_pid = child.id();
    let observation: Result<(Value, Vec<u8>)> = async {
        let mut parent = parent;
        writeln!(parent, "{hello}")?;
        let mut reader = BufReader::new(parent);
        let mut bytes = Vec::new();
        let count = reader
            .by_ref()
            .take(LIMIT as u64 + 1)
            .read_until(b'\n', &mut bytes)?;
        ensure!(
            (1..=LIMIT).contains(&count) && bytes.last() == Some(&b'\n'),
            "missing or oversized observed pipe record"
        );
        proof["raw_wire_utf8"] = json!(std::str::from_utf8(&bytes)?);
        proof["raw_wire_sha256"] = json!(digest(&bytes));
        let receipt: Value = serde_json::from_slice(&bytes)?;
        proof["observed_record"] = receipt.clone();
        let status = tokio::time::timeout(Duration::from_secs(12), child.wait())
            .await
            .context("serving exit deadline")??;
        proof["exit_code"] = json!(status.code());
        ensure!(status.code() == Some(1), "unexpected serving exit");
        let mut trailing = Vec::new();
        reader.read_to_end(&mut trailing)?;
        ensure!(
            trailing.is_empty(),
            "failed launch published extra records/Ready"
        );
        proof["extra_record_absent"] = json!(true);
        Ok((receipt, bytes))
    }
    .await;
    let cleanup = settle(&mut owner, &mut child).await;
    proof["serving_supervision"] = json!({"owned_child_pid_observed":owned_pid,"cleanup":cleanup.as_ref().ok(),
        "cleanup_error":cleanup.as_ref().err().map(|e| format!("{e:#}"))});
    cleanup?;
    observation
}

async fn run_case(wal: bool, owned: bool, invalid: bool, scenario: &str) -> Result<()> {
    let target = target()?;
    let root = std::env::temp_dir().join(format!("nac desktop schema {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let mut fixture = Fixture {
        path: root.canonicalize().unwrap(),
        settled: false,
    };
    let root = &fixture.path;
    for name in ["home", "nac", "tmp", "selected store"] {
        std::fs::create_dir(root.join(name)).unwrap();
    }
    let store = root.join("selected store/selected.db");
    let config = root.join("nac/config.toml");
    std::fs::write(
        &config,
        format!("[storage]\nstore_path = '{}'\n", store.display()),
    )
    .unwrap();
    let config_before = snapshot(&config);
    let keeper = if invalid {
        std::fs::write(&store, b"invalid-sqlite-private-canary").unwrap();
        None
    } else {
        let connection = Connection::open(&store).unwrap();
        connection.execute_batch("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('retained-store-data');").unwrap();
        connection
            .pragma_update(None, "user_version", nac_core::store::schema_version())
            .unwrap();
        if wal {
            connection
                .pragma_update(None, "journal_mode", "WAL")
                .unwrap();
            connection
                .pragma_update(None, "wal_autocheckpoint", 0)
                .unwrap();
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
                .unwrap();
        }
        connection
            .pragma_update(None, "user_version", nac_core::store::schema_version() + 1)
            .unwrap();
        if wal {
            let bytes = std::fs::read(&store).unwrap();
            assert_eq!(
                u32::from_be_bytes(bytes[60..64].try_into().unwrap()) as i64,
                nac_core::store::schema_version()
            );
            Some(connection)
        } else {
            drop(connection);
            None
        }
    };
    let before = sqlite_snapshot(&store);
    let lease = owned.then(|| StoreProcessLease::try_acquire(&store).unwrap());

    let mut proof = json!({"schema":"nac356-private-protocol-observation-v1","scenario":scenario,"result":"incomplete",
        "engine_path":target.engine,"expected_target":target.expected,"test_compiler_git_revision":env!("NAC_SOURCE_REVISION"),
        "test_source_sha256":digest(include_bytes!("desktop_schema_contract.rs")),
        "test_executable_sha256":digest(&std::fs::read(std::env::current_exe()?)?),
        "scope":"Rust private pipe only; no AppKit/normal-App UI acceptance","fixture_root":root});
    proof["engine_sha256_observed"] =
        json!(digest(&regular_bytes(&target.engine, 512 * 1024 * 1024)?));
    proof["store_before_sha256"] = snapshot_proof(&before);
    proof["config_before_sha256"] = json!(digest(
        config_before
            .bytes
            .as_ref()
            .context("missing config snapshot")?
    ));
    let mut result: Result<()> = async {
        let identity_bytes = capture(target, root, &["__desktop-identity"], "identity_inspection", &mut proof).await?;
        let identity: Identity = serde_json::from_slice(&identity_bytes)?;
        if let Some((_, expected)) = &target.expected { ensure!(&identity == expected, "observed executable identity/source mismatch"); }
        proof["engine_identity_observed"] = serde_json::to_value(&identity)?;
        let selection_bytes = capture(target, root, &["__desktop-configuration", "--directory", root.to_str().context("non-UTF8 fixture")?], "configuration", &mut proof).await?;
        let selection: Value = serde_json::from_slice(&selection_bytes)?;
        ensure!(selection == json!({"version":1,"status":"selected","root_cwd":root,"store":store,"track":identity.track}), "preflight selected another store");
        ensure!(sqlite_snapshot(&store) == before && snapshot(&config) == config_before, "preflight changed store/config");
        if !owned { drop(StoreProcessLease::try_acquire(&store).context("preflight acquired a serving lease")?); }
        proof["preflight_selection_observed"] = selection;
        let (parent, child) = UnixStream::pair()?;
        parent.set_read_timeout(Some(Duration::from_secs(12)))?;
        parent.set_write_timeout(Some(Duration::from_secs(3)))?;
        let fd = child.as_raw_fd();
        let mut launch = target.command(root)?;
        launch.args(["--bind","127.0.0.1:0","--directory"]).arg(root).arg("--store-path").arg(&store)
            .arg("--worker-executable").arg(&target.engine).arg("--no-open").env("NAC_DESKTOP_CHANNEL_FD",fd.to_string());
        // SAFETY: inherit only this connected child endpoint. The engine sets
        // CLOEXEC again during its ordinary private-channel adoption.
        unsafe { launch.pre_exec(move || {
            let flags = libc::fcntl(fd,libc::F_GETFD);
            if flags < 0 || libc::fcntl(fd,libc::F_SETFD,flags & !libc::FD_CLOEXEC) < 0 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let incarnation = uuid::Uuid::new_v4().to_string();
        let hello = json!({"kind":"hello","version":1,"incarnation":incarnation,"identity":identity,"store":store});
        proof["hello_sent"] = hello.clone();
        let observed = observe(launch,parent,child,&hello,root,&mut proof).await;
        let (receipt, bytes) = observed?;
        ensure!(!std::fs::read_to_string(root.join("serving.stderr"))?.contains("invalid-sqlite-private-canary"), "private diagnostics escaped");
        ensure!(sqlite_snapshot(&store) == before && snapshot(&config) == config_before, "serving changed SQLite/config");
        ensure!(databases(root) == [store.clone()], "alternate database created");
        drop(lease);
        drop(StoreProcessLease::try_acquire(&store).context("failed child retained store lease")?);
        proof["store_before_sha256"] = snapshot_proof(&before);
        proof["store_after_sha256"] = snapshot_proof(&sqlite_snapshot(&store));
        proof["config_sha256"] = json!(digest(config_before.bytes.as_ref().context("missing config snapshot")?));
        proof["preserved_store_config"] = json!(true);
        proof["alternate_database_absent"] = json!(true);
        proof["lease_reacquired"] = json!(true);
        let code = if owned { "store_owned" } else if invalid { "engine_unavailable" } else { "store_schema_incompatible" };
        ensure!(receipt["kind"] == "failed" && receipt["version"] == 1 && receipt["incarnation"] == incarnation
            && receipt["stage"] == "startup" && receipt["code"] == code && receipt.get("endpoint").is_none(), "unexpected observed failure: {receipt}");
        ensure!(!String::from_utf8_lossy(&bytes).contains("invalid-sqlite-private-canary"), "private record data escaped");
        if !owned && !invalid { ensure!(receipt["message"] == GUIDANCE, "wrong observed guidance"); }
        Ok(())
    }.await;
    drop(keeper);
    if result.is_ok() {
        let cleanup =
            std::fs::remove_dir_all(&fixture.path).context("owned profile cleanup failed");
        proof["profile_cleanup"] = json!({"result": if cleanup.is_ok() { "ok" } else { "failed" },
            "error": cleanup.as_ref().err().map(|error| format!("{error:#}"))});
        result = cleanup.and_then(|()| {
            ensure!(!fixture.path.exists(), "successful fixture cleanup failed");
            fixture.settled = true;
            Ok(())
        });
    }
    proof["result"] = json!(if result.is_ok() { "passed" } else { "failed" });
    if let Err(error) = &result {
        proof["error"] = json!(format!("{error:#}"));
    }
    if let Some(output) = &target.output {
        output.write(scenario, &proof)?;
    }
    result?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn future_main_store_is_selected_then_rejected_with_guidance() -> Result<()> {
    run_case(false, false, false, "future-main").await
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn future_wal_store_is_selected_then_rejected_without_pager_changes() -> Result<()> {
    run_case(true, false, false, "future-wal").await
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn owned_future_store_retains_store_owned_priority() -> Result<()> {
    run_case(true, true, false, "busy-future").await
}
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unrelated_invalid_store_retains_generic_failure() -> Result<()> {
    run_case(false, false, true, "invalid-db").await
}

fn fake_options() -> (Fixture, BTreeMap<String, String>) {
    let path = std::env::temp_dir().join(format!("nac-adapter-{}", uuid::Uuid::new_v4()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&path)
        .unwrap();
    let fixture = Fixture {
        path: path.canonicalize().unwrap(),
        settled: true,
    };
    let resources = fixture.path.join("NAC.app/Contents/Resources");
    std::fs::create_dir_all(&resources).unwrap();
    let engine = resources.join("nac-web");
    std::fs::write(&engine, b"fake adapter input; never executed").unwrap();
    let identity = json!({"product_version":"0.1.4","build_id":"dev-test","source_revision":"d443a2aca506def2817b9afc0c9a20a75f5c4b5d","track":"dev"});
    std::fs::write(
        resources.join("engine-identity.json"),
        serde_json::to_vec(&identity).unwrap(),
    )
    .unwrap();
    std::fs::write(
        resources.join("PackageIdentity.json"),
        serde_json::to_vec(&json!({"schema_version":1,"engine_identity":identity})).unwrap(),
    )
    .unwrap();
    let values = BTreeMap::from([
        (KEYS[0].into(), engine.to_str().unwrap().into()),
        (KEYS[1].into(), digest(&std::fs::read(engine).unwrap())),
        (KEYS[2].into(), identity.to_string()),
        (
            KEYS[3].into(),
            fixture.path.join("observations").to_str().unwrap().into(),
        ),
    ]);
    (fixture, values)
}
#[test]
fn adapter_preserves_default_and_rejects_partial_or_unknown_override() {
    assert!(parse_override(&BTreeMap::new()).unwrap().is_none());
    let (_fixture, values) = fake_options();
    for key in KEYS {
        let mut partial = values.clone();
        partial.remove(key);
        assert!(parse_override(&partial).is_err());
    }
    let mut unknown = values;
    unknown.insert("NAC_DESKTOP_SCHEMA_UNKNOWN".into(), "x".into());
    assert!(parse_override(&unknown).is_err());
}
#[test]
fn adapter_rejects_digest_source_and_noncanonical_target_before_output() {
    let (fixture, values) = fake_options();
    let mut wrong = values.clone();
    wrong.insert(KEYS[1].into(), "0".repeat(64));
    assert!(Target::bind(parse_override(&wrong).unwrap()).is_err());
    let mut wrong = values.clone();
    let mut identity: Value = serde_json::from_str(&wrong[KEYS[2]]).unwrap();
    identity["source_revision"] = json!("a".repeat(40));
    wrong.insert(KEYS[2].into(), identity.to_string());
    assert!(Target::bind(parse_override(&wrong).unwrap()).is_err());
    let mut wrong = values.clone();
    wrong.insert(KEYS[0].into(), "relative/nac-web".into());
    assert!(Target::bind(parse_override(&wrong).unwrap()).is_err());
    let alias = fixture.path.join("alias");
    std::os::unix::fs::symlink(&values[KEYS[0]], &alias).unwrap();
    let mut wrong = values;
    wrong.insert(KEYS[0].into(), alias.to_str().unwrap().into());
    assert!(Target::bind(parse_override(&wrong).unwrap()).is_err());
    assert!(!fixture.path.join("observations").exists());
}
#[test]
fn adapter_requires_fresh_owned_external_output_and_creates_bounded_records() {
    let (fixture, values) = fake_options();
    let mut bad = values.clone();
    bad.insert(KEYS[3].into(), "relative-output".into());
    assert!(Target::bind(parse_override(&bad).unwrap()).is_err());
    let mut bad = values.clone();
    bad.insert(
        KEYS[3].into(),
        fixture.path.join("NAC.app/output").to_str().unwrap().into(),
    );
    assert!(Target::bind(parse_override(&bad).unwrap()).is_err());
    let target = Target::bind(parse_override(&values).unwrap()).unwrap();
    assert!(Target::bind(parse_override(&values).unwrap()).is_err());
    let output = target.output.as_ref().unwrap();
    output
        .write(
            "control",
            &json!({"observed":false,"scope":"pure unit data"}),
        )
        .unwrap();
    assert!(output.write("control", &json!({})).is_err());
    assert!(output
        .write("oversized", &json!({"data":"x".repeat(64*1024)}))
        .is_err());
    std::fs::set_permissions(&output.0, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(output.write("unsafe", &json!({})).is_err());
}

#[test]
fn adapter_rejects_output_alias_and_writable_parent_without_creating_evidence() {
    let (fixture, values) = fake_options();
    let alias = fixture.path.join("output-alias");
    std::os::unix::fs::symlink(fixture.path.join("absent"), &alias).unwrap();
    let mut bad = values.clone();
    bad.insert(KEYS[3].into(), alias.to_str().unwrap().into());
    assert!(Target::bind(parse_override(&bad).unwrap()).is_err());
    let writable = fixture.path.join("writable");
    std::fs::create_dir(&writable).unwrap();
    std::fs::set_permissions(&writable, std::fs::Permissions::from_mode(0o777)).unwrap();
    let output = writable.join("observations");
    let mut bad = values;
    bad.insert(KEYS[3].into(), output.to_str().unwrap().into());
    assert!(Target::bind(parse_override(&bad).unwrap()).is_err());
    assert!(!output.exists());
    assert!(!fixture.path.join("absent").exists());
}
