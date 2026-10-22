pub(crate) mod admitted_session_publication;
pub(crate) mod admitted_session_publication_work;
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "trusted configured-location composition and Core factory are not installed"
    )
)]
pub(crate) mod configured_working_locations;
pub(crate) mod create_terminal;
pub(crate) mod create_transfer;
pub(crate) mod credentials;
pub(crate) mod delegation;
pub(crate) mod managed;
#[cfg(target_os = "linux")]
pub(crate) mod managed_create_attempts;
pub(crate) mod managed_create_producer;
pub(crate) mod managed_create_request;
pub(crate) mod managed_locations;
pub(crate) mod model_catalog;
pub(crate) mod model_configurations;
pub(crate) mod persistence;
pub(crate) mod prepared_location_custody;
pub(crate) mod projects;
pub(crate) mod public_session_creation;
pub(crate) mod publication_tasks;
pub(crate) mod request_validation;
pub(crate) mod session_attachment;
pub(crate) mod session_configuration;
pub(crate) mod session_creation;
pub(crate) mod session_lifecycle;
pub(crate) mod session_observation;
pub(crate) mod session_runs;
pub(crate) mod session_terminals;
pub(crate) mod sessions;
pub(crate) mod shell_commands;
pub(crate) mod ssh_configurations;
pub(crate) mod terminal_observation;
pub(crate) mod terminal_selection;
pub(crate) mod workspace;

/// Application-level tri-state update semantics. Delivery adapters map their
/// wire representation into this type before invoking a use case.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) enum Field<T> {
    #[default]
    Unchanged,
    Clear,
    Set(T),
}

pub(crate) mod execution_history;
pub(crate) mod execution_observation;

pub(crate) mod terminal_control;

mod managed_create_resources;
