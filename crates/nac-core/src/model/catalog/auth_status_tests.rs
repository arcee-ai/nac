//! Auth-status semantics for `GET /models`: the badge is a per-request
//! HINT computed from the process environment and the managed credential
//! files — never baked into the catalog, and never a change to how auth
//! works (an API-key provider reads ready when its conventional credential
//! variable is set — the same variable session resolution auto-selects;
//! managed providers read only their stored credential).

use super::test_support::EnvGuard;
use super::*;
use crate::TEST_ENV_LOCK;
use std::path::Path;

/// Every credential variable the status computation can read in these
/// tests: the five models.dev conventional names and arcee-api's
/// hand-seeded name. Saved + cleared by the guard so every test starts
/// from a credential-free environment.
const CREDENTIAL_VARS: [&str; 6] = [
    "DEEPSEEK_API_KEY",
    "FIREWORKS_API_KEY",
    "TOGETHER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ARCEE_API_KEY",
];

const API_KEY_PROVIDERS: [(BackendKind, &str); 6] = [
    (BackendKind::DeepSeekChat, "DEEPSEEK_API_KEY"),
    (BackendKind::FireworksChat, "FIREWORKS_API_KEY"),
    (BackendKind::TogetherChat, "TOGETHER_API_KEY"),
    (BackendKind::OpenAiResponses, "OPENAI_API_KEY"),
    (BackendKind::AnthropicMessages, "ANTHROPIC_API_KEY"),
    (BackendKind::ArceeApi, "ARCEE_API_KEY"),
];

fn credential_free_guard(label: &str) -> EnvGuard {
    EnvGuard::new(label, &CREDENTIAL_VARS, &CREDENTIAL_VARS)
}

fn provider(listing: &ModelListing, id: BackendKind) -> &ProviderListing {
    listing
        .providers
        .iter()
        .find(|provider| provider.id == id)
        .unwrap()
}

fn write_credential(home: &Path, name: &str, contents: &str) {
    let path = home.join(name);
    std::fs::write(&path, contents).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

/// Mirrors `model::tests::auth`'s stored_arcee_auth: the parse path
/// requires the device-token type, nonblank tokens and an approved origin.
fn stored_arcee_auth() -> &'static str {
    r#"{"type":"arcee_device_token","access_token":"access-test","refresh_token":"refresh-test","token_type":"bearer","expires_at_ms":18446744073709551615,"base_url":"https://api.arcee.ai","organization_id":"org-test","workspace_name":"workspace-test"}"#
}

fn stored_codex_auth() -> &'static str {
    r#"{"type":"chatgpt-codex","access":"access-test","refresh":"refresh-test","expires_at_ms":18446744073709551615,"account_id":"account-test"}"#
}

fn stored_xai_auth() -> &'static str {
    r#"{"type":"xai-oauth","access":"access-test","refresh":"refresh-test","expires_at_ms":18446744073709551615,"account":"account-test"}"#
}

#[test]
fn api_key_providers_read_ready_via_their_conventional_env_var() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = credential_free_guard("status-conventional");
    unsafe { std::env::set_var("DEEPSEEK_API_KEY", "test-key") };

    let listing = api_listing();
    let deepseek = provider(&listing, BackendKind::DeepSeekChat);
    assert_eq!(deepseek.auth_status, AuthStatus::Ready);
    assert_eq!(deepseek.auth_hint, None);

    // A provider whose conventional var is unset stays no_credential and
    // hints its conventional name.
    let fireworks = provider(&listing, BackendKind::FireworksChat);
    assert_eq!(fireworks.auth_status, AuthStatus::NoCredential);
    assert_eq!(fireworks.auth_hint.as_deref(), Some("FIREWORKS_API_KEY"));
}

#[test]
fn api_key_providers_without_credentials_hint_the_conventional_var() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = credential_free_guard("status-hints");

    let listing = api_listing();
    for (id, conventional) in API_KEY_PROVIDERS {
        let listing_provider = provider(&listing, id);
        assert_eq!(
            listing_provider.auth_status,
            AuthStatus::NoCredential,
            "{id}"
        );
        assert_eq!(
            listing_provider.auth_hint.as_deref(),
            Some(conventional),
            "{id}"
        );
    }

    // Managed providers hint their login commands instead.
    let arcee = provider(&listing, BackendKind::ArceeAuth);
    assert_eq!(arcee.auth_status, AuthStatus::NoCredential);
    assert_eq!(arcee.auth_hint.as_deref(), Some("nac-web arcee-auth login"));
    let codex = provider(&listing, BackendKind::ChatGptCodexResponses);
    assert_eq!(codex.auth_status, AuthStatus::NoCredential);
    assert_eq!(codex.auth_hint.as_deref(), Some("nac-web codex-auth login"));
    let xai = provider(&listing, BackendKind::XaiAuth);
    assert_eq!(xai.auth_status, AuthStatus::NoCredential);
    assert_eq!(xai.auth_hint.as_deref(), Some("nac-web xai-auth login"));
}

#[test]
fn empty_and_whitespace_env_vars_do_not_count_as_credentials() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = credential_free_guard("status-empty");

    for value in ["", "   "] {
        unsafe { std::env::set_var("DEEPSEEK_API_KEY", value) };
        let listing = api_listing();
        assert_eq!(
            provider(&listing, BackendKind::DeepSeekChat).auth_status,
            AuthStatus::NoCredential,
            "value {value:?}"
        );
    }
}

#[test]
fn managed_providers_read_ready_only_with_a_parseable_stored_credential() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = credential_free_guard("status-managed");

    // Absent files: both managed providers hint their login commands.
    let listing = api_listing();
    assert_eq!(
        provider(&listing, BackendKind::ArceeAuth).auth_status,
        AuthStatus::NoCredential
    );
    assert_eq!(
        provider(&listing, BackendKind::ChatGptCodexResponses).auth_status,
        AuthStatus::NoCredential
    );
    assert_eq!(
        provider(&listing, BackendKind::XaiAuth).auth_status,
        AuthStatus::NoCredential
    );

    // A parseable stored credential flips only its provider.
    write_credential(env.path(), "arcee_auth.json", stored_arcee_auth());
    let listing = api_listing();
    let arcee = provider(&listing, BackendKind::ArceeAuth);
    assert_eq!(arcee.auth_status, AuthStatus::Ready);
    assert_eq!(arcee.auth_hint, None);
    assert_eq!(
        provider(&listing, BackendKind::ChatGptCodexResponses).auth_status,
        AuthStatus::NoCredential
    );

    write_credential(env.path(), "auth.json", stored_codex_auth());
    write_credential(env.path(), "xai_auth.json", stored_xai_auth());
    let listing = api_listing();
    assert_eq!(
        provider(&listing, BackendKind::ChatGptCodexResponses).auth_status,
        AuthStatus::Ready
    );
    assert_eq!(
        provider(&listing, BackendKind::XaiAuth).auth_status,
        AuthStatus::Ready
    );

    // A corrupt credential file reads as no credential (the hint points at
    // re-login; the badge never diagnoses).
    write_credential(env.path(), "arcee_auth.json", "{not-json}");
    let listing = api_listing();
    let arcee = provider(&listing, BackendKind::ArceeAuth);
    assert_eq!(arcee.auth_status, AuthStatus::NoCredential);
    assert_eq!(arcee.auth_hint.as_deref(), Some("nac-web arcee-auth login"));
}
