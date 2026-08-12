#[cfg(test)]
use std::sync::Mutex;

mod agent;
mod agents_md;
pub mod browser;
pub mod commands;
pub mod events;
mod mcp;
pub mod model;

/// Named, reusable model setups the launch UI offers instead of asking for a
/// backend, model and base URL every time.
pub mod model_configurations {
    pub use crate::store::{
        delete_model_configuration, insert_model_configuration, list_model_configurations,
        load_model_configuration, update_model_configuration, ModelConfigurationRecord,
        ModelConfigurationStoreError, NewModelConfiguration,
    };
}

/// Named, reusable SSH connections the launch UI offers instead of asking for a
/// host, port and identity file every time.
pub mod ssh_configurations {
    pub use crate::store::{
        delete_ssh_configuration, insert_ssh_configuration, list_ssh_configurations,
        load_ssh_configuration, update_ssh_configuration, NewSshConfiguration,
        SshConfigurationRecord, SshConfigurationStoreError,
    };
}

mod paths;
mod process;
pub mod runtime;
mod sandbox;
pub mod session_service;
pub mod sessions;
mod skills;
pub mod store;
mod terminal;
#[cfg(test)]
mod test_utils;
mod tools;
pub mod types;
pub mod upgrade;
pub mod view;
mod worker;
pub mod workspace;

/// Largest token count that can be persisted exactly and transported through
/// JavaScript-backed public settings without precision loss.
pub const MAX_SUPPORTED_TOKEN_COUNT: u64 = 9_007_199_254_740_991;

#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    pub mod fixture_sessions {
        pub use crate::sessions::*;
    }

    pub mod fixture_store {
        pub use crate::store::*;
    }

    pub use fixture_sessions as sessions;
    pub use fixture_store as store;
}

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());
