//! Compile-time NAC product and immutable build identity.

pub(crate) use nac_contracts::BuildIdentity;

pub(crate) const fn current() -> BuildIdentity {
    nac_contracts::build_identity()
}

pub(crate) fn store_track() -> nac_core::store::StoreTrack {
    match current().track {
        "beta" => nac_core::store::StoreTrack::Beta,
        "stable" => nac_core::store::StoreTrack::Stable,
        _ => nac_core::store::StoreTrack::Dev,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_identity_is_complete_and_uses_root_product_version() {
        let identity = current();
        assert_eq!(
            identity.product_version,
            include_str!("../../../version.txt").trim()
        );
        assert_eq!(identity.product_version, nac_contracts::PRODUCT_VERSION);
        assert_eq!(identity.build_id, env!("NAC_BUILD_ID"));
        assert_eq!(identity.track, env!("NAC_BUILD_TRACK"));
        assert_eq!(identity.source_revision, env!("NAC_SOURCE_REVISION"));
        assert!(matches!(identity.track, "dev" | "beta" | "stable"));
        assert!(!identity.build_id.is_empty());
        assert!(!identity.source_revision.is_empty());
    }
}
