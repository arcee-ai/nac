use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{anyhow, Context, Result};
use semver::Version;
use serde::de::DeserializeOwned;
use serde::Deserialize;

const DEFAULT_REPO: &str = "arcee-ai/nac";
const DEFAULT_BRANCH: &str = "main";
const GITHUB_API_BASE: &str = "https://api.github.com";
const RAW_GITHUB_BASE: &str = "https://raw.githubusercontent.com";
const GITHUB_WEB_BASE: &str = "https://github.com";

#[derive(Debug, Clone)]
pub struct UpgradeRequest {
    pub install_dir: Option<PathBuf>,
    pub executable_path: Option<PathBuf>,
    pub package_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeTarget {
    pub current_version: String,
    pub tag: String,
    pub version: String,
    pub commit_sha: String,
    pub install_dir: PathBuf,
    pub asset_name: String,
    pub uninstall_url: String,
    pub install_url: String,
    pub asset_base_url: String,
}

#[derive(Debug, Clone)]
struct GithubConfig {
    repo: String,
    api_base: String,
    raw_base: String,
    release_base: String,
}

impl GithubConfig {
    fn from_env() -> Self {
        Self {
            repo: std::env::var("NAC_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string()),
            api_base: std::env::var("NAC_GITHUB_API_BASE_URL")
                .unwrap_or_else(|_| GITHUB_API_BASE.to_string()),
            raw_base: std::env::var("NAC_RAW_GITHUB_BASE_URL")
                .unwrap_or_else(|_| RAW_GITHUB_BASE.to_string()),
            release_base: std::env::var("NAC_RELEASE_BASE_URL")
                .unwrap_or_else(|_| GITHUB_WEB_BASE.to_string()),
        }
    }

    fn api_url(&self, path: &str) -> String {
        format!(
            "{}/repos/{}/{}",
            self.api_base.trim_end_matches('/'),
            self.repo.trim_matches('/'),
            path.trim_start_matches('/')
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GithubRef {
    object: GithubObject,
}

#[derive(Debug, Deserialize)]
struct GithubTag {
    object: GithubObject,
}

#[derive(Debug, Deserialize)]
struct GithubObject {
    #[serde(rename = "type")]
    kind: String,
    sha: String,
}

struct ReleaseCandidate<'a> {
    release: &'a GithubRelease,
    version: Version,
}

pub async fn run_upgrade(request: UpgradeRequest) -> Result<()> {
    let install_dir = upgrade_install_dir(request.install_dir, request.executable_path.as_deref())?;
    let uninstall_url = script_url("uninstall.sh");
    let install_url = script_url("install.sh");
    let client = reqwest::Client::new();

    println!("upgrading nac in {}", install_dir.display());
    println!("downloading {uninstall_url}");
    let uninstall_script =
        download_script(&client, &uninstall_url, &request.package_version).await?;
    println!("downloading {install_url}");
    let install_script = download_script(&client, &install_url, &request.package_version).await?;

    ensure_installer_downloader_available()?;
    run_script("uninstall.sh", &uninstall_script, &install_dir, &[])?;
    run_script("install.sh", &install_script, &install_dir, &[])?;

    Ok(())
}

pub async fn resolve_prerelease_upgrade(request: UpgradeRequest) -> Result<UpgradeTarget> {
    let current = Version::parse(&request.package_version).with_context(|| {
        format!(
            "invalid current nac-web version {}",
            request.package_version
        )
    })?;
    let install_dir = upgrade_install_dir(request.install_dir, request.executable_path.as_deref())?;
    let asset_name = platform_asset_name()?;
    let config = GithubConfig::from_env();
    let client = reqwest::Client::new();
    let releases = list_releases(&client, &config, &request.package_version).await?;
    let candidate = select_prerelease(&releases, &current, asset_name).ok_or_else(|| {
        anyhow!(
            "no active prerelease is available for nac-web {}",
            request.package_version
        )
    })?;
    let tag = candidate.release.tag_name.clone();
    let commit_sha = resolve_tag_sha(&client, &config, &tag, &request.package_version).await?;
    let raw_tag_base = format!(
        "{}/{}/{}",
        config.raw_base.trim_end_matches('/'),
        config.repo.trim_matches('/'),
        tag
    );
    let asset_base_url = format!(
        "{}/{}/releases/download/{}",
        config.release_base.trim_end_matches('/'),
        config.repo.trim_matches('/'),
        tag
    );

    Ok(UpgradeTarget {
        current_version: request.package_version,
        tag,
        version: candidate.version.to_string(),
        commit_sha,
        install_dir,
        asset_name: asset_name.to_string(),
        uninstall_url: format!("{raw_tag_base}/scripts/uninstall.sh"),
        install_url: format!("{raw_tag_base}/scripts/install.sh"),
        asset_base_url,
    })
}

pub async fn execute_prerelease_upgrade(target: UpgradeTarget) -> Result<()> {
    let client = reqwest::Client::new();
    println!("downloading {}", target.uninstall_url);
    let uninstall_script =
        download_script(&client, &target.uninstall_url, &target.current_version).await?;
    println!("downloading {}", target.install_url);
    let install_script =
        download_script(&client, &target.install_url, &target.current_version).await?;

    ensure_installer_downloader_available()?;
    run_script("uninstall.sh", &uninstall_script, &target.install_dir, &[])?;
    run_script(
        "install.sh",
        &install_script,
        &target.install_dir,
        &[
            ("NAC_BASE_URL", target.asset_base_url.as_str()),
            ("NAC_RELEASE_LABEL", target.tag.as_str()),
        ],
    )?;
    Ok(())
}

fn select_prerelease<'a>(
    releases: &'a [GithubRelease],
    current: &Version,
    asset_name: &str,
) -> Option<ReleaseCandidate<'a>> {
    let latest_stable = releases
        .iter()
        .filter(|release| !release.draft && !release.prerelease)
        .filter_map(|release| parse_stable_tag(&release.tag_name))
        .max();

    releases
        .iter()
        .filter(|release| !release.draft && release.prerelease)
        .filter(|release| release.assets.iter().any(|asset| asset.name == asset_name))
        .filter_map(|release| {
            let (base, version) = parse_rc_tag(&release.tag_name)?;
            if latest_stable.as_ref().is_some_and(|stable| base <= *stable) || version <= *current {
                return None;
            }
            Some(ReleaseCandidate { release, version })
        })
        .max_by(|left, right| left.version.cmp(&right.version))
}

fn parse_stable_tag(tag: &str) -> Option<Version> {
    let raw = tag.strip_prefix('v')?;
    let version = Version::parse(raw).ok()?;
    if !version.pre.is_empty() || !version.build.is_empty() || version.to_string() != raw {
        return None;
    }
    Some(version)
}

fn parse_rc_tag(tag: &str) -> Option<(Version, Version)> {
    let raw = tag.strip_prefix('v')?;
    let (base_raw, number_raw) = raw.split_once("-rc.")?;
    if number_raw.is_empty()
        || (number_raw.len() > 1 && number_raw.starts_with('0'))
        || !number_raw.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let number: u64 = number_raw.parse().ok()?;
    if number == 0 {
        return None;
    }
    let base = Version::parse(base_raw).ok()?;
    if !base.pre.is_empty() || !base.build.is_empty() || base.to_string() != base_raw {
        return None;
    }
    let version = Version::parse(raw).ok()?;
    if version.to_string() != raw {
        return None;
    }
    Some((base, version))
}

async fn list_releases(
    client: &reqwest::Client,
    config: &GithubConfig,
    package_version: &str,
) -> Result<Vec<GithubRelease>> {
    let mut releases = Vec::new();
    let mut next = Some(config.api_url("releases?per_page=100&page=1"));
    while let Some(url) = next {
        let response = send(client, &url, package_version).await?;
        next = next_link(response.headers().get(reqwest::header::LINK));
        let mut page: Vec<GithubRelease> = response
            .json()
            .await
            .with_context(|| format!("failed to decode GitHub releases response from {url}"))?;
        releases.append(&mut page);
    }
    Ok(releases)
}

fn next_link(header: Option<&reqwest::header::HeaderValue>) -> Option<String> {
    let header = header?.to_str().ok()?;
    header.split(',').find_map(|entry| {
        let entry = entry.trim();
        let (url, attributes) = entry.split_once('>')?;
        if attributes
            .split(';')
            .any(|attribute| attribute.trim() == "rel=\"next\"")
        {
            Some(url.strip_prefix('<')?.to_string())
        } else {
            None
        }
    })
}

async fn resolve_tag_sha(
    client: &reqwest::Client,
    config: &GithubConfig,
    tag: &str,
    package_version: &str,
) -> Result<String> {
    let mut object: GithubObject = get_json(
        client,
        &config.api_url(&format!("git/ref/tags/{tag}")),
        package_version,
    )
    .await
    .map(|reference: GithubRef| reference.object)?;
    let mut seen = std::collections::HashSet::new();
    for _ in 0..16 {
        match object.kind.as_str() {
            "commit" => return full_commit_sha(&object.sha, tag),
            "tag" => {
                if !seen.insert(object.sha.clone()) {
                    return Err(anyhow!("tag {tag} contains an annotated-tag cycle"));
                }
                object = get_json(
                    client,
                    &config.api_url(&format!("git/tags/{}", object.sha)),
                    package_version,
                )
                .await
                .map(|tag: GithubTag| tag.object)?;
            }
            kind => return Err(anyhow!("tag {tag} points to unsupported Git object {kind}")),
        }
    }
    Err(anyhow!("tag {tag} annotated-tag chain is too deep"))
}

fn full_commit_sha(sha: &str, tag: &str) -> Result<String> {
    if sha.len() != 40 || !sha.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(anyhow!("tag {tag} did not resolve to a full commit SHA"));
    }
    Ok(sha.to_ascii_lowercase())
}

async fn get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    package_version: &str,
) -> Result<T> {
    send(client, url, package_version)
        .await?
        .json()
        .await
        .with_context(|| format!("failed to decode GitHub response from {url}"))
}

async fn send(
    client: &reqwest::Client,
    url: &str,
    package_version: &str,
) -> Result<reqwest::Response> {
    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", format!("nac/{package_version}"))
        .send()
        .await
        .with_context(|| format!("failed to request {url}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read error response from {url}"))?;
    Err(anyhow!(
        "GitHub request failed for {}: HTTP {}: {}",
        url,
        status.as_u16(),
        body.chars().take(500).collect::<String>()
    ))
}

fn platform_asset_name() -> Result<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok("nac-aarch64-apple-darwin.tar.gz")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok("nac-x86_64-unknown-linux-musl.tar.gz")
    } else {
        Err(anyhow!(
            "prerelease upgrades are not available for {}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ))
    }
}

fn upgrade_install_dir(
    override_dir: Option<PathBuf>,
    executable_path: Option<&Path>,
) -> Result<PathBuf> {
    if let Some(dir) = override_dir {
        return Ok(dir);
    }
    if let Some(dir) = std::env::var_os("INSTALL_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let executable_path = executable_path.ok_or_else(|| {
        anyhow!("nac executable path was not provided and install dir was not configured")
    })?;
    executable_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow!("nac executable does not have a parent directory"))
}

fn script_url(script: &str) -> String {
    if let Ok(base_url) = std::env::var("NAC_SCRIPT_BASE_URL") {
        return format!("{}/{}", base_url.trim_end_matches('/'), script);
    }
    let repo = std::env::var("NAC_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
    let branch = std::env::var("NAC_SCRIPT_BRANCH").unwrap_or_else(|_| DEFAULT_BRANCH.to_string());
    format!(
        "{}/{}/{}/scripts/{}",
        RAW_GITHUB_BASE,
        repo.trim_matches('/'),
        branch.trim_matches('/'),
        script
    )
}

async fn download_script(
    client: &reqwest::Client,
    url: &str,
    package_version: &str,
) -> Result<String> {
    let response = client
        .get(url)
        .header("User-Agent", format!("nac/{package_version}"))
        .send()
        .await
        .with_context(|| format!("failed to download {url}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read {url}"))?;
    if !status.is_success() {
        return Err(anyhow!(
            "failed to download {}: HTTP {}: {}",
            url,
            status.as_u16(),
            body.chars().take(500).collect::<String>()
        ));
    }
    Ok(body)
}

fn run_script(
    name: &str,
    script: &str,
    install_dir: &Path,
    environment: &[(&str, &str)],
) -> Result<()> {
    println!("running {name}");
    let mut command = Command::new("sh");
    command
        .arg("-s")
        .env("INSTALL_DIR", install_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    for (key, value) in environment {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {name}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("failed to open stdin for {name}"))?;
        stdin
            .write_all(script.as_bytes())
            .with_context(|| format!("failed to write {name} to shell"))?;
    }

    let status = child
        .wait()
        .with_context(|| format!("failed to wait for {name}"))?;
    if !status.success() {
        return Err(anyhow!("{name} failed with status {status}"));
    }
    Ok(())
}

fn ensure_installer_downloader_available() -> Result<()> {
    if command_exists("curl") || command_exists("wget") {
        return Ok(());
    }
    Err(anyhow!(
        "nac upgrade needs curl or wget because scripts/install.sh uses one to fetch the release archive"
    ))
}

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg("command -v \"$1\" >/dev/null 2>&1")
        .arg("sh")
        .arg(name)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn release(tag: &str, draft: bool, prerelease: bool, assets: &[&str]) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            draft,
            prerelease,
            assets: assets
                .iter()
                .map(|name| GithubAsset {
                    name: (*name).to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn selects_newest_active_canonical_rc_numerically() {
        let asset = platform_asset_name().unwrap();
        let releases = vec![
            release("v0.1.1", false, false, &[]),
            release("v0.1.2-rc.2", false, true, &[asset]),
            release("v0.1.2-rc.10", false, true, &[asset]),
            release("v0.1.2-beta.20", false, true, &[asset]),
            release("v0.1.2-rc.0", false, true, &[asset]),
            release("v0.1.2-rc.01", false, true, &[asset]),
            release("v0.1.3-rc.1", true, true, &[asset]),
            release("v0.1.4-rc.1", false, false, &[asset]),
            release("v0.1.5-rc.1", false, true, &["wrong.tar.gz"]),
        ];
        let selected =
            select_prerelease(&releases, &Version::parse("0.1.2-rc.2").unwrap(), asset).unwrap();
        assert_eq!(selected.release.tag_name, "v0.1.2-rc.10");
    }

    #[test]
    fn stable_release_closes_its_prerelease_train() {
        let asset = platform_asset_name().unwrap();
        let releases = vec![
            release("v0.1.2", false, false, &[]),
            release("v0.1.2-rc.10", false, true, &[asset]),
        ];
        assert!(select_prerelease(&releases, &Version::parse("0.1.1").unwrap(), asset).is_none());
    }

    #[test]
    fn exact_tag_parsers_reject_noncanonical_versions() {
        for tag in [
            "0.1.2-rc.1",
            "v0.1.2-beta.1",
            "v0.1.2-rc.0",
            "v0.1.2-rc.01",
            "v0.01.2-rc.1",
            "v0.1.2-rc.1+build",
        ] {
            assert!(parse_rc_tag(tag).is_none(), "accepted {tag}");
        }
        assert_eq!(
            parse_rc_tag("v0.1.2-rc.10").unwrap().1,
            Version::parse("0.1.2-rc.10").unwrap()
        );
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn script_url_uses_defaults_and_env_overrides() {
        let _guard = TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let original_repo = std::env::var_os("NAC_REPO");
        let original_branch = std::env::var_os("NAC_SCRIPT_BRANCH");
        let original_base = std::env::var_os("NAC_SCRIPT_BASE_URL");
        unsafe {
            std::env::remove_var("NAC_REPO");
            std::env::remove_var("NAC_SCRIPT_BRANCH");
            std::env::remove_var("NAC_SCRIPT_BASE_URL");
        }

        assert_eq!(
            script_url("install.sh"),
            "https://raw.githubusercontent.com/arcee-ai/nac/main/scripts/install.sh"
        );

        unsafe {
            std::env::set_var("NAC_REPO", "owner/repo");
            std::env::set_var("NAC_SCRIPT_BRANCH", "dev");
        }
        assert_eq!(
            script_url("uninstall.sh"),
            "https://raw.githubusercontent.com/owner/repo/dev/scripts/uninstall.sh"
        );

        unsafe {
            std::env::set_var("NAC_SCRIPT_BASE_URL", "https://example.com/scripts/");
        }
        assert_eq!(
            script_url("install.sh"),
            "https://example.com/scripts/install.sh"
        );

        restore_env("NAC_REPO", original_repo);
        restore_env("NAC_SCRIPT_BRANCH", original_branch);
        restore_env("NAC_SCRIPT_BASE_URL", original_base);
    }

    struct Fixture {
        base: String,
        requests: Arc<Mutex<Vec<String>>>,
        responses: Arc<Mutex<HashMap<String, (u16, Vec<(String, String)>, String)>>>,
    }

    impl Fixture {
        async fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let requests = Arc::new(Mutex::new(Vec::new()));
            let responses = Arc::new(Mutex::new(HashMap::new()));
            let request_log = Arc::clone(&requests);
            let response_map = Arc::clone(&responses);
            tokio::spawn(async move {
                loop {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        break;
                    };
                    let request_log = Arc::clone(&request_log);
                    let response_map = Arc::clone(&response_map);
                    tokio::spawn(async move {
                        let mut buffer = vec![0; 16 * 1024];
                        let size = stream.read(&mut buffer).await.unwrap();
                        let request = String::from_utf8_lossy(&buffer[..size]);
                        let path = request
                            .lines()
                            .next()
                            .and_then(|line| line.split_whitespace().nth(1))
                            .unwrap()
                            .to_string();
                        request_log.lock().push(path.clone());
                        let (status, headers, body) = response_map
                            .lock()
                            .get(&path)
                            .cloned()
                            .unwrap_or((404, Vec::new(), "not found".to_string()));
                        let reason = if status == 200 { "OK" } else { "Error" };
                        let mut response = format!(
                            "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n",
                            body.len()
                        );
                        for (name, value) in headers {
                            response.push_str(&format!("{name}: {value}\r\n"));
                        }
                        response.push_str("\r\n");
                        response.push_str(&body);
                        stream.write_all(response.as_bytes()).await.unwrap();
                    });
                }
            });
            Self {
                base,
                requests,
                responses,
            }
        }

        fn respond(&self, path: impl Into<String>, body: impl Into<String>) {
            self.responses
                .lock()
                .insert(path.into(), (200, Vec::new(), body.into()));
        }

        fn respond_with_headers(
            &self,
            path: impl Into<String>,
            body: impl Into<String>,
            headers: Vec<(String, String)>,
        ) {
            self.responses
                .lock()
                .insert(path.into(), (200, headers, body.into()));
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn resolves_paginated_candidate_and_peels_annotated_tag_without_fetching_scripts() {
        let _guard = TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let fixture = Fixture::start().await;
        let asset = platform_asset_name().unwrap();
        let page_two = format!("{}/page-two", fixture.base);
        fixture.respond_with_headers(
            "/repos/test/repo/releases?per_page=100&page=1",
            format!(
                r#"[{{"tag_name":"v0.1.1","draft":false,"prerelease":false,"assets":[]}},{{"tag_name":"v0.1.2-rc.2","draft":false,"prerelease":true,"assets":[{{"name":"{asset}"}}]}}]"#
            ),
            vec![("Link".to_string(), format!("<{page_two}>; rel=\"next\""))],
        );
        fixture.respond(
            "/page-two",
            format!(
                r#"[{{"tag_name":"v0.1.2-rc.10","draft":false,"prerelease":true,"assets":[{{"name":"{asset}"}}]}},{{"tag_name":"v0.1.2-beta.20","draft":false,"prerelease":true,"assets":[{{"name":"{asset}"}}]}}]"#
            ),
        );
        fixture.respond(
            "/repos/test/repo/git/ref/tags/v0.1.2-rc.10",
            format!(
                r#"{{"object":{{"type":"tag","sha":"{}"}}}}"#,
                "a".repeat(40)
            ),
        );
        fixture.respond(
            format!("/repos/test/repo/git/tags/{}", "a".repeat(40)),
            format!(
                r#"{{"object":{{"type":"commit","sha":"{}"}}}}"#,
                "b".repeat(40)
            ),
        );

        let names = [
            "NAC_REPO",
            "NAC_GITHUB_API_BASE_URL",
            "NAC_RAW_GITHUB_BASE_URL",
            "NAC_RELEASE_BASE_URL",
        ];
        let originals: Vec<_> = names.iter().map(|name| std::env::var_os(name)).collect();
        unsafe {
            std::env::set_var("NAC_REPO", "test/repo");
            std::env::set_var("NAC_GITHUB_API_BASE_URL", &fixture.base);
            std::env::set_var("NAC_RAW_GITHUB_BASE_URL", format!("{}/raw", fixture.base));
            std::env::set_var("NAC_RELEASE_BASE_URL", format!("{}/web", fixture.base));
        }

        let target = resolve_prerelease_upgrade(UpgradeRequest {
            install_dir: Some(PathBuf::from("/tmp/nac")),
            executable_path: None,
            package_version: "0.1.2-rc.2".to_string(),
        })
        .await
        .unwrap();

        assert_eq!(target.tag, "v0.1.2-rc.10");
        assert_eq!(target.version, "0.1.2-rc.10");
        assert_eq!(target.commit_sha, "b".repeat(40));
        assert_eq!(
            target.install_url,
            format!(
                "{}/raw/test/repo/v0.1.2-rc.10/scripts/install.sh",
                fixture.base
            )
        );
        assert_eq!(
            target.asset_base_url,
            format!(
                "{}/web/test/repo/releases/download/v0.1.2-rc.10",
                fixture.base
            )
        );
        assert!(fixture
            .requests
            .lock()
            .iter()
            .all(|request| !request.contains("scripts/")));

        for (name, original) in names.iter().zip(originals) {
            restore_env(name, original);
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn api_error_and_no_candidate_stop_before_script_download() {
        let _guard = TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let fixture = Fixture::start().await;
        fixture.responses.lock().insert(
            "/repos/test/repo/releases?per_page=100&page=1".to_string(),
            (403, Vec::new(), "rate limited".to_string()),
        );
        let original_repo = std::env::var_os("NAC_REPO");
        let original_api = std::env::var_os("NAC_GITHUB_API_BASE_URL");
        unsafe {
            std::env::set_var("NAC_REPO", "test/repo");
            std::env::set_var("NAC_GITHUB_API_BASE_URL", &fixture.base);
        }
        let error = resolve_prerelease_upgrade(UpgradeRequest {
            install_dir: Some(PathBuf::from("/tmp/nac")),
            executable_path: None,
            package_version: "0.1.1".to_string(),
        })
        .await
        .unwrap_err()
        .to_string();
        assert!(error.contains("HTTP 403"), "{error}");
        assert_eq!(fixture.requests.lock().len(), 1);
        restore_env("NAC_REPO", original_repo);
        restore_env("NAC_GITHUB_API_BASE_URL", original_api);
    }
}
