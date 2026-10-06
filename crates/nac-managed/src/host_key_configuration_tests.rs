use super::*;
use std::path::PathBuf;

fn config() -> ManagedHostConfig {
    let raw = r#"
version = 3
logical_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
host_incarnation_id = "cr-uid-1"
public_hostname = "nac.example.test"
repository_root = "/var/lib/nac/repositories"
state_root = "/var/lib/nac"
home_root = "/home/nac"
github_client_id = "Iv1.example"
model_backend = "arcee-api"
model_id = "trinity-large-thinking"
model_endpoint = "https://api.arcee.ai"
model_credential_file = "/run/secrets/nac/bootstrap.json"
model_credential_source = "managed-host-key"
managed_control_bind = "0.0.0.0:3211"
managed_control_issuer = "https://nac-api.example.test"
managed_control_jwks_file = "/etc/nac/jwks.json"
[managed_host_key]
bootstrap_id = "4712bc5e-30d5-421a-b416-8291d9f7d8f9"
managed_host_id = "21856443-8ed8-40ab-9036-72e837c99f27"
host_incarnation_id = "cr-uid-1"
pvc_uid = "pvc-uid-1"
organization_id = "11670cb3-ea82-4f66-96ca-d5b6542f8c2a"
owner_epoch = 1
key_generation = 1
local_key_id = "00d61e35-4d17-4949-888f-5f153b03a53b"
key_id = "provider-key-1"
clerk_instance_id = "instance-test"
inference_origin = "https://api.arcee.ai"
"#;
    toml::from_str(raw).unwrap()
}

#[test]
fn host_key_configuration_is_explicit_version_three_nonsecret_identity() {
    let config = config();
    config.validate().unwrap();
    assert!(config.model_credential().is_err());
    assert!(config.managed_control().unwrap().is_some());
    let mut unknown = serde_json::to_value(config.managed_host_key.unwrap()).unwrap();
    unknown["api_key"] = serde_json::json!("must-not-be-in-config");
    assert!(serde_json::from_value::<ManagedHostKeyConfig>(unknown).is_err());
}

#[test]
fn host_key_configuration_rejects_legacy_modes_and_credential_selectors() {
    let cases: [fn(&mut ManagedHostConfig); 10] = [
        |c| c.version = 2,
        |c| c.model_backend = "arcee-auth".into(),
        |c| c.model_auth_issuer = Some("https://auth.arcee.ai".into()),
        |c| {
            c.model_credential_environment_names
                .push("ARCEE_API_KEY".into());
        },
        |c| c.model_credential_file = PathBuf::from("/different/bootstrap"),
        |c| c.managed_host_key = None,
        |c| c.model_credential_source = ManagedModelCredentialSource::MountedApiKey,
        |c| c.logical_host_id = uuid::Uuid::new_v4().to_string(),
        |c| c.host_incarnation_id = Some("other-cr".into()),
        |c| c.model_endpoint = "https://other.example.test".into(),
    ];
    for mutate in cases {
        let mut invalid = config();
        mutate(&mut invalid);
        assert!(invalid.validate().is_err(), "{invalid:?}");
    }
}

#[test]
fn host_key_configuration_rejects_unbounded_or_noncanonical_binding() {
    let cases: [fn(&mut ManagedHostKeyConfig); 9] = [
        |b| b.bootstrap_id = b.bootstrap_id.to_uppercase(),
        |b| b.organization_id = "org_provider".into(),
        |b| b.local_key_id.clear(),
        |b| b.pvc_uid = " ".into(),
        |b| b.key_id = "x".repeat(257),
        |b| b.clerk_instance_id = "control\nchar".into(),
        |b| b.owner_epoch = 0,
        |b| b.key_generation = i64::MAX as u64 + 1,
        |b| b.inference_origin.push('/'),
    ];
    for mutate in cases {
        let mut invalid = config();
        mutate(invalid.managed_host_key.as_mut().unwrap());
        assert!(invalid.validate().is_err(), "{invalid:?}");
    }
}

#[cfg(unix)]
#[test]
fn hidden_worker_config_reader_denies_symlink_and_public_mode() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let root = std::env::temp_dir().join(format!("nac-worker-config-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let real = root.join("real");
    std::fs::write(&real, "version=3").unwrap();
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(ManagedHostConfig::load_host_key_worker(&real).is_err());
    std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o600)).unwrap();
    let link = root.join("link");
    symlink(&real, &link).unwrap();
    assert!(ManagedHostConfig::load_host_key_worker(&link).is_err());
    std::fs::remove_dir_all(root).unwrap();
}
