//! Opt-in, bounded development provider qualification. Run the ignored test
//! `live_provider_probe` with ALL157_PROBE_CONFIG pointing to a private JSON file
//! and ALL157_PROBE_PHASE = discover | grant_a | grant_b | refresh_a | refresh_b.
//! No credentials, consent URLs, user codes or provider bodies reach test output.
//! The coordinator reads prompt-a/b.json privately to perform approved consent.
//! These fixtures do not establish resource authorization or runtime durability.

use super::*;
use nac_credential_store::{
    read_auth_string_from_path, try_acquire_credential_lock, write_auth_string_to_path,
};
use serde::Serialize;
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

type ProbeResult<T> = std::result::Result<T, &'static str>;
const MAX_FIXTURE_BYTES: u64 = 64 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProbeConfig {
    issuer: String,
    discovery_url: String,
    client_id: String,
    scopes: Vec<String>,
    endpoint_origins: Vec<String>,
    verification_origins: Vec<String>,
    max_poll_secs: u64,
}

impl ProbeConfig {
    fn transport(&self) -> ProbeResult<ClerkOAuthConfig> {
        if !(1..=600).contains(&self.max_poll_secs) {
            return Err("probe polling bound must be 1..600 seconds");
        }
        // Test builds accept loopback HTTP for synthetic fixtures. A live probe
        // still requires HTTPS for every configured trust input.
        for raw in std::iter::once(&self.issuer)
            .chain(std::iter::once(&self.discovery_url))
            .chain(self.endpoint_origins.iter())
            .chain(self.verification_origins.iter())
        {
            let url = Url::parse(raw).map_err(|_| "invalid probe URL")?;
            if url.scheme() != "https" {
                return Err("live provider probes require HTTPS");
            }
        }
        let config = ClerkOAuthConfig {
            issuer: self.issuer.clone(),
            discovery_url: self.discovery_url.clone(),
            client_id: self.client_id.clone(),
            scopes: self.scopes.clone(),
            endpoint_origins: self.endpoint_origins.clone(),
            verification_origins: self.verification_origins.clone(),
        };
        validate_config(&config).map_err(|_| "invalid probe transport configuration")?;
        Ok(config)
    }
}

#[derive(Clone, Copy)]
enum Phase {
    Discover,
    Grant(char),
    Refresh(char),
}

impl Phase {
    fn parse(raw: &str) -> ProbeResult<Self> {
        match raw {
            "discover" => Ok(Self::Discover),
            "grant_a" => Ok(Self::Grant('a')),
            "grant_b" => Ok(Self::Grant('b')),
            "refresh_a" => Ok(Self::Refresh('a')),
            "refresh_b" => Ok(Self::Refresh('b')),
            _ => Err("unsupported probe phase"),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    issuer: String,
    client_id: String,
    scopes: Vec<String>,
    state: String,
    access_token: String,
    refresh_token: String,
    expires_in_secs: u64,
    refresh_count: u32,
}

impl Record {
    fn bind(&self, config: &ProbeConfig) -> ProbeResult<()> {
        if self.issuer != config.issuer
            || self.client_id != config.client_id
            || scope_set(&self.scopes).ok() != scope_set(&config.scopes).ok()
            || self.state != "ready"
            || !valid_secret(&self.access_token)
            || !valid_secret(&self.refresh_token)
            || self.expires_in_secs == 0
        {
            return Err("fixture binding invalid or previous exchange uncertain");
        }
        Ok(())
    }
}

struct PrivateFiles {
    directory: PathBuf,
}

impl PrivateFiles {
    fn open(config_path: &Path) -> ProbeResult<Self> {
        let directory = config_path
            .parent()
            .ok_or("private config parent missing")?;
        if config_path.file_name() != Some(std::ffi::OsStr::new("config.json"))
            || !config_path.is_absolute()
            || fs::canonicalize(directory).map_err(|_| "private directory missing")? != directory
        {
            return Err("private config requires an absolute path without directory aliases");
        }
        let metadata = fs::symlink_metadata(directory).map_err(|_| "private directory missing")?;
        // SAFETY: geteuid has no arguments and only reads the current process UID.
        let uid = unsafe { libc::geteuid() };
        if !metadata.is_dir()
            || metadata.uid() != uid
            || metadata.permissions().mode() & 0o777 != 0o700
        {
            return Err("probe directory must be current-user owned and mode 0700");
        }
        let files = Self {
            directory: directory.to_owned(),
        };
        files.check_file(config_path, false)?;
        Ok(files)
    }

    fn path(&self, kind: &str, slot: char) -> PathBuf {
        self.directory.join(format!("{kind}-{slot}.json"))
    }

    fn check_file(&self, path: &Path, missing_ok: bool) -> ProbeResult<()> {
        if path.parent() != Some(self.directory.as_path()) {
            return Err("fixture must be inside the private probe directory");
        }
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if missing_ok && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(())
            }
            Err(_) => return Err("private fixture missing or inaccessible"),
        };
        // SAFETY: geteuid has no arguments and only reads the current process UID.
        let uid = unsafe { libc::geteuid() };
        if !metadata.is_file()
            || metadata.uid() != uid
            || metadata.permissions().mode() & 0o777 != 0o600
            || metadata.len() > MAX_FIXTURE_BYTES
        {
            return Err(
                "fixture must be a current-user owned regular mode 0600 file within size bound",
            );
        }
        Ok(())
    }

    fn read<T: serde::de::DeserializeOwned>(&self, path: &Path) -> ProbeResult<T> {
        self.check_file(path, false)?;
        let raw = read_auth_string_from_path(path)
            .map_err(|_| "private fixture read failed")?
            .ok_or("private fixture missing")?;
        serde_json::from_str(&raw).map_err(|_| "invalid private fixture JSON")
    }

    fn write<T: Serialize>(&self, path: &Path, value: &T) -> ProbeResult<()> {
        self.check_file(path, true)?;
        let raw = serde_json::to_string(value).map_err(|_| "fixture encoding failed")?;
        if raw.len() as u64 > MAX_FIXTURE_BYTES {
            return Err("encoded private fixture exceeds size bound");
        }
        write_auth_string_to_path(path, &raw).map_err(|_| "atomic private fixture write failed")
    }
}

async fn run(config_path: &Path, phase: Phase) -> ProbeResult<&'static str> {
    let files = PrivateFiles::open(config_path)?;
    let config: ProbeConfig = files.read(config_path)?;
    let transport = config.transport()?;
    let lock_path = files.directory.join("probe.lock");
    files.check_file(&lock_path, true)?;
    let _lock = try_acquire_credential_lock(&lock_path)
        .map_err(|_| "private probe lock failed")?
        .ok_or("another probe is already running")?;
    let client = ClerkOAuthClient::discover(transport)
        .await
        .map_err(provider_error)?;
    match phase {
        Phase::Discover => Ok("trusted advertised device/refresh discovery accepted"),
        Phase::Grant(slot) => {
            let record_path = files.path("tokens", slot);
            // Reserve before contacting the provider. A previous attempt cannot
            // silently become another grant under the same fixture label.
            if fs::symlink_metadata(&record_path).is_ok() {
                return Err(
                    "grant fixture already reserved; use a fresh approved fixture directory",
                );
            }
            files.write(
                &record_path,
                &serde_json::json!({"state":"authorization_attempted"}),
            )?;
            let login = client.begin().await.map_err(provider_error)?;
            let prompt = login.prompt();
            files.write(
                &files.path("prompt", slot),
                &serde_json::json!({
                    "verification_uri": prompt.verification_uri,
                    "verification_uri_complete": prompt.verification_uri_complete,
                    "user_code": prompt.user_code,
                    "expires_in_secs": prompt.expires_in_secs
                }),
            )?;
            let tokens =
                tokio::time::timeout(Duration::from_secs(config.max_poll_secs), login.finish())
                    .await
                    .map_err(|_| "bounded consent wait expired; transaction will not be resumed")?
                    .map_err(provider_error)?;
            let refresh_token = tokens
                .refresh_token
                .ok_or("initial grant omitted refresh token")?;
            let record = Record {
                issuer: config.issuer.clone(),
                client_id: config.client_id.clone(),
                scopes: tokens.scopes,
                state: "ready".into(),
                access_token: tokens.access_token,
                refresh_token,
                expires_in_secs: tokens.expires_in_secs,
                refresh_count: 0,
            };
            record.bind(&config)?;
            files.write(&record_path, &record)?;
            Ok("device exchange accepted; opaque access/refresh fixture atomically saved")
        }
        Phase::Refresh(slot) => {
            let path = files.path("tokens", slot);
            let mut record: Record = files.read(&path)?;
            record.bind(&config)?;
            let count = record
                .refresh_count
                .checked_add(1)
                .ok_or("refresh count exhausted")?;
            // Persist an uncertainty fence before the single remote exchange.
            // An outage or crash prevents a later probe from replaying rotation.
            record.state = "refresh_attempted".into();
            files.write(&path, &record)?;
            let tokens = client
                .refresh(&record.refresh_token)
                .await
                .map_err(provider_error)?;
            record.access_token = tokens.access_token;
            if let Some(rotated) = tokens.refresh_token {
                record.refresh_token = rotated;
            }
            record.expires_in_secs = tokens.expires_in_secs;
            record.scopes = tokens.scopes;
            record.refresh_count = count;
            record.state = "ready".into();
            record.bind(&config)?;
            files.write(&path, &record)?;
            Ok("single refresh exchange accepted; opaque rotation fixture atomically saved")
        }
    }
}

fn provider_error(error: OAuthError) -> &'static str {
    match error {
        OAuthError::Configuration => "provider configuration rejected",
        OAuthError::Discovery => "provider discovery rejected",
        OAuthError::InvalidResponse => "provider response rejected",
        OAuthError::Unavailable => "provider unavailable; no exchange replayed",
        OAuthError::Denied => "provider consent denied",
        OAuthError::Expired => "provider device transaction expired",
        OAuthError::ReauthorizationRequired => "provider reauthorization required",
        OAuthError::Rejected => "provider request rejected",
    }
}

#[tokio::test]
#[ignore = "requires coordinator-approved private development config and staff consent"]
async fn live_provider_probe() {
    let result = async {
        let path = std::env::var_os("ALL157_PROBE_CONFIG").ok_or("private config path missing")?;
        let phase = std::env::var("ALL157_PROBE_PHASE").map_err(|_| "probe phase missing")?;
        run(Path::new(&path), Phase::parse(&phase)?).await
    }
    .await;
    match result {
        Ok(receipt) => {
            println!("ALL157 transport probe: {receipt}; resource/grant/org verification pending")
        }
        Err(error) => panic!("ALL157 transport probe failed: {error}"),
    }
}

struct FixtureDirectory(PathBuf);

impl FixtureDirectory {
    fn new() -> Self {
        use std::os::unix::fs::DirBuilderExt;
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = root.join(format!(
            "all157-probe-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
        Self(path)
    }

    fn files(&self) -> PrivateFiles {
        PrivateFiles {
            directory: self.0.clone(),
        }
    }

    fn config_path(&self) -> PathBuf {
        self.0.join("config.json")
    }
}

impl Drop for FixtureDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn config() -> ProbeConfig {
    ProbeConfig {
        issuer: "https://synthetic.example".into(),
        discovery_url: "https://synthetic.example/metadata".into(),
        client_id: "synthetic-public-client".into(),
        scopes: vec!["offline_access".into(), "user:org:read".into()],
        endpoint_origins: vec!["https://synthetic.example".into()],
        verification_origins: vec!["https://synthetic.example".into()],
        max_poll_secs: 30,
    }
}

#[test]
fn probe_requires_explicit_https_and_bounded_phase() {
    assert!(Phase::parse("refresh_c").is_err());
    let mut candidate = config();
    candidate.max_poll_secs = 0;
    assert!(candidate.transport().is_err());
    candidate.max_poll_secs = 601;
    assert!(candidate.transport().is_err());
    candidate.max_poll_secs = 30;
    assert!(candidate.transport().is_ok());
    candidate.verification_origins = vec!["http://127.0.0.1".into()];
    assert!(candidate.transport().is_err());
}

#[test]
fn probe_private_files_reject_aliases_exposure_and_oversized_input() {
    use std::os::unix::fs::symlink;
    let directory = FixtureDirectory::new();
    let files = directory.files();
    let path = directory.config_path();
    files
        .write(&path, &serde_json::json!({"synthetic":"secret"}))
        .unwrap();
    assert!(PrivateFiles::open(&path).is_ok());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    assert!(PrivateFiles::open(&path).is_err());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let alias = directory.0.join("alias.json");
    symlink(&path, &alias).unwrap();
    assert!(files.read::<serde_json::Value>(&alias).is_err());
    assert!(files.write(&alias, &serde_json::json!({})).is_err());
    let alias_parent = directory.0.join("alias-directory");
    symlink(&directory.0, &alias_parent).unwrap();
    assert!(PrivateFiles::open(&alias_parent.join("config.json")).is_err());
    fs::write(&path, vec![b'x'; MAX_FIXTURE_BYTES as usize + 1]).unwrap();
    assert!(files.read::<serde_json::Value>(&path).is_err());
    fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o750)).unwrap();
    assert!(PrivateFiles::open(&path).is_err());
}

#[test]
fn uncertain_refresh_survives_fixture_reload_and_binding_cannot_be_changed() {
    let directory = FixtureDirectory::new();
    let files = directory.files();
    let path = files.path("tokens", 'a');
    let config = config();
    let mut record = Record {
        issuer: config.issuer.clone(),
        client_id: config.client_id.clone(),
        scopes: config.scopes.clone(),
        state: "ready".into(),
        access_token: "synthetic-access-secret".into(),
        refresh_token: "synthetic-refresh-secret".into(),
        expires_in_secs: 60,
        refresh_count: 0,
    };
    record.bind(&config).unwrap();
    record.state = "refresh_attempted".into();
    files.write(&path, &record).unwrap();
    let recovered: Record = files.read(&path).unwrap();
    assert_eq!(
        recovered.bind(&config),
        Err("fixture binding invalid or previous exchange uncertain")
    );
    record.state = "ready".into();
    record.client_id = "different-client".into();
    assert!(record.bind(&config).is_err());
    record.client_id = config.client_id.clone();
    record.scopes.push("extra-scope".into());
    assert!(record.bind(&config).is_err());
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
