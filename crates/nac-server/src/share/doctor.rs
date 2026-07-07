use std::{net::SocketAddr, path::PathBuf};

use super::{
    config::{
        effective_share_config, load_saved_share_config, normalize_share_config,
        ShareConfigOverrides,
    },
    health::{check_local_health, local_service_url},
    policy::build_ngrok_traffic_policy,
    secrets::{missing_authtoken_message, try_resolve_authtoken},
    security::validate_share_bind,
};

#[derive(Debug, Clone)]
pub struct DoctorOptions {
    pub root_cwd: PathBuf,
    pub bind: SocketAddr,
    pub overrides: ShareConfigOverrides,
    pub authtoken: Option<String>,
    pub check_health: bool,
    pub insecure_bind: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorReport {
    pub checks: Vec<DoctorCheck>,
}

impl DoctorReport {
    pub fn ok(&self) -> bool {
        self.checks.iter().all(|check| check.ok)
    }

    pub fn failure_count(&self) -> usize {
        self.checks.iter().filter(|check| !check.ok).count()
    }
}

pub async fn run_doctor(options: DoctorOptions) -> DoctorReport {
    let mut checks = Vec::new();
    let saved = match load_saved_share_config(&options.root_cwd) {
        Ok(config) => config,
        Err(error) => {
            checks.push(DoctorCheck {
                name: "config".to_string(),
                ok: false,
                detail: error.to_string(),
            });
            return DoctorReport { checks };
        }
    };
    let ngrok = effective_share_config(&saved, &options.overrides);

    checks.push(match normalize_share_config(&ngrok) {
        Ok(_) => DoctorCheck {
            name: "config".to_string(),
            ok: true,
            detail: "ngrok config is valid".to_string(),
        },
        Err(error) => DoctorCheck {
            name: "config".to_string(),
            ok: false,
            detail: error.to_string(),
        },
    });

    checks.push(
        match validate_share_bind(options.bind, options.insecure_bind) {
            Ok(()) => DoctorCheck {
                name: "bind".to_string(),
                ok: true,
                detail: format!("{} is share-safe", options.bind),
            },
            Err(error) => DoctorCheck {
                name: "bind".to_string(),
                ok: false,
                detail: error.to_string(),
            },
        },
    );

    checks.push(
        match try_resolve_authtoken(&options.root_cwd, &ngrok, options.authtoken.as_deref()) {
            Ok(Some(token)) => DoctorCheck {
                name: "authtoken".to_string(),
                ok: true,
                detail: format!("resolved from {}", token.source),
            },
            Ok(None) => DoctorCheck {
                name: "authtoken".to_string(),
                ok: false,
                detail: missing_authtoken_message(&options.root_cwd, &ngrok)
                    .unwrap_or_else(|_| format!("set {}", ngrok.authtoken_env)),
            },
            Err(error) => DoctorCheck {
                name: "authtoken".to_string(),
                ok: false,
                detail: error.to_string(),
            },
        },
    );

    checks.push(match build_ngrok_traffic_policy(&ngrok) {
        Ok(Some(_)) => DoctorCheck {
            name: "auth".to_string(),
            ok: true,
            detail: format!("{} OAuth allowlist configured", ngrok.oauth_provider.trim()),
        },
        Ok(None) => DoctorCheck {
            name: "auth".to_string(),
            ok: true,
            detail: "authentication disabled".to_string(),
        },
        Err(error) => DoctorCheck {
            name: "auth".to_string(),
            ok: false,
            detail: error.to_string(),
        },
    });

    if options.check_health {
        checks.push(match check_local_health(options.bind).await {
            Ok(()) => DoctorCheck {
                name: "local health".to_string(),
                ok: true,
                detail: format!("{}/health is healthy", local_service_url(options.bind)),
            },
            Err(error) => DoctorCheck {
                name: "local health".to_string(),
                ok: false,
                detail: error.to_string(),
            },
        });
    }

    DoctorReport { checks }
}

pub fn format_doctor_report(report: &DoctorReport) -> String {
    let mut output = String::new();
    output.push_str("ngrok share doctor\n");
    for check in &report.checks {
        let status = if check.ok { "ok" } else { "fail" };
        output.push_str(&format!("  [{status}] {}: {}\n", check.name, check.detail));
    }
    output
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::share::{config::NgrokConfig, secrets::save_authtoken_secret};

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_share_doctor_{label}_{unique}"));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn restore_env(name: &str, value: Option<std::ffi::OsString>) {
        unsafe {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }

    fn write_config(root: &std::path::Path, config: &str) -> PathBuf {
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(nac_home.join("config.toml"), config).unwrap();
        nac_home
    }

    #[tokio::test]
    async fn doctor_reports_missing_token_allowlist_and_unsafe_bind() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_token = std::env::var_os("NAC_TEST_NGROK_TOKEN");
        let root = temp_root("doctor_missing");
        let nac_home = write_config(
            &root,
            r#"[ngrok]
authtoken_env = "NAC_TEST_NGROK_TOKEN"
allow_emails = []
allow_domains = []
"#,
        );
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("NAC_TEST_NGROK_TOKEN");
        }

        let report = run_doctor(DoctorOptions {
            root_cwd: root.clone(),
            bind: "0.0.0.0:3210".parse().unwrap(),
            overrides: ShareConfigOverrides::default(),
            authtoken: None,
            check_health: false,
            insecure_bind: false,
        })
        .await;

        assert!(!report.ok());
        assert!(report
            .checks
            .iter()
            .any(|check| check.name == "bind" && !check.ok));
        assert!(report
            .checks
            .iter()
            .any(|check| check.name == "authtoken" && !check.ok));
        assert!(report
            .checks
            .iter()
            .any(|check| check.name == "auth" && !check.ok));

        restore_env("NAC_TEST_NGROK_TOKEN", original_token);
        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn doctor_passes_with_secret_and_no_health_check() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_token = std::env::var_os("NAC_TEST_NGROK_TOKEN");
        let root = temp_root("doctor_ok");
        let nac_home = write_config(
            &root,
            r#"[ngrok]
authtoken_env = "NAC_TEST_NGROK_TOKEN"
allow_emails = ["admin@example.com"]
"#,
        );
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("NAC_TEST_NGROK_TOKEN");
        }
        save_authtoken_secret(&root, "secret-token").unwrap();

        let report = run_doctor(DoctorOptions {
            root_cwd: root.clone(),
            bind: "127.0.0.1:3210".parse().unwrap(),
            overrides: ShareConfigOverrides::default(),
            authtoken: None,
            check_health: false,
            insecure_bind: false,
        })
        .await;

        assert!(report.ok(), "{report:#?}");

        restore_env("NAC_TEST_NGROK_TOKEN", original_token);
        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn format_report_lists_check_status() {
        let report = DoctorReport {
            checks: vec![DoctorCheck {
                name: "config".to_string(),
                ok: true,
                detail: "ngrok config is valid".to_string(),
            }],
        };

        assert!(format_doctor_report(&report).contains("[ok] config"));
        let _ = NgrokConfig::default();
    }
}
