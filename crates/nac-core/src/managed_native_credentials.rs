//! Managed native credential capture, redaction, and process hardening.

use std::io;
use std::sync::OnceLock;

/// Prevent same-UID descendants from inspecting this process through ordinary
/// Linux ptrace/procfs interfaces, and prevent later execs from acquiring new
/// privilege. A process with pre-existing `CAP_SYS_PTRACE` remains outside this
/// in-process boundary and must be excluded by deployment policy.
pub fn restrict_same_uid_inspection() -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: both prctl operations take integer flags and no pointers.
        if unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
        // Executing an ordinary binary resets dumpability, so this function is
        // called independently by the server and each managed worker.
        // SAFETY: PR_SET_DUMPABLE takes an integer flag and no pointers.
        if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

#[derive(Clone, Default, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ManagedNativeCredentials {
    exa_api_key: Option<String>,
}

static MANAGED_NATIVE_CREDENTIALS: OnceLock<ManagedNativeCredentials> = OnceLock::new();

/// Capture native integration credentials before managed server construction
/// and remove them from the generic process environment. Only the native web
/// capability and the private worker transport can consult this snapshot.
pub fn capture_managed_native_credentials_from_environment() -> io::Result<()> {
    let credentials = ManagedNativeCredentials::read_process_environment()?;
    if let Some(existing) = MANAGED_NATIVE_CREDENTIALS.get() {
        if existing != &credentials {
            return Err(io::Error::other(
                "managed native credentials were already captured",
            ));
        }
    } else {
        let _ = MANAGED_NATIVE_CREDENTIALS.set(credentials);
    }
    // SAFETY: managed startup calls this before constructing the SessionManager,
    // MCP registries, refresh tasks, or any other application threads.
    unsafe { std::env::remove_var(crate::model::EXA_API_KEY_ENV) };
    Ok(())
}

pub(crate) fn managed_exa_api_key() -> Option<String> {
    MANAGED_NATIVE_CREDENTIALS
        .get()
        .and_then(|credentials| credentials.exa_api_key.clone())
}

/// Output-only patterns from the already captured private snapshot. Never
/// consult ambient credentials or forward these values into child environments.
pub(crate) fn captured_managed_native_redactions() -> Vec<String> {
    MANAGED_NATIVE_CREDENTIALS
        .get()
        .map(ManagedNativeCredentials::exact_redactions)
        .unwrap_or_default()
}

impl ManagedNativeCredentials {
    pub(crate) fn from_process_environment() -> io::Result<Self> {
        if let Some(credentials) = MANAGED_NATIVE_CREDENTIALS.get() {
            return Ok(credentials.clone());
        }
        Self::read_process_environment()
    }

    fn read_process_environment() -> io::Result<Self> {
        let exa_api_key = std::env::var_os(crate::model::EXA_API_KEY_ENV)
            .map(|value| {
                value.into_string().map_err(|_| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        "EXA_API_KEY is not valid Unicode",
                    )
                })
            })
            .transpose()?
            .filter(|value| !value.trim().is_empty());
        Ok(Self { exa_api_key })
    }

    pub(crate) fn exact_redactions(&self) -> Vec<String> {
        self.exa_api_key.iter().cloned().collect()
    }

    pub(crate) fn into_exa_api_key(self) -> Option<String> {
        self.exa_api_key
    }

    pub(crate) fn from_exa_api_key(exa_api_key: Option<String>) -> Self {
        Self { exa_api_key }
    }

    #[cfg(test)]
    pub(crate) fn for_test(exa_api_key: Option<&str>) -> Self {
        Self {
            exa_api_key: exa_api_key.map(str::to_string),
        }
    }
}
