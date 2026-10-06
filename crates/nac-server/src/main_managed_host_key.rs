//! Outermost hidden-worker composition; arguments carry identity, never credentials.

use std::path::Path;

use anyhow::{anyhow, bail, Result};
use nac_core::model::{
    BackendKind, ManagedHostKeyBinding, ManagedHostKeyStore, TrustedManagedHostKey,
};
use nac_managed::ManagedHostConfig;

pub(super) fn resolve(
    raw_binding: Option<&str>,
    backend: Option<BackendKind>,
    origin: Option<&str>,
    api_key_env: Option<&str>,
    credential_file: Option<&Path>,
    insecure_http: bool,
    remote: bool,
) -> Result<Option<TrustedManagedHostKey>> {
    let Some(raw_binding) = raw_binding else {
        return Ok(None);
    };
    if remote || insecure_http || api_key_env.is_some() || credential_file.is_some() {
        bail!("managed host-key worker cannot override its local trusted credential route");
    }
    let binding: ManagedHostKeyBinding = serde_json::from_str(raw_binding)
        .map_err(|_| anyhow!("invalid managed host-key worker binding"))?;
    binding.validate()?;
    let config_path = std::env::var_os("NAC_MANAGED_CONFIG")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "/etc/nac/managed.toml".into());
    let config = ManagedHostConfig::load_host_key_worker(&config_path)?;
    let root = nac_core::model::managed_arcee_auth_storage_root()?;
    validate(&config, &root, &binding, backend, origin).map(Some)
}

pub(super) fn resolve_execution(
    raw_binding: Option<&str>,
    remote: bool,
) -> Result<Option<nac_core::model::ManagedHostExecutionAuthority>> {
    let Some(raw) = raw_binding else {
        return Ok(None);
    };
    if remote {
        bail!("managed execution binding cannot select a remote credential owner");
    }
    let supplied: ManagedHostKeyBinding =
        serde_json::from_str(raw).map_err(|_| anyhow!("invalid managed execution binding"))?;
    supplied.validate()?;
    let path = std::env::var_os("NAC_MANAGED_CONFIG")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "/etc/nac/managed.toml".into());
    let config = ManagedHostConfig::load_host_key_worker(&path)?;
    let root = nac_core::model::managed_arcee_auth_storage_root()?;
    // Execution authority grants no model credential or route. The operator's
    // binding and local private authority are still independently validated.
    let credential = validate(
        &config,
        &root,
        &supplied,
        Some(BackendKind::ArceeApi),
        Some(&config.model_endpoint),
    )?;
    let authority = nac_core::model::ManagedHostExecutionAuthority::new(credential);
    authority.check_available()?;
    Ok(Some(authority))
}

fn validate(
    config: &ManagedHostConfig,
    root: &Path,
    supplied: &ManagedHostKeyBinding,
    backend: Option<BackendKind>,
    origin: Option<&str>,
) -> Result<TrustedManagedHostKey> {
    config.validate()?;
    let binding = config
        .managed_host_key
        .as_ref()
        .ok_or_else(|| anyhow!("managed host-key worker requires its trusted configuration"))?;
    let expected = ManagedHostKeyBinding {
        bootstrap_id: binding.bootstrap_id.clone(),
        managed_host_id: binding.managed_host_id.clone(),
        host_incarnation_id: binding.host_incarnation_id.clone(),
        pvc_uid: binding.pvc_uid.clone(),
        organization_id: binding.organization_id.clone(),
        owner_epoch: binding.owner_epoch,
        key_generation: binding.key_generation,
        local_key_id: binding.local_key_id.clone(),
        key_id: binding.key_id.clone(),
        clerk_instance_id: binding.clerk_instance_id.clone(),
        inference_origin: binding.inference_origin.clone(),
    };
    if supplied != &expected
        || root != config.state_root
        || backend != Some(BackendKind::ArceeApi)
        || origin != Some(expected.inference_origin.as_str())
    {
        bail!("managed host-key worker binding/route does not match trusted configuration");
    }
    ManagedHostKeyStore::new(root).validate_local(&expected)?;
    TrustedManagedHostKey::new(root, expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (ManagedHostConfig, ManagedHostKeyBinding, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("nac-host-key-worker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let binding = json!({
            "bootstrap_id": "4712bc5e-30d5-421a-b416-8291d9f7d8f9",
            "managed_host_id": "21856443-8ed8-40ab-9036-72e837c99f27",
            "host_incarnation_id": "cr-uid-1", "pvc_uid": "pvc-uid-1",
            "organization_id": "11670cb3-ea82-4f66-96ca-d5b6542f8c2a",
            "owner_epoch": 1, "key_generation": 1,
            "local_key_id": "00d61e35-4d17-4949-888f-5f153b03a53b",
            "key_id": "provider-key-1", "clerk_instance_id": "instance-test",
            "inference_origin": "https://api.arcee.ai"
        });
        let config: ManagedHostConfig = serde_json::from_value(json!({
            "version": 3, "logical_host_id": binding["managed_host_id"],
            "host_incarnation_id": "cr-uid-1", "public_hostname": "nac.example.test",
            "repository_root": root.join("repositories"), "state_root": root, "home_root": root.join("home"),
            "github_client_id": "Iv1.example", "model_backend": "arcee-api", "model_id": "trinity-large-thinking",
            "model_endpoint": "https://api.arcee.ai", "model_credential_file": "/run/secrets/nac/bootstrap.json",
            "model_credential_source": "managed-host-key", "managed_control_bind": "0.0.0.0:3211",
            "managed_control_issuer": "https://nac-api.example.test", "managed_control_jwks_file": root.join("jwks"),
            "managed_host_key": binding
        })).unwrap();
        (config, serde_json::from_value(binding).unwrap(), root)
    }

    #[test]
    fn hidden_host_key_worker_requires_exact_config_and_current_authority() {
        let (config, expected, root) = fixture();
        let check =
            |config: &ManagedHostConfig,
             binding: &ManagedHostKeyBinding,
             state: &Path,
             backend,
             origin| { validate(config, state, binding, backend, origin) };
        assert!(check(
            &config,
            &expected,
            &root,
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai")
        )
        .is_err());
        let mut wire = serde_json::to_value(&expected).unwrap();
        wire["version"] = json!(3);
        wire["credential_kind"] = json!("clerk_api_key");
        wire["scopes"] = json!(["managed:inference"]);
        wire["api_key"] = json!("synthetic-worker-key");
        let input = root.join("bootstrap");
        std::fs::write(&input, wire.to_string()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&input, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let store = ManagedHostKeyStore::new(&root);
        store.import(&expected, &input).unwrap();
        std::fs::remove_file(input).unwrap();
        assert!(check(
            &config,
            &expected,
            &root,
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai")
        )
        .is_ok());
        assert!(check(
            &config,
            &expected,
            &root.join("other"),
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai")
        )
        .is_err());
        assert!(check(
            &config,
            &expected,
            &root,
            Some(BackendKind::ArceeAuth),
            Some("https://api.arcee.ai")
        )
        .is_err());
        assert!(check(
            &config,
            &expected,
            &root,
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai/api/v1")
        )
        .is_err());
        for field in [
            "bootstrap_id",
            "host_incarnation_id",
            "pvc_uid",
            "organization_id",
            "key_id",
            "clerk_instance_id",
        ] {
            let mut mismatch = serde_json::to_value(&expected).unwrap();
            mismatch[field] = json!("different");
            let mismatch: ManagedHostKeyBinding = serde_json::from_value(mismatch).unwrap();
            assert!(check(
                &config,
                &mismatch,
                &root,
                Some(BackendKind::ArceeApi),
                Some("https://api.arcee.ai")
            )
            .is_err());
        }
        let mut legacy = config.clone();
        legacy.version = 2;
        assert!(check(
            &legacy,
            &expected,
            &root,
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai")
        )
        .is_err());
        store.record_revocation(&expected).unwrap();
        assert!(check(
            &config,
            &expected,
            &root,
            Some(BackendKind::ArceeApi),
            Some("https://api.arcee.ai")
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hidden_host_key_worker_rejects_remote_or_credential_overrides_before_config_read() {
        for (env, file, insecure, remote) in [
            (Some("ARCEE_API_KEY"), None, false, false),
            (None, Some(Path::new("/other")), false, false),
            (None, None, true, false),
            (None, None, false, true),
        ] {
            assert!(resolve(
                Some("{}"),
                Some(BackendKind::ArceeApi),
                Some("https://api.arcee.ai"),
                env,
                file,
                insecure,
                remote
            )
            .is_err());
        }
        assert!(resolve(None, None, None, None, None, false, false)
            .unwrap()
            .is_none());
    }
}
