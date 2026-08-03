//! Per-request auth-status computation for `GET /models`.
//!
//! The badge is a HINT only — it never changes how auth works. API-key
//! providers still read only the exact `api_key_env` selector at session
//! launch; managed providers still read only their stored credential file.
//! Status is computed from the process environment and the credential files
//! at request time (both change outside the catalog), never baked into
//! catalog data: the catalog carries only the static conventional variable
//! name per provider.

use super::AuthStatus;
use crate::model::{arcee, backend, chatgpt_codex, BackendKind};

/// The login command hint for a managed provider with no usable stored
/// credential.
fn managed_login_hint(provider: BackendKind) -> &'static str {
    match provider {
        BackendKind::ArceeAuth => "nac-web arcee-auth login",
        BackendKind::ChatGptCodexResponses => "nac-web codex-auth login",
        other => unreachable!("non-managed backend '{other}' has no login hint"),
    }
}

/// Whether a managed provider's stored credential file exists and parses
/// (the same read paths the auth `status` commands use — a parse check,
/// not mere file existence). Any read/parse/permission failure reads as
/// "no credential": the badge hints at re-login, it never diagnoses.
fn managed_credential_present(provider: BackendKind) -> bool {
    match provider {
        BackendKind::ArceeAuth => arcee::stored_credential_present(),
        BackendKind::ChatGptCodexResponses => chatgpt_codex::stored_credential_present(),
        other => unreachable!("non-managed backend '{other}' has no stored credential"),
    }
}

/// Whether `name` exists in the process environment with a usable value.
/// Empty or whitespace-only values do not count, matching the
/// `api_key_for_backend` launch-time semantics.
fn env_var_is_set(name: &str) -> bool {
    std::env::var_os(name)
        .and_then(|value| value.into_string().ok())
        .is_some_and(|value| !value.trim().is_empty())
}

/// Compute one provider's `(auth_status, auth_hint)` pair.
///
/// API-key providers are ready when EITHER the provider's conventional env
/// var (catalog `credential_env_var`) OR the configured selector
/// (`configured_api_key_env`, config.toml `[model].api_key_env` — one
/// selector for every backend, per the launch dialog's inherit mode) names
/// a set variable; otherwise `no_credential` with the conventional var
/// name as the hint (`None` when no conventional name is known). Managed
/// providers are ready when their stored credential exists and parses;
/// otherwise `no_credential` with the login command as the hint.
pub(super) fn provider_auth_status(
    provider: BackendKind,
    credential_env_var: Option<&str>,
    configured_api_key_env: Option<&str>,
) -> (AuthStatus, Option<String>) {
    if backend::api_key_backend(provider) {
        let ready = credential_env_var.is_some_and(env_var_is_set)
            || configured_api_key_env.is_some_and(env_var_is_set);
        if ready {
            return (AuthStatus::Ready, None);
        }
        return (
            AuthStatus::NoCredential,
            credential_env_var.map(str::to_string),
        );
    }
    if managed_credential_present(provider) {
        (AuthStatus::Ready, None)
    } else {
        (
            AuthStatus::NoCredential,
            Some(managed_login_hint(provider).to_string()),
        )
    }
}
