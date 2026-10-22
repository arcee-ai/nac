//! Retained operator capacity policy, separate from execution authority.
//!
//! This small inward dependency lets Core and Native retain the SAME protected
//! configuration source without Core depending on the Native transport. It
//! constructs no ledger, runtime, session, grant or positive boundary. Parsed
//! values and matching strings cannot establish original lifecycle ownership.
mod configuration;
pub use configuration::{Configuration, DeploymentScope, EndpointLimits, Layout, ScopeLimits};

#[cfg(unix)]
mod source;
#[cfg(unix)]
pub use source::{PolicyOwner, PolicyPins, PolicyRetirement, PolicySource};

#[cfg(all(test, unix))]
mod tests;
