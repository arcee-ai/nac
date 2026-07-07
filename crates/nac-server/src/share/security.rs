use std::net::SocketAddr;

use anyhow::{bail, Result};

pub fn validate_share_bind(bind: SocketAddr, insecure_bind: bool) -> Result<()> {
    if bind.ip().is_loopback() || insecure_bind {
        return Ok(());
    }
    bail!(
        "share mode refuses to bind non-loopback address {bind}; use --insecure-bind only if another network boundary protects this server"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_bind_is_allowed_by_default() {
        validate_share_bind("127.0.0.1:3210".parse().unwrap(), false).unwrap();
        validate_share_bind("[::1]:3210".parse().unwrap(), false).unwrap();
    }

    #[test]
    fn wildcard_bind_requires_explicit_insecure_opt_in() {
        let error = validate_share_bind("0.0.0.0:3210".parse().unwrap(), false).unwrap_err();
        assert!(error.to_string().contains("--insecure-bind"));
        validate_share_bind("0.0.0.0:3210".parse().unwrap(), true).unwrap();
    }
}
