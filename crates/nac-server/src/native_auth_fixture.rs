//! Explicitly compiled, disposable local-device qualification. Never a runtime
//! provider override in an ordinary executable, or permission authority.
#[cfg(not(unix))]
compile_error!("native-auth-fixture requires Unix profile ownership and desktop launch");
use std::{
    io::Read,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use anyhow::{bail, Result};
use axum::{
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use serde::Deserialize;

const ROOT_ENV: &str = "NAC_NATIVE_AUTH_FIXTURE_ROOT";
const ORIGIN_ENV: &str = "NAC_NATIVE_AUTH_FIXTURE_ORIGIN";
const ROOT_PREFIX: &str = "nac-native-auth-fixture-";
const SENTINEL: &str = ".native-auth-fixture-owner.json";
static ADMISSION: OnceLock<Admission> = OnceLock::new();

#[derive(Debug, PartialEq, Eq)]
struct Admission {
    root: PathBuf,
    origin: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    version: u32,
    source_revision: String,
    run: uuid::Uuid,
}

/// Configuration preflight legitimately has no inherited channel. Validate its
/// exact disposable inputs before the normal configuration owner can do work.
pub fn admit_configuration(directory: &Path, store: Option<&Path>) -> Result<()> {
    let admission = validate_profile(directory, store)?;
    if let Some(current) = ADMISSION.get() {
        if current != &admission {
            bail!("native auth fixture admission changed");
        }
    } else if ADMISSION.set(admission).is_err() {
        bail!("native auth fixture admission already initialized");
    }
    Ok(())
}

pub fn admit_serving(
    directory: Option<&Path>,
    store: Option<&Path>,
    bind: SocketAddr,
    desktop: bool,
    managed_config: bool,
    allow_remote: bool,
) -> Result<()> {
    if !desktop
        || bind.ip() != std::net::Ipv4Addr::LOCALHOST
        || bind.port() != 0
        || managed_config
        || allow_remote
    {
        bail!("native auth fixture requires an owned ephemeral desktop launch");
    }
    admit_configuration(
        directory.ok_or_else(|| anyhow::anyhow!("native auth fixture requires its workspace"))?,
        store,
    )
}

pub(crate) fn service_origin() -> Option<&'static str> {
    ADMISSION.get().map(|value| value.origin.as_str())
}

fn origin(value: &str) -> Result<String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| anyhow::anyhow!("invalid native auth fixture service"))?;
    if value.len() > 256
        || parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || parsed.port().is_none_or(|port| port == 0)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        bail!("native auth fixture service must be an exact ephemeral IPv4 loopback origin");
    }
    let canonical = parsed.origin().ascii_serialization();
    if value.trim_end_matches('/') != canonical {
        bail!("native auth fixture service must use its exact literal origin");
    }
    Ok(canonical)
}

#[cfg(unix)]
fn owned_directory(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path)?;
    // SAFETY: geteuid has no preconditions or side effects.
    let current_uid = unsafe { libc::geteuid() };
    if !metadata.file_type().is_dir()
        || metadata.uid() != current_uid
        || metadata.mode() & 0o777 != mode
        || path.canonicalize()? != path
    {
        bail!("native auth fixture directory ownership is invalid");
    }
    Ok(())
}

#[cfg(unix)]
fn validate_profile(directory: &Path, store: Option<&Path>) -> Result<Admission> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let root = PathBuf::from(
        std::env::var_os(ROOT_ENV)
            .ok_or_else(|| anyhow::anyhow!("native auth fixture root missing"))?,
    );
    let temporary = std::env::temp_dir().canonicalize()?;
    if !root.is_absolute() || root.parent() != Some(temporary.as_path()) {
        bail!("native auth fixture requires an owned temporary root");
    }
    owned_directory(&root, 0o700)?;
    let run = root
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(ROOT_PREFIX))
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .ok_or_else(|| anyhow::anyhow!("invalid native auth fixture root"))?;
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root.join(SENTINEL))?;
    let metadata = file.metadata()?;
    // SAFETY: geteuid has no preconditions or side effects.
    let current_uid = unsafe { libc::geteuid() };
    if !metadata.file_type().is_file()
        || metadata.uid() != current_uid
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() > 2048
    {
        bail!("invalid native auth fixture owner record");
    }
    let mut data = Vec::new();
    file.by_ref().take(2049).read_to_end(&mut data)?;
    let owner: Owner = serde_json::from_slice(&data)
        .map_err(|_| anyhow::anyhow!("invalid native auth fixture owner record"))?;
    if owner.version != 1
        || owner.source_revision != crate::build_identity::current().source_revision
        || owner.run != run
    {
        bail!("native auth fixture owner does not match this source/run");
    }
    for (variable, child) in [
        ("HOME", "home"),
        ("NAC_HOME", "nac-home"),
        ("XDG_CONFIG_HOME", "xdg"),
    ] {
        let selected = root.join(child);
        owned_directory(&selected, 0o700)?;
        if std::env::var_os(variable).as_deref() != Some(selected.as_os_str()) {
            bail!("native auth fixture environment is not isolated");
        }
    }
    owned_directory(&root.join("workspace"), 0o700)?;
    if directory != root.join("workspace") || store != Some(root.join("store.db").as_path()) {
        bail!("native auth fixture workspace/store is not explicit");
    }
    for name in [
        "NAC_MANAGED_CONFIG",
        "NAC_ALLOWED_HOSTS",
        "NAC_ALLOWED_ORIGINS",
        "ARCEE_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "EXA_API_KEY",
        "DEEPSEEK_API_KEY",
        "FIREWORKS_API_KEY",
        "TOGETHER_API_KEY",
        "NAC_LIBRARY_EXA_API_KEY",
    ] {
        if std::env::var_os(name).is_some() {
            bail!("native auth fixture inherited forbidden configuration");
        }
    }
    for leaf in [
        root.join("store.db"),
        root.join("nac-home/config.toml"),
        root.join("nac-home/arcee_auth.json"),
    ] {
        match std::fs::symlink_metadata(leaf) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                bail!("native auth fixture leaf is not a regular file")
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    let origin = origin(
        &std::env::var(ORIGIN_ENV)
            .map_err(|_| anyhow::anyhow!("native auth fixture service missing"))?,
    )?;
    Ok(Admission { root, origin })
}

#[cfg(not(unix))]
fn validate_profile(_: &Path, _: Option<&Path>) -> Result<Admission> {
    bail!("native auth fixture requires Unix profile ownership");
}

fn login_handle(path: &str) -> bool {
    path.strip_prefix("/auth/arcee/login/")
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|value| value.is_ascii_hexdigit()))
}

fn allowed(method: &Method, path: &str) -> bool {
    if matches!(*method, Method::GET | Method::HEAD) {
        return matches!(
            path,
            "/" | "/index.html"
                | "/ui-config"
                | "/health"
                | "/healthz"
                | "/readyz"
                | "/store"
                | "/auth"
                | "/models"
                | "/model-configs"
                | "/projects"
                | "/ssh-configs"
                | "/mcp_library/servers"
                | "/mcp_library/servers/status"
                | "/sandbox/availability"
                | "/commands"
                | "/events"
        ) || path.starts_with("/assets/")
            || path.starts_with("/icons/")
            || path.starts_with("/fonts/")
            || login_handle(path);
    }
    (*method == Method::POST && matches!(path, "/auth/arcee/login" | "/providers/models"))
        || (*method == Method::DELETE && (path == "/auth/arcee" || login_handle(path)))
}

async fn fence(request: axum::extract::Request, next: Next) -> Response {
    if allowed(request.method(), request.uri().path()) {
        next.run(request).await
    } else {
        (
            StatusCode::FORBIDDEN,
            "This auth fixture admits no session, inference or configuration mutations.",
        )
            .into_response()
    }
}

pub(crate) fn restrict(router: Router) -> Router {
    if service_origin().is_some() {
        router.layer(middleware::from_fn(fence))
    } else {
        router
    }
}

pub(crate) fn models() -> Result<Vec<nac_core::model::ProviderModel>, crate::ApiError> {
    let snapshot =
        nac_core::model::managed_auth_snapshot(nac_core::model::ManagedAuthProvider::Arcee)?;
    if !snapshot.signed_in {
        return Err(crate::ApiError {
            status: StatusCode::BAD_GATEWAY,
            message: "Fixture sign-in has not completed".into(),
        });
    }
    Ok(vec![nac_core::model::ProviderModel {
        id: "native-auth-fixture-model".into(),
        display_name: Some("Local auth fixture model read (no inference)".into()),
    }])
}

#[cfg(test)]
#[path = "tests/native_auth_fixture.rs"]
mod tests;
