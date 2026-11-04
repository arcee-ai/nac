#[path = "../../scripts/build-identity.rs"]
mod build_identity;

fn main() {
    println!("cargo:rerun-if-changed=assets");
    #[cfg(feature = "native-auth-fixture")]
    {
        let build_id = std::env::var("NAC_BUILD_ID").unwrap_or_default();
        assert!(
            std::env::var("NAC_BUILD_TRACK").ok().as_deref() == Some("dev")
                && build_id
                    .strip_prefix("native-auth-fixture-v1-")
                    .is_some_and(|suffix| !suffix.trim().is_empty()),
            "native auth fixture builds require explicit dev track and auth-prefixed NAC_BUILD_ID"
        );
    }
    build_identity::configure();
}
