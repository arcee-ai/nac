//! Optional managed-host product configuration and GitHub integration.
//!
//! This crate is deliberately independent of the agent harness and HTTP
//! delivery. Managed workflows expose narrow application-facing types that the
//! server composition layer wires to core runtime ports.

mod clone_operation_store;
mod clone_process;
mod clone_workflow;
mod configuration;
mod github;
mod github_credential_store;
mod readiness;

pub use clone_workflow::{
    ManagedCloneOperation, ManagedCloneRequest, ManagedCloneService, ManagedCloneStatus,
    ProjectRegistrar,
};
pub use configuration::{
    is_reserved_environment_name, is_valid_environment_name, CommandEnvironmentSnapshot,
    HostSecretStore, HostSecretSummary, ManagedCommandEnvironmentProvider, ManagedHostConfig,
    ManagedModelCredentialSource, MANAGED_CONFIG_VERSION, MAX_HOST_SECRETS,
    MAX_HOST_SECRET_TOTAL_BYTES, MAX_HOST_SECRET_VALUE_BYTES,
};
pub use github::{
    GitHubAccessToken, GitHubAuthError, GitHubAuthFailureKind, GitHubConnectionStatus,
    GitHubDeviceLogin, GitHubDevicePrompt, GitHubEndpoints, GitHubRepository, ManagedGitHubAuth,
};
pub use readiness::{host_checks, ReadinessCheck};
