use std::env;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PathContext {
    cwd: PathBuf,
}

impl PathContext {
    pub fn new(cwd: impl AsRef<Path>) -> Self {
        Self {
            cwd: cwd.as_ref().to_path_buf(),
        }
    }

    pub fn nac_home_dir(&self) -> Option<PathBuf> {
        if let Some(nac_home) = env::var_os("NAC_HOME") {
            return Some(self.resolve_env_path(nac_home));
        }

        if let Some(xdg_config_home) = env::var_os("XDG_CONFIG_HOME") {
            return Some(self.resolve_env_path(xdg_config_home).join("nac"));
        }

        self.home_dir().map(|home| home.join(".config").join("nac"))
    }

    pub fn nac_config_path(&self) -> Option<PathBuf> {
        self.nac_home_dir().map(|dir| dir.join("config.toml"))
    }

    pub fn home_dir(&self) -> Option<PathBuf> {
        env::var_os("HOME").map(|home| self.resolve_env_path(home))
    }

    fn resolve_env_path(&self, value: OsString) -> PathBuf {
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            self.cwd.join(path)
        }
    }
}

pub fn nac_home_dir() -> Option<PathBuf> {
    if let Some(nac_home) = env::var_os("NAC_HOME") {
        return Some(PathBuf::from(nac_home));
    }

    if let Some(xdg_config_home) = env::var_os("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(xdg_config_home).join("nac"));
    }

    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".config").join("nac"))
}

pub fn nac_config_path() -> Option<PathBuf> {
    nac_home_dir().map(|dir| dir.join("config.toml"))
}
