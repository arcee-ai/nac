//! Per-request auth-status computation for `GET /models`.
//!
//! The badge is a HINT only — it never changes how auth works. An API-key
//! provider reads ready when its conventional selector resolves through the
//! process environment or the NAC credential store;
//! managed providers read ready when their stored credential file exists
//! and parses. Status is computed from the process environment and the
//! credential files at request time (both change outside the catalog),
//! never baked into catalog data: the catalog carries only the static
//! conventional variable name per provider.

use super::AuthStatus;
use crate::model::{arcee, backend, chatgpt_codex, BackendKind};

/// The login command hint for a managed provider with no usable stored
/// credential.
fn managed_login_hint(provider: BackendKind, invocation_name: &str) -> String {
    let command = match provider {
        BackendKind::ArceeAuth => "arcee-auth",
        BackendKind::ChatGptCodexResponses => "codex-auth",
        other => unreachable!("non-managed backend '{other}' has no login hint"),
    };
    format!("{invocation_name} {command} login")
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

/// Compute one provider's `(auth_status, auth_hint)` pair.
///
/// API-key providers are ready when the provider's conventional selector
/// (catalog `credential_env_var`) resolves using session credential rules.
/// Otherwise returns `no_credential` with
/// the conventional var name as the hint (`None` when no conventional name
/// is known). Managed providers are ready when their stored credential
/// exists and parses; otherwise `no_credential` with the login command as
/// the hint.
pub(super) fn provider_auth_status(
    provider: BackendKind,
    credential_env_var: Option<&str>,
    invocation_name: &str,
) -> (AuthStatus, Option<String>) {
    if backend::api_key_backend(provider) {
        if credential_env_var
            .is_some_and(|name| backend::api_key_for_backend(provider, Some(name)).is_ok())
        {
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
            Some(managed_login_hint(provider, invocation_name)),
        )
    }
}
