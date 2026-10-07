use super::*;

fn config(source: ManagedModelCredentialSource, backend: &str) -> ManagedHostConfig {
    ManagedHostConfig {
        version: nac_managed::LEGACY_MANAGED_CONFIG_VERSION,
        logical_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".to_string(),
        host_incarnation_id: None,
        owner: None,
        public_hostname: "nac.example.test".to_string(),
        repository_root: PathBuf::from("/var/lib/nac/repositories"),
        state_root: PathBuf::from("/var/lib/nac"),
        home_root: PathBuf::from("/home/nac"),
        github_client_id: "Iv1.example".to_string(),
        model_backend: backend.to_string(),
        model_id: "trinity-large-thinking".to_string(),
        model_endpoint: "https://api.arcee.ai".to_string(),
        model_auth_issuer: None,
        model_credential_file: match source {
            ManagedModelCredentialSource::MountedApiKey => {
                PathBuf::from("/run/secrets/model/credential")
            }
            ManagedModelCredentialSource::ManagedBootstrap
            | ManagedModelCredentialSource::ManagedHostKey => {
                PathBuf::from(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH)
            }
        },
        model_credential_source: source,
        model_credential_environment_names: Vec::new(),
        managed_control_bind: None,
        managed_control_issuer: None,
        managed_control_jwks_file: None,
        managed_upgrade_expectation: None,
        managed_host_key: None,
    }
}

#[test]
fn mounted_api_key_profile_remains_the_compatible_default_shape() {
    let profile = ManagedModelProfile::from_config(&config(
        ManagedModelCredentialSource::MountedApiKey,
        "arcee-api",
    ))
    .unwrap();
    assert!(profile.trusted_api_key_file().is_some());
    let options = profile.resume_options(true);
    assert!(options.trusted_api_key_file.is_some());
    assert!(options.trusted_light_credential.is_some());
    assert!(profile.resume_options(false).trusted_api_key_file.is_none());
}

#[test]
fn managed_bootstrap_is_arcee_auth_only_and_never_attaches_a_key_file() {
    let profile = ManagedModelProfile::from_config(&config(
        ManagedModelCredentialSource::ManagedBootstrap,
        "arcee-auth",
    ))
    .unwrap();
    assert_eq!(profile.backend, BackendKind::ArceeAuth);
    assert_eq!(
        profile.auth_issuer.as_deref(),
        Some(nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER)
    );
    assert!(profile.trusted_api_key_file().is_none());
    let options = profile.resume_options(true);
    assert!(options.trusted_api_key_file.is_none());
    assert!(options.trusted_light_credential.is_none());

    let error = ManagedModelProfile::from_config(&config(
        ManagedModelCredentialSource::ManagedBootstrap,
        "arcee-api",
    ))
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("require model_backend 'arcee-auth'"));
}

#[test]
fn managed_bootstrap_requires_the_fixed_regular_file_contract_path() {
    let mut managed = config(ManagedModelCredentialSource::ManagedBootstrap, "arcee-auth");
    managed.model_credential_file = PathBuf::from("/tmp/bootstrap.json");
    let error = ManagedModelProfile::from_config(&managed).unwrap_err();
    assert!(error
        .to_string()
        .contains(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH));
}

#[test]
fn managed_bootstrap_auth_issuer_is_exact_and_arcee_auth_only() {
    let mut managed = config(ManagedModelCredentialSource::ManagedBootstrap, "arcee-auth");
    managed.model_auth_issuer = Some(nac_core::model::ARCEE_AUTH_DEV2_ISSUER.to_string());
    let profile = ManagedModelProfile::from_config(&managed).unwrap();
    assert_eq!(
        profile.auth_issuer.as_deref(),
        Some(nac_core::model::ARCEE_AUTH_DEV2_ISSUER)
    );

    managed.model_auth_issuer = Some("https://tenant.arcee.ai".to_string());
    assert!(ManagedModelProfile::from_config(&managed)
        .unwrap_err()
        .to_string()
        .contains("not approved"));

    let mut api_key = config(ManagedModelCredentialSource::MountedApiKey, "arcee-api");
    api_key.model_auth_issuer = Some(nac_core::model::ARCEE_AUTH_PRODUCTION_ISSUER.to_string());
    assert!(ManagedModelProfile::from_config(&api_key)
        .unwrap_err()
        .to_string()
        .contains("requires model_backend 'arcee-auth'"));
}

fn static_config() -> ManagedHostConfig {
    let mut managed = config(ManagedModelCredentialSource::ManagedHostKey, "arcee-api");
    managed.version = 3;
    managed.host_incarnation_id = Some("cr-uid-1".into());
    managed.managed_control_bind = Some("0.0.0.0:3211".into());
    managed.managed_control_issuer = Some("https://nac-api.example.test".into());
    managed.managed_control_jwks_file = Some(PathBuf::from("/etc/nac/jwks.json"));
    managed.managed_host_key = Some(nac_managed::ManagedHostKeyConfig {
        bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
        managed_host_id: managed.logical_host_id.clone(),
        host_incarnation_id: "cr-uid-1".into(),
        pvc_uid: "pvc-uid-1".into(),
        organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
        owner_epoch: 1,
        key_generation: 1,
        local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
        key_id: "provider-key-1".into(),
        clerk_instance_id: "instance-test".into(),
        inference_origin: managed.model_endpoint.clone(),
    });
    managed
}

#[test]
fn static_host_key_profile_is_route_bound_and_ephemeral_for_new_resume_and_light() {
    let managed = static_config();
    let profile = ManagedModelProfile::from_config(&managed).unwrap();
    assert_eq!(profile.backend, BackendKind::ArceeApi);
    assert!(profile.auth_issuer.is_none());
    assert!(profile.trusted_api_key_file().is_none());
    assert!(profile.trusted_managed_host_key().is_some());
    let options = profile.resume_options(true);
    assert!(options.trusted_managed_host_key.is_some());
    assert!(options.host_execution_authority.is_some());
    assert!(profile
        .resume_options(false)
        .host_execution_authority
        .is_some());
    assert!(options
        .trusted_light_credential
        .unwrap()
        .managed_host_key
        .is_some());
    assert!(profile
        .resume_options(false)
        .trusted_managed_host_key
        .is_none());
    assert!(profile.matches_settings_override(
        BackendKind::ArceeApi,
        &managed.model_endpoint,
        None
    ));
    assert!(!profile.matches_settings_override(
        BackendKind::ArceeAuth,
        &managed.model_endpoint,
        None
    ));
    assert!(!profile.matches_settings_override(
        BackendKind::ArceeApi,
        "https://elsewhere.example.test",
        None
    ));
    assert!(!profile.matches_settings_override(
        BackendKind::ArceeApi,
        &managed.model_endpoint,
        Some("ARCEE_API_KEY")
    ));
}

#[test]
fn static_host_key_profile_rejects_unapproved_origin_and_legacy_config() {
    let mut managed = static_config();
    managed.model_endpoint = "https://unapproved.example.test".into();
    managed.managed_host_key.as_mut().unwrap().inference_origin = managed.model_endpoint.clone();
    assert!(ManagedModelProfile::from_config(&managed).is_err());
    let mut managed = static_config();
    managed.version = 2;
    assert!(ManagedModelProfile::from_config(&managed).is_err());
}

#[tokio::test]
async fn static_host_key_profile_has_no_device_repair_capability() {
    let managed = static_config();
    let profile = ManagedModelProfile::from_config(&managed).unwrap();
    assert!(profile.begin_interactive_repair(&managed).await.is_err());
}
