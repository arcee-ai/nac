use std::env;
use std::path::PathBuf;

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
