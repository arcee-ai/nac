//! Optional managed-host product configuration and GitHub integration.
//!
//! This crate is deliberately independent of the agent harness and HTTP
//! delivery. Managed workflows expose narrow application-facing types that the
//! server composition layer wires to core runtime ports.

pub mod clone_workflow;
pub mod configuration;
pub mod github;
pub mod readiness;
