#[cfg(test)]
use std::sync::Mutex;

mod agent;
mod agents_md;
pub mod browser;
pub mod commands;
pub mod events;
pub mod light_model;
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

/// Store-scoped project metadata, creation defaults, and session association.
pub mod projects {
    pub use crate::store::{
        assign_session_to_project, delete_project, insert_project, list_projects,
        load_project_launch_context, reorder_projects, update_project, NewProject,
        ProjectLaunchContext, ProjectPatch, ProjectRecord, ProjectStoreError,
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

/// Named MCP servers the dashboard manages, plus the library catalog it offers
/// when adding one. The dashboard edits `config.toml` directly; sessions parse
/// the file when a worker launches.
pub mod mcp_configurations {
    pub use crate::mcp::{
        delete_mcp_server_configuration, embedded_library_entries, fetch_smithery_library_entries,
        insert_mcp_server_configuration, list_mcp_server_configurations,
        load_mcp_server_configuration, mcp_config_path, merge_library_entries, probe_mcp_server,
        update_mcp_server_configuration, McpLibraryAuth, McpLibraryEntry, McpProbedTool,
        McpServerConfig, McpServerConfigurationRecord, McpServerConfigurationStoreError,
        McpTransportConfig, MCP_TRANSPORT_STDIO, MCP_TRANSPORT_STREAMABLE_HTTP,
    };
}

/// User-facing metadata for skills discovered by a session.
pub mod skill_catalog {
    pub use crate::skills::SkillCatalogEntry;
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
mod tool_content;
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
