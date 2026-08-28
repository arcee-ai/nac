//! Per-request auth-status computation for `GET /models`.
//!
//! The badge is a HINT only — it never changes how auth works. An API-key
//! provider reads ready when its conventional credential variable is set
//! in the process environment — the same variable session resolution
//! auto-selects when no explicit `api_key_env` selector is supplied;
//! managed providers read ready when their stored credential file exists
//! and parses. Status is computed from the process environment and the
//! credential files at request time (both change outside the catalog),
//! never baked into catalog data: the catalog carries only the static
//! conventional variable name per provider.

use super::AuthStatus;
use crate::model::{arcee, backend, chatgpt_codex, BackendKind};

/// The login command hint for a managed provider with no usable stored
/// credential.
fn managed_login_hint(provider: BackendKind) -> &'static str {
    match provider {
        BackendKind::ArceeAuth => "nac-web arcee-auth login",
        BackendKind::ChatGptCodexResponses => "nac-web codex-auth login",
        BackendKind::XaiAuth => "nac-web xai-auth login",
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
        BackendKind::XaiAuth => crate::model::xai::stored_credential_present(),
        other => unreachable!("non-managed backend '{other}' has no stored credential"),
    }
}

/// Compute one provider's `(auth_status, auth_hint)` pair.
///
/// API-key providers are ready when the provider's conventional env var
/// (catalog `credential_env_var`) names a set variable — the same variable
/// session resolution auto-selects. Otherwise returns `no_credential` with
/// the conventional var name as the hint (`None` when no conventional name
/// is known). Managed providers are ready when their stored credential
/// exists and parses; otherwise `no_credential` with the login command as
/// the hint.
pub(super) fn provider_auth_status(
    provider: BackendKind,
    credential_env_var: Option<&str>,
) -> (AuthStatus, Option<String>) {
    if backend::api_key_backend(provider) {
        if credential_env_var.is_some_and(backend::env_var_is_set) {
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
