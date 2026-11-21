//! Running-executable identity for user-facing commands and descendants.

use std::path::PathBuf;

use anyhow::{Context, Result};

pub(crate) fn running_invocation_name() -> String {
    #[cfg(test)]
    {
        "nac-web".to_string()
    }
    #[cfg(not(test))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "nac-web".to_string())
    }
}

pub(crate) fn running_executable() -> Result<PathBuf> {
    std::env::current_exe().context("failed to resolve current executable")
}

#[cfg(test)]
mod tests {
    #[test]
    fn credential_helper_uses_the_running_executable() {
        assert_eq!(
            super::running_executable().unwrap(),
            std::env::current_exe().unwrap()
        );
    }
}
