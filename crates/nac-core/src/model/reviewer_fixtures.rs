//! Synthetic native backend fixtures; constructs descriptions, never processes.

pub(super) struct FixtureWorkspace(std::path::PathBuf);

impl FixtureWorkspace {
    pub(super) fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-review-calibration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        std::fs::create_dir(root.join("extra")).unwrap();
        Self(root)
    }

    pub(super) fn execution(&self, backend: &str) -> crate::sandbox::ExecutionBackend {
        use crate::sandbox::{
            ExecutionBackend, MountSpec, SandboxSession, SandboxSpec, SshBackend,
        };
        match backend {
            "local" => ExecutionBackend::Local {
                workspace_cwd: "/workspace".into(),
            },
            "ssh" => {
                ExecutionBackend::Ssh(SshBackend::new("qa.invalid".into(), "/workspace".into()))
            }
            "podman" | "podman_with_host_mounts" => {
                let mut mounts = vec![MountSpec {
                    host: self.0.join("workspace"),
                    guest: "/workspace".into(),
                    read_only: false,
                }];
                if backend == "podman_with_host_mounts" {
                    mounts.push(MountSpec {
                        host: self.0.join("extra"),
                        guest: "/outside".into(),
                        read_only: false,
                    });
                }
                ExecutionBackend::Sandbox(SandboxSession::new_for_test(SandboxSpec {
                    mounts,
                    ..Default::default()
                }))
            }
            _ => panic!("unsupported backend"),
        }
    }
}

impl Drop for FixtureWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir(self.0.join("workspace"));
        let _ = std::fs::remove_dir(self.0.join("extra"));
        let _ = std::fs::remove_dir(&self.0);
    }
}
