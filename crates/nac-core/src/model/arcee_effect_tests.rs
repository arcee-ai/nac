use super::super::effect_lease_test_support::ControlledLease;
use super::*;

#[tokio::test]
async fn arcee_lease_denies_before_credential_read_or_refresh() {
    for forced in [false, true] {
        let scope = CallEffectScope::new(true, Some(ControlledLease::new(1))).unwrap();
        let error = if forced {
            force_refresh_access_token_with_effects(
                &Client::new(),
                "https://api.arcee.ai",
                "stale",
                &scope,
            )
            .await
        } else {
            fresh_access_token_with_effects(&Client::new(), "https://api.arcee.ai", &scope).await
        }
        .unwrap_err();
        assert_eq!(error.to_string(), "managed runtime effect lease denied");
    }
}

#[tokio::test]
async fn arcee_rechecks_authority_after_refresh_gate_before_credential_read() {
    let directory = std::env::temp_dir().join(format!("nac-arcee-effect-{}", Uuid::new_v4()));
    fs::create_dir_all(&directory).unwrap();
    let scope = CallEffectScope::new(true, Some(ControlledLease::new(1))).unwrap();
    let error = refresh_locked_with_effects(
        &Client::new(),
        "https://api.arcee.ai",
        |_| true,
        &directory.join("absent-auth.json"),
        &directory.join("auth.lock"),
        ArceeAuthService::approved,
        &scope,
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "managed runtime effect lease denied");
    assert!(!directory.join("absent-auth.json").exists());
    fs::remove_dir_all(directory).unwrap();
}
