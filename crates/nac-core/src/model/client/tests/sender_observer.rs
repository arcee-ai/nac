use super::*;
use crate::model::{
    effect_lease_test_support::ControlledLease,
    sender_observer_test_support::SyntheticSenderObserver,
    UnconfiguredManagedHostExecutionObserver,
};
use std::sync::Arc;

#[test]
fn sender_observer_missing_producer_denies_model_capture_without_credential_fallback() {
    let binding = SyntheticSenderObserver::new().binding;
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        binding,
        Arc::new(UnconfiguredManagedHostExecutionObserver),
    )
    .unwrap();
    assert!(ModelClient::new_for_test()
        .with_host_execution_authority(Some(authority.clone()))
        .is_err());
    let mut settings = EffectiveModelSettings::new(
        BackendKind::ArceeApi,
        "trinity-large-thinking".into(),
        "https://api.arcee.ai".into(),
        None,
        None,
        Default::default(),
    )
    .unwrap();
    settings.host_execution_authority = Some(authority);
    settings.api_key_env = Some("NAC_SYNTHETIC_UNCONFIGURED_SENDER_KEY".into());
    let error = ModelClient::from_effective_settings(settings).unwrap_err();
    assert!(error
        .to_string()
        .contains("managed host execution authority"));
}

#[tokio::test]
async fn sender_observer_captured_model_and_operation_denials_remain_independent() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        observer.clone(),
    )
    .unwrap();
    // This is an existing local model client with a synthetic execution fence,
    // never a production managed sender or a custody/enrollment fixture.
    let mut client = ModelClient::new_for_test()
        .with_host_execution_authority(Some(authority.clone()))
        .unwrap()
        .with_required_effect_lease();
    assert!(client.trusted_managed_host_key.is_none());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    client.base_url = format!("http://{}", listener.local_addr().unwrap());
    let captured = client.clone();
    let error = client
        .send_turn_streaming_with_effect_lease(vec![], vec![], None, Some(ControlledLease::new(1)))
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "managed runtime effect lease denied");
    authority.check_available().unwrap();
    observer.set_current(false);
    for selected in [&client, &captured] {
        for streaming in [false, true] {
            let sink = |_delta| panic!("denied synthetic observer cannot emit output");
            let error = selected
                .send_turn_streaming_with_effect_lease(
                    vec![],
                    vec![],
                    streaming.then_some(&sink as _),
                    Some(ControlledLease::new(0)),
                )
                .await
                .unwrap_err();
            assert!(error
                .to_string()
                .contains("managed host execution authority"));
            assert!(!error.to_string().contains("canary"));
        }
    }
    observer.set_current(true);
    assert!(authority.check_available().is_err());
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
