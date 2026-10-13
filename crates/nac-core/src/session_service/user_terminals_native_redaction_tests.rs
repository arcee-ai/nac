//! Isolated native capture plus genuine managed provider and real Local PTYs.
use super::*;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};

const NATIVE: &str = "nac-native-exa-canary";
const OLD_APP: &str = "managed-old-\x1b[31mapp-canary";
const NEW_APP: &str = "managed-new-app-canary";
const HELPER: &str = "NAC_HUMAN_NATIVE_REDACTION_RESULT";

async fn collect_until(service: &SessionService, id: &str, marker: &[u8]) -> Result<Vec<u8>> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service.read_user_terminal_output(id, 0, 65536).await?;
            if page
                .bytes
                .windows(marker.len())
                .any(|bytes| bytes == marker)
            {
                return Ok(page.bytes);
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .map_err(|_| anyhow!("native masking fixture output did not settle"))?
}

async fn settled(service: &SessionService, id: &str) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = service.user_terminal_status(id).await?;
            if !status.alive && status.exit_code == Some(0) && status.output_complete {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .map_err(|_| anyhow!("native masking fixture ownership did not settle"))?
}

async fn observe(
    service: &SessionService,
    directory: &Path,
    store: &nac_managed::HostSecretStore,
) -> Result<Value> {
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await?;
    let terminal = service.open_user_terminal(Uuid::new_v4(), 80, 24).await?;
    let ready = directory.join("split-ready");
    // The native credential is fixture-authored literal data, never an injected
    // shell variable. The read barrier splits it across genuine PTY writes.
    service.write_user_terminal_input(&terminal.id, format!(
        "stty -echo -onlcr; PS1=; PROMPT_COMMAND=; printf 'ENV=%s\\n' \"${{EXA_API_KEY-unset}}\"; printf 'NATIVE='; printf '%s' 'nac-native-'; printf ready > '{}'; read -r release; printf '%s\\n' 'exa-canary'; printf 'APP=%s\\n' \"$APP_TERMINAL_SYNTHETIC\"; printf 'LIVE-DONE\\n'\r", ready.display(),
    ).as_bytes()).await?;
    let barrier = tokio::time::timeout(Duration::from_secs(5), async {
        while !ready.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    if barrier.is_err() {
        let page = service
            .read_user_terminal_output(&terminal.id, 0, 4096)
            .await?;
        let diagnostic = String::from_utf8_lossy(&page.bytes)
            .replace(NATIVE, "[SYNTHETIC-NATIVE]")
            .replace(OLD_APP, "[SYNTHETIC-APP]");
        return Err(anyhow!(
            "native split barrier did not arrive; fixture output: {diagnostic}"
        ));
    }
    let prefix = collect_until(service, &terminal.id, b"ENV=unset").await?;
    service
        .write_user_terminal_input(&terminal.id, b"continue\r")
        .await?;
    let live = collect_until(service, &terminal.id, b"LIVE-DONE\n").await?;
    let replay = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await?
        .bytes;
    // Rotation changes only a future launch, never the accepted native/app
    // policy or environment of this already-running terminal.
    store.put("APP_TERMINAL_SYNTHETIC", NEW_APP)?;
    service.write_user_terminal_input(&terminal.id,
        b"case \"$APP_TERMINAL_SYNTHETIC\" in managed-old-*) printf 'OLD-ENV\\n';; *) printf 'WRONG-ENV\\n';; esac; printf 'ROTATED=%s\\n' \"$APP_TERMINAL_SYNTHETIC\"; exec sh -c \"printf 'FINAL-DONE\\n'; printf '%s' 'nac-native-'\"\r",
    ).await?;
    settled(service, &terminal.id).await?;
    let retained = service
        .read_user_terminal_output(&terminal.id, 0, 65536)
        .await?
        .bytes;

    let has = |bytes: &[u8], text: &str| {
        bytes
            .windows(text.len())
            .any(|part| part == text.as_bytes())
    };
    Ok(json!({
        "env_unset": has(&prefix, "ENV=unset"),
        "native_live_masked": !has(&live,NATIVE) && has(&live,"NATIVE=[REDACTED]"),
        "app_live_masked": !has(&live,OLD_APP) && has(&live,"APP=[REDACTED]"),
        "replay_same": replay.starts_with(&live) && !has(&replay,NATIVE) && !has(&replay,OLD_APP),
        "retained_native_masked": !has(&retained,NATIVE),
        "retained_app_masked": !has(&retained,OLD_APP),
        "rotation_immutable": has(&retained,"OLD-ENV") && has(&retained,"ROTATED=[REDACTED]"),
        "eof_safe_suffix": retained.ends_with(b"nac-native-"),
    }))
}

#[test]
fn native_exa_redaction_process_helper() {
    let Some(result_path) = std::env::var_os(HELPER) else {
        return;
    };
    // Before creating any NAC runtime/service, privately capture this child-only
    // synthetic credential and remove its ambient environment value.
    crate::worker_credentials::capture_managed_native_credentials_from_environment().unwrap();
    assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let mut runtime = crate::tools::test_runtime();
        let ordinary = runtime.user_terminal_environment_snapshot().await.unwrap();
        let unmanaged_inert = ordinary.is_empty() && ordinary.redact(NATIVE) == NATIVE;
        runtime.command_environment = Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(None, None, None),
        ));
        let model = runtime.command_environment_snapshot().await.unwrap();
        let human = runtime.user_terminal_environment_snapshot().await.unwrap();
        let native_is_private = human.is_empty() && human.iter().count() == 0
            && human.get(crate::model::EXA_API_KEY_ENV).is_none()
            && !format!("{human:?}").contains(NATIVE)
            && human.redact(NATIVE) == "[REDACTED]"
            && model.redact(NATIVE) == NATIVE;
        let secrets_root = PathBuf::from(&result_path).parent().unwrap().join("managed-secrets");
        let store = nac_managed::HostSecretStore::new(&secrets_root);
        store.put("APP_TERMINAL_SYNTHETIC", OLD_APP).unwrap();
        let (parts, directory) = fixture_with_provider(Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(Some(store.clone()), None, None),
        )));
        let observed = observe(&parts.service, &directory, &store).await;
        // Both helpers and failure assertions run only after owned PTYs settle;
        // never leave native jobs behind for a red masking characterization.
        let cleanup = parts.service.destroy_terminals().await;
        drop(parts);
        let _ = std::fs::remove_dir_all(&directory);
        cleanup.expect("native fixture cleanup failed");
        let mut observed = observed.expect("native fixture observation failed");
        observed["unmanaged_inert"] = json!(unmanaged_inert);
        observed["native_not_environment_debug_or_model_snapshot"] = json!(native_is_private);
        // Construction-time provider binding must remain immutable: use a
        // separate real service to cover native-only, values-empty redaction.
        let (parts, directory) = fixture_with_provider(Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(None, None, None),
        )));
        let empty = async {
            parts.service.set_permission_approval_mode(PermissionApprovalMode::AutoApprove).await?;
            let terminal = parts.service.open_user_terminal(Uuid::new_v4(), 80, 24).await?;
            parts.service.write_user_terminal_input(&terminal.id,
                b"stty -echo -onlcr; PS1=; PROMPT_COMMAND=; printf 'EMPTY-ENV=%s\\n' \"${EXA_API_KEY-unset}\"; printf '%s\\n' 'nac-native-exa-canary'; exec sh -c \"printf 'EMPTY-DONE\\n'\"\r",
            ).await?;
            settled(&parts.service, &terminal.id).await?;
            parts.service.read_user_terminal_output(&terminal.id,0,65536).await.map(|page|page.bytes)
        }.await;
        let cleanup = parts.service.destroy_terminals().await;
        drop(parts);
        let _ = std::fs::remove_dir_all(directory);
        cleanup.expect("native-only fixture cleanup failed");
        let empty = empty.expect("native-only fixture observation failed");
        let has = |text: &str| empty.windows(text.len()).any(|bytes|bytes==text.as_bytes());
        observed["native_only_empty_env_masked"] = json!(!has(NATIVE) && has("[REDACTED]") && has("EMPTY-ENV=unset"));
        std::fs::write(result_path, serde_json::to_vec(&observed).unwrap()).unwrap();
    });
}

#[test]
fn captured_native_exa_is_masked_in_real_managed_human_pty_without_environment_injection() {
    let root = std::env::temp_dir().join(format!("nac-native-redaction-result-{}", Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let result = root.join("result.json");
    // Isolate ambient startup files without altering the product shell command
    // or empty-provider environment semantics. Both bash -c and exec bash -i
    // still launch genuine native Bash through this fixture-owned PATH entry.
    use std::os::unix::fs::PermissionsExt;
    let bin = root.join("bin");
    std::fs::create_dir(&bin).unwrap();
    let bash = bin.join("bash");
    std::fs::write(
        &bash,
        "#!/bin/sh\nexec /bin/bash --noprofile --norc \"$@\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&bash, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let fixture_path = std::env::join_paths(paths).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "session_service::user_terminals::tests::native_redaction::native_exa_redaction_process_helper", "--nocapture"])
        .env(HELPER,&result)
        .env("HOME",&root)
        .env("PATH",fixture_path)
        .env(crate::model::EXA_API_KEY_ENV,NATIVE)
        .output().unwrap();
    let observed = std::fs::read(&result)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let _ = std::fs::remove_dir_all(root);
    assert!(
        output.status.success(),
        "native fixture failed after cleanup: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let observed = observed.expect("native fixture sanitized receipt missing");
    for (requirement, passed) in observed.as_object().unwrap() {
        assert_eq!(
            passed, true,
            "native masking requirement failed: {requirement}"
        );
    }
}
