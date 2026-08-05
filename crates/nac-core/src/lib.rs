#[cfg(test)]
use std::sync::Mutex;

mod agent;
mod agents_md;
pub mod commands;
pub mod events;
mod mcp;
pub mod model;
mod paths;
mod process;
pub mod runtime;
mod sandbox;
pub mod session_service;
pub mod sessions;
mod skills;
mod store;
mod terminal;
mod tools;
pub mod types;
pub mod upgrade;
pub mod view;
mod worker;

pub use store::initialize as initialize_store;

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
