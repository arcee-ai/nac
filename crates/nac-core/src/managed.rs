//! Compatibility re-exports for managed-host configuration.
//!
//! New managed-product code belongs in `nac-managed`; this module remains
//! temporarily to avoid breaking existing Rust consumers during migration.

pub use nac_managed::configuration::*;
