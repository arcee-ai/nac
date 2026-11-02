//! Minimal launch-environment contracts, independent of AppKit qualification.
#![cfg(unix)]

use crate::{
    model::resolve_named_api_key,
    paths::PathContext,
    runtime::{resolve_store_path_for_track, NacConfig, StoreOptions},
    store::StoreTrack,
};
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn finder_and_terminal_profiles_keep_existing_config_store_and_credential_owners() {
    let fixture =
        Fixture(std::env::temp_dir().join(format!("nac finder {}", uuid::Uuid::new_v4())));
    let bootstrap = fixture.0.join("bootstrap with spaces");
    fs::create_dir_all(&bootstrap).unwrap();
    let bootstrap = bootstrap.canonicalize().unwrap();
    for profile in [
        "nac-absolute",
        "nac-relative",
        "xdg-absolute",
        "xdg-relative",
        "home",
        "no-home",
    ] {
        let expected_home = match profile {
            "nac-absolute" | "nac-relative" => bootstrap.join("explicit nac"),
            "xdg-absolute" | "xdg-relative" => bootstrap.join("custom xdg/nac"),
            "home" => bootstrap.join("user home/.config/nac"),
            _ => bootstrap.join("unused"),
        };
        fs::create_dir_all(&expected_home).unwrap();
        fs::write(
            expected_home.join("config.toml"),
            "[worker]\nthread_timeout_secs = 342\n",
        )
        .unwrap();
        let credential = expected_home.join("credentials.json");
        fs::write(
            &credential,
            r#"{"api_keys":{"FINDER_FIXTURE_KEY":"disposable-finder-fixture"}}"#,
        )
        .unwrap();
        fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();
        // Legacy selection must be observational: never copy, migrate or rename.
        fs::write(expected_home.join("store.db"), b"legacy canary").unwrap();
        for terminal in [false, true] {
            let mut child = Command::new(std::env::current_exe().unwrap());
            child
                .env_clear()
                .current_dir(&bootstrap)
                .args([
                    "--exact",
                    "paths::tests::finder_profile_child",
                    "--nocapture",
                ])
                .env("FINDER_PROFILE", profile)
                .env("FINDER_EXPECTED_HOME", &expected_home)
                .env(
                    "PATH",
                    if terminal {
                        "/custom tools:/usr/bin:/bin"
                    } else {
                        "/usr/bin:/bin"
                    },
                );
            if profile != "no-home" {
                child.env("HOME", bootstrap.join("user home"));
            }
            match profile {
                "nac-absolute" => {
                    child
                        .env("NAC_HOME", &expected_home)
                        .env("XDG_CONFIG_HOME", "ignored xdg");
                }
                "nac-relative" => {
                    child
                        .env("NAC_HOME", "explicit nac")
                        .env("XDG_CONFIG_HOME", "ignored xdg");
                }
                "xdg-absolute" => {
                    child.env("XDG_CONFIG_HOME", bootstrap.join("custom xdg"));
                }
                "xdg-relative" => {
                    child.env("XDG_CONFIG_HOME", "custom xdg");
                }
                _ => {}
            }
            let output = child.output().unwrap();
            assert!(
                output.status.success(),
                "{profile}, terminal={terminal}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(!String::from_utf8_lossy(&output.stdout).contains("disposable-finder-fixture"));
        }
        assert_eq!(
            fs::read(expected_home.join("store.db")).unwrap(),
            b"legacy canary"
        );
        assert!(!expected_home.join("stable.db").exists());
    }
}

#[test]
fn finder_profile_child() {
    let Ok(profile) = std::env::var("FINDER_PROFILE") else {
        return;
    };
    let bootstrap = std::env::current_dir().unwrap();
    let expected_home = PathBuf::from(std::env::var_os("FINDER_EXPECTED_HOME").unwrap());
    let paths = PathContext::new(&bootstrap);
    let config = NacConfig::load_without_model_from_cwd(&bootstrap).unwrap();
    if profile == "no-home" {
        assert_eq!(paths.nac_home_dir(), None);
        assert_eq!(
            resolve_store_path_for_track(
                &bootstrap,
                StoreOptions::default(),
                &config,
                StoreTrack::Dev
            ),
            bootstrap.join(".nac/dev.db")
        );
        return;
    }
    assert_eq!(paths.nac_home_dir(), Some(expected_home.clone()));
    assert_eq!(config.worker.thread_timeout_secs, Some(342));
    assert_eq!(
        resolve_named_api_key("FINDER_FIXTURE_KEY")
            .unwrap()
            .as_deref(),
        Some("disposable-finder-fixture")
    );
    for (track, file) in [
        (StoreTrack::Dev, "dev.db"),
        (StoreTrack::Beta, "beta.db"),
        (StoreTrack::Stable, "store.db"),
    ] {
        assert_eq!(
            resolve_store_path_for_track(&bootstrap, StoreOptions::default(), &config, track),
            expected_home.join(file)
        );
        assert_eq!(
            resolve_store_path_for_track(
                &bootstrap,
                StoreOptions {
                    store_path: Some("override with spaces.db".into())
                },
                &config,
                track
            ),
            bootstrap.join("override with spaces.db")
        );
    }
    fs::write(
        expected_home.join("config.toml"),
        "[storage]\nstore_path = 'configured store.db'\n",
    )
    .unwrap();
    let configured = NacConfig::load_without_model_from_cwd(&bootstrap).unwrap();
    assert_eq!(
        resolve_store_path_for_track(
            &bootstrap,
            StoreOptions::default(),
            &configured,
            StoreTrack::Stable
        ),
        bootstrap.join("configured store.db")
    );
    fs::write(
        expected_home.join("config.toml"),
        "[worker]\nthread_timeout_secs = 342\n",
    )
    .unwrap();
    // The ordinary hardened reader, including its mode policy, remains active.
    fs::set_permissions(
        expected_home.join("credentials.json"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert!(resolve_named_api_key("FINDER_FIXTURE_KEY").is_err());
    fs::set_permissions(
        expected_home.join("credentials.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
}
