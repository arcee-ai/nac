use std::collections::{BTreeMap, HashMap};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::header::{HeaderName, HeaderValue};
use rmcp::handler::client::ClientHandler;
use rmcp::model::{CallToolRequestParams, ClientInfo, Implementation, ListRootsResult, Root, Tool};
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::{
    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
};
use rmcp::ServiceExt;
use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;
use url::Url;

use crate::paths::nac_config_path;
use crate::sandbox::SandboxSession;
use crate::tools::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

mod config;
mod naming;
mod registry;
mod result;
mod transport;

pub use registry::McpRegistry;

use config::*;
use naming::*;
use registry::*;
use result::*;
use transport::*;

type McpService = RunningService<RoleClient, NacMcpClientHandler>;
const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_INVENTORY_TIMEOUT: Duration = Duration::from_secs(15);
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn sanitize_identifier_collapses_symbols() {
        assert_eq!(sanitize_identifier("GitHub.com"), "github_com");
        assert_eq!(sanitize_identifier("search/issues"), "search_issues");
    }

    #[test]
    fn env_expansion_replaces_placeholders() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original = env::var("NAC_MCP_TEST").ok();
        unsafe {
            env::set_var("NAC_MCP_TEST", "expanded");
        }

        let expanded = expand_env("Bearer ${NAC_MCP_TEST}").unwrap();
        assert_eq!(expanded, "Bearer expanded");

        if let Some(value) = original {
            unsafe {
                env::set_var("NAC_MCP_TEST", value);
            }
        } else {
            unsafe {
                env::remove_var("NAC_MCP_TEST");
            }
        }
    }

    #[test]
    fn allocate_tool_name_suffixes_collisions() {
        let mut seen = HashMap::new();
        assert_eq!(
            allocate_tool_name("github", "search/issues", &mut seen),
            "mcp__github__search_issues"
        );
        assert_eq!(
            allocate_tool_name("github", "search-issues", &mut seen),
            "mcp__github__search_issues__2"
        );
    }

    #[test]
    fn tool_definition_uses_namespaced_name() {
        let tool = Tool::new(
            "search_issues",
            "Search issues",
            serde_json::Map::<String, Value>::new(),
        );
        let definition = tool_definition("mcp__github__search_issues", "github", &tool);
        assert_eq!(definition.function.name, "mcp__github__search_issues");
        assert_eq!(definition.function.description, "Search issues");
    }

    #[tokio::test]
    async fn invalid_global_config_disables_mcp_instead_of_failing() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_nac_home = env::var_os("NAC_HOME");
        let original_xdg = env::var_os("XDG_CONFIG_HOME");
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let nac_home = std::env::temp_dir().join(format!("nac-mcp-test-{unique}"));
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(nac_home.join("config.toml"), "=\n").unwrap();

        unsafe {
            env::set_var("NAC_HOME", &nac_home);
        }

        let cwd = std::env::current_dir().unwrap();
        let registry = McpRegistry::load(&cwd, None).await.unwrap();
        assert!(registry.is_none());

        if let Some(value) = original_nac_home {
            unsafe {
                env::set_var("NAC_HOME", value);
            }
        } else {
            unsafe {
                env::remove_var("NAC_HOME");
            }
        }

        if let Some(value) = original_xdg {
            unsafe {
                env::set_var("XDG_CONFIG_HOME", value);
            }
        } else {
            unsafe {
                env::remove_var("XDG_CONFIG_HOME");
            }
        }

        let _ = fs::remove_dir_all(&nac_home);
    }
}
