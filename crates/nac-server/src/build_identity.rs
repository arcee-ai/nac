//! Compile-time NAC product and immutable build identity.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BuildIdentity {
    pub(crate) product_version: &'static str,
    pub(crate) build_id: &'static str,
    pub(crate) track: &'static str,
    pub(crate) source_revision: &'static str,
}

pub(crate) const fn current() -> BuildIdentity {
    BuildIdentity {
        product_version: env!("NAC_PRODUCT_VERSION"),
        build_id: env!("NAC_BUILD_ID"),
        track: env!("NAC_BUILD_TRACK"),
        source_revision: env!("NAC_SOURCE_REVISION"),
    }
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
        assert!(matches!(identity.track, "dev" | "beta" | "stable"));
        assert!(!identity.build_id.is_empty());
        assert!(!identity.source_revision.is_empty());
    }
}
