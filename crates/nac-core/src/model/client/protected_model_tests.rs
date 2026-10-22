//! Real eight-phase import/store mechanics with deliberately private synthetic
//! authority/runtime controls. No provider request or runtime qualification.
use super::*;
use crate::{
    model::ApiKeySelector,
    runtime::{
        create_owner_test_helpers::{finish, Fixture},
        CompletedInitialImport, CreatePublicationCustody, ModelImportFixture,
    },
};

fn settings() -> EffectiveModelSettings {
    EffectiveModelSettings::from_optional_with_selector(
        Some(BackendKind::ArceeApi),
        Some("trinity-large-thinking".into()),
        Some("https://api.arcee.ai/api/v1".into()),
        None,
        ApiKeySelector::Exact(None),
        Default::default(),
        false,
    )
    .unwrap()
}
struct Inputs {
    imported: ModelImportFixture,
    custody: Arc<InitialHostKeyCustody>,
    completion: Arc<CompletedInitialImport>,
    _factory: Fixture,
    runtime: CreatePublicationCustody,
}
impl Inputs {
    fn new() -> Self {
        let (imported, custody, completion) = ModelImportFixture::new();
        let factory = Fixture::for_host_key(custody.binding());
        let runtime = finish(&factory);
        Self {
            imported,
            custody: Arc::new(custody),
            completion: Arc::new(completion),
            _factory: factory,
            runtime,
        }
    }
    fn client(&self) -> ModelClient {
        ModelClient::from_protected_host_key(
            settings(),
            Arc::clone(&self.custody),
            Arc::clone(&self.completion),
            Arc::clone(self.runtime.context()),
        )
        .unwrap()
    }
}
#[test]
fn actual_retained_imported_key_is_used_without_selectors_or_receipt_repair() {
    let inputs = Inputs::new();
    let receipt = inputs.imported.receipt_path();
    std::fs::remove_file(&receipt).unwrap();
    let client = inputs.client();
    assert!(!client.api_key.is_empty());
    assert!(client.api_key_env().is_none());
    assert!(client.trusted_api_key_file().is_none());
    assert!(Arc::ptr_eq(
        &client.protected_host_key.as_ref().unwrap().custody,
        &inputs.custody
    ));
    assert!(!receipt.exists());
    assert!(!format!("{client:?}").contains(&client.api_key));
    client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .unwrap();
}
#[test]
fn endpoint_identity_and_credential_fallbacks_are_refused() {
    let changes: &[fn(&mut EffectiveModelSettings)] = &[
        |s| s.api_key_env = Some("ARCEE_API_KEY".into()),
        |s| s.trusted_api_key_file = Some("/does/not/exist/private-key".into()),
        |s| s.backend = BackendKind::ArceeAuth,
        |s| s.base_url = "https://api2.apps.dev.arcee.ai/api/v1".into(),
        |s| s.allow_insecure_http = true,
    ];
    let inputs = Inputs::new();
    for change in changes {
        let mut selected = settings();
        change(&mut selected);
        let error = ModelClient::from_protected_host_key(
            selected,
            Arc::clone(&inputs.custody),
            Arc::clone(&inputs.completion),
            Arc::clone(inputs.runtime.context()),
        )
        .err()
        .unwrap();
        assert_eq!(
            error.to_string(),
            "protected model construction unavailable"
        );
    }
    let wrong_owner = Fixture::new();
    let wrong_runtime = finish(&wrong_owner);
    assert!(ModelClient::from_protected_host_key(
        settings(),
        Arc::clone(&inputs.custody),
        Arc::clone(&inputs.completion),
        Arc::clone(wrong_runtime.context())
    )
    .is_err());
    let (_other_import, _other_key, other_completion) = ModelImportFixture::new();
    assert!(ModelClient::from_protected_host_key(
        settings(),
        Arc::clone(&inputs.custody),
        Arc::new(other_completion),
        Arc::clone(inputs.runtime.context())
    )
    .is_err());
}
#[tokio::test]
async fn runtime_denial_refuses_before_provider_request_and_never_falls_back() {
    let inputs = tokio::task::spawn_blocking(Inputs::new).await.unwrap();
    let client = inputs.client();
    inputs.runtime.context().cancellation().unwrap().cancel();
    let error = client
        .send_turn(Vec::new(), Vec::new())
        .await
        .err()
        .unwrap();
    assert!(!error.to_string().contains("HTTP"));
    assert!(!error.to_string().contains(&client.api_key));
}
#[test]
fn changed_private_key_slot_denies_the_same_client_stickily() {
    let inputs = Inputs::new();
    let client = inputs.client();
    let file = inputs.imported.private_key_path();
    let original = std::fs::read(&file).unwrap();
    inputs
        .imported
        .key_store()
        .record_revocation(inputs.custody.binding())
        .unwrap();
    assert!(client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .is_err());
    nac_credential_store::write_auth_string_to_path(&file, std::str::from_utf8(&original).unwrap())
        .unwrap();
    assert!(client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .is_err());
}
#[tokio::test]
async fn pending_provider_wait_wakes_on_the_original_runtime_denial() {
    let inputs = tokio::task::spawn_blocking(Inputs::new).await.unwrap();
    let client = inputs.client();
    client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .unwrap();
    let wait = inputs.runtime.context().invalidated();
    tokio::pin!(wait);
    assert!(tokio::time::timeout(Duration::from_millis(10), &mut wait)
        .await
        .is_err());
    inputs.runtime.context().cancellation().unwrap().cancel();
    tokio::time::timeout(Duration::from_secs(1), &mut wait)
        .await
        .unwrap();
}
#[test]
fn completed_import_clock_is_not_reused_as_runtime_eligibility() {
    let inputs = Inputs::new();
    let client = inputs.client();
    inputs.imported.expire_import_clock();
    client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .unwrap();
    assert!(inputs.completion.check_current().is_err());
    assert!(
        client
            .protected_host_key
            .as_ref()
            .unwrap()
            .check_current()
            .is_err(),
        "explicit import denial remains sticky on the original owner"
    );
}

#[test]
fn native_bounded_denial_reaches_the_same_model_key_owner_without_io() {
    let inputs = Inputs::new();
    let client = inputs.client();
    inputs.custody.check_denial().unwrap();
    inputs
        .completion
        .check_custody_association(&inputs.custody)
        .unwrap();
    inputs.custody.deny();
    assert!(inputs.custody.check_denial().is_err());
    assert!(inputs
        .completion
        .check_custody_association(&inputs.custody)
        .is_err());
    assert!(client
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .is_err());
    let independent = Inputs::new();
    independent.custody.check_denial().unwrap();
    assert!(independent
        .completion
        .check_custody_association(&inputs.custody)
        .is_err());
}

#[test]
fn model_debug_never_formats_credential_headers_or_trusted_paths() {
    let mut client = ModelClient::new_for_test();
    client.api_key = "private-model-key-canary".into();
    client
        .extra_headers
        .insert("x-private".into(), "private-header-canary".into());
    client.trusted_api_key_file = Some("/private-key-path-canary".into());
    let formatted = format!("{client:?}");
    for private in [
        "private-model-key-canary",
        "private-header-canary",
        "private-key-path-canary",
    ] {
        assert!(!formatted.contains(private));
    }
}

#[tokio::test]
async fn actual_http_retry_rechecks_original_private_key_before_another_send() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let inputs = tokio::task::spawn_blocking(Inputs::new).await.unwrap();
    let client = inputs.client();
    let store = inputs.imported.key_store().clone();
    let binding = inputs.custody.binding().clone();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "503 Service Unavailable",
            r#"{"error":"try later"}"#,
        )],
        move |_, _| store.record_revocation(&binding).unwrap(),
    );
    // This private test points the already-constructed canary client at its
    // disposable loopback fixture only. Production has no endpoint setter.
    let result = client
        .post_arcee_api_chat(
            &server.base_url,
            serde_json::json!({"messages":[]}),
            "reasoning_content",
            None,
        )
        .await;
    assert!(result.is_err());
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].headers.get("authorization"),
        Some(&format!("Bearer {}", client.api_key))
    );
    assert!(!format!("{:?}", result.err().unwrap()).contains(&client.api_key));
}

#[test]
fn canceled_model_scope_does_not_revoke_other_scopes_sharing_original_host_key() {
    let inputs = Inputs::new();
    assert!(inputs
        .custody
        .model_key(|| anyhow::bail!("synthetic scope canceled"))
        .is_err());
    inputs
        .custody
        .check_denial()
        .expect("scope cancellation must not revoke host custody");
    inputs.custody.check_current(|| Ok(())).unwrap();
    let other = inputs.client();
    other
        .protected_host_key
        .as_ref()
        .unwrap()
        .check_current()
        .unwrap();
}

#[test]
fn cancellation_after_private_read_never_returns_key_or_revokes_shared_host() {
    let inputs = Inputs::new();
    let mut checks = 0;
    assert!(inputs
        .custody
        .model_key(|| {
            checks += 1;
            anyhow::ensure!(checks != 2, "synthetic canceled after key read");
            Ok(())
        })
        .is_err());
    assert_eq!(checks, 2);
    inputs.custody.check_denial().unwrap();
    inputs.custody.check_current(|| Ok(())).unwrap();
    inputs.client();
}
#[test]
fn global_initial_authority_callback_denial_still_revokes_original_custody() {
    let inputs = Inputs::new();
    assert!(inputs
        .custody
        .check_current(|| anyhow::bail!("synthetic original source denied"))
        .is_err());
    assert!(inputs.custody.check_denial().is_err());
}
