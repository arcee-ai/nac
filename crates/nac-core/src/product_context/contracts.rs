//! Sanitized application facts and logical destinations; no transport or UI selectors.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ProductAvailability {
    Available,
    Disabled,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ProductDestination {
    Projects,
    McpSettings,
    Configurations,
    ModelAuthentication,
    SshConfigurations,
    SessionSubagents,
    SessionFiles,
    SessionTerminal,
    SessionHistory,
}

impl ProductDestination {
    pub const ALL: [Self; 9] = [
        Self::Projects,
        Self::McpSettings,
        Self::Configurations,
        Self::ModelAuthentication,
        Self::SshConfigurations,
        Self::SessionSubagents,
        Self::SessionFiles,
        Self::SessionTerminal,
        Self::SessionHistory,
    ];

    pub fn is_session(self) -> bool {
        matches!(
            self,
            Self::SessionSubagents
                | Self::SessionFiles
                | Self::SessionTerminal
                | Self::SessionHistory
        )
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Projects => "Projects",
            Self::McpSettings => "MCP settings",
            Self::Configurations => "Configurations",
            Self::ModelAuthentication => "Model authentication",
            Self::SshConfigurations => "SSH configurations",
            Self::SessionSubagents => "Subagents",
            Self::SessionFiles => "Files",
            Self::SessionTerminal => "Terminal",
            Self::SessionHistory => "History",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductBuild {
    pub product_version: String,
    pub build_id: String,
    pub track: String,
    pub source_revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductCapability {
    pub availability: ProductAvailability,
    /// A count is present only when observed in this bound runtime.
    #[cfg_attr(feature = "openapi", schema(required))]
    pub count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductSessionContext {
    pub session_id: String,
    pub behavior: crate::sessions::SessionBehavior,
    /// Construction-time execution backend, never the model provider.
    pub execution_backend: ProductExecutionBackend,
    pub skills: ProductCapability,
    pub tools: ProductCapability,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ProductExecutionBackend {
    Local,
    Ssh,
    Podman,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductDestinationInfo {
    pub destination: ProductDestination,
    pub label: String,
    pub availability: ProductAvailability,
    pub steps: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ProductFeatureKind {
    TraditionalSubagents,
    ManagedOrchestrators,
    ManagedHost,
    ProductNavigation,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductFeature {
    pub feature: ProductFeatureKind,
    pub label: String,
    pub availability: ProductAvailability,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductContext {
    pub schema_version: u32,
    pub build: ProductBuild,
    /// Source identity for facts, distinct from a future Guide document reference.
    pub source: String,
    pub managed: bool,
    pub features: Vec<ProductFeature>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub session: Option<ProductSessionContext>,
    /// Host dashboard readiness, not session tool authorization or connectivity.
    pub mcp: ProductCapability,
    pub destinations: Vec<ProductDestinationInfo>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct ProductNavigationRequest {
    pub destination: ProductDestination,
    pub session_id: Option<String>,
    pub expected_build_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ProductNavigationResolution {
    pub build: ProductBuild,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub session_id: Option<String>,
    pub target: ProductDestinationInfo,
    /// Resolution never claims that a browser opened anything.
    pub opened: bool,
}
