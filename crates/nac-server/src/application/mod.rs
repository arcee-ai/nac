pub(crate) mod credentials;
pub(crate) mod delegation;
pub(crate) mod managed;
pub(crate) mod model_configurations;
pub(crate) mod projects;
pub(crate) mod session_attachment;
pub(crate) mod session_configuration;
pub(crate) mod session_lifecycle;
pub(crate) mod session_runs;
pub(crate) mod sessions;
pub(crate) mod ssh_configurations;
pub(crate) mod workspace;

/// Application-level tri-state update semantics. Delivery adapters map their
/// wire representation into this type before invoking a use case.
pub(crate) enum Field<T> {
    Unchanged,
    Clear,
    Set(T),
}
