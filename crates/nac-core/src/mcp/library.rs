//! The MCP library: a curated catalog the dashboard offers when adding a
//! server, so the popular ones arrive pre-filled instead of hand-typed.
//!
//! TODO(remote index): the catalog is embedded in the binary for now. It will
//! later be fetched from a remote index so new servers can appear without a
//! nac release; keep this module the single source so only the loading side
//! has to change.

use serde::Serialize;

/// What a library server needs before it can connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpLibraryAuth {
    /// Works as-is.
    None,
    /// Works without the header, better with it.
    OptionalHeader,
    /// Refuses to answer without the header.
    RequiredHeader,
}

/// One catalog entry. Every field feeds the add-server form: the entry is a
/// pre-fill, never a hidden configuration — what is saved is exactly what the
/// form shows.
#[derive(Debug, Clone, Serialize)]
pub struct McpLibraryEntry {
    /// Stable identifier, recorded on servers created from the entry.
    pub id: &'static str,
    /// Display name; also the default server name.
    pub name: &'static str,
    pub description: &'static str,
    /// All current entries are `streamable_http`; a remote index may add
    /// stdio ones later.
    pub transport: &'static str,
    pub url: &'static str,
    pub auth: McpLibraryAuth,
    /// Header the form should prompt for, when auth wants one.
    pub auth_header: Option<&'static str>,
    /// Hint shown next to the header input, e.g. the expected value shape.
    pub auth_hint: Option<&'static str>,
    pub docs_url: &'static str,
}

pub fn library_entries() -> &'static [McpLibraryEntry] {
    LIBRARY
}

const LIBRARY: &[McpLibraryEntry] = &[
    McpLibraryEntry {
        id: "exa",
        name: "exa",
        description: "Web search and content extraction built for agents.",
        transport: "streamable_http",
        url: "https://mcp.exa.ai/mcp",
        auth: McpLibraryAuth::OptionalHeader,
        auth_header: Some("x-api-key"),
        auth_hint: Some("Exa API key; anonymous use is rate limited"),
        docs_url: "https://docs.exa.ai/reference/exa-mcp",
    },
    McpLibraryEntry {
        id: "context7",
        name: "context7",
        description: "Up-to-date documentation and code examples for libraries.",
        transport: "streamable_http",
        url: "https://mcp.context7.com/mcp",
        auth: McpLibraryAuth::OptionalHeader,
        auth_header: Some("CONTEXT7_API_KEY"),
        auth_hint: Some("Context7 API key; anonymous use is rate limited"),
        docs_url: "https://github.com/upstash/context7",
    },
    McpLibraryEntry {
        id: "deepwiki",
        name: "deepwiki",
        description: "Ask questions about public GitHub repositories.",
        transport: "streamable_http",
        url: "https://mcp.deepwiki.com/mcp",
        auth: McpLibraryAuth::None,
        auth_header: None,
        auth_hint: None,
        docs_url: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
    },
    McpLibraryEntry {
        id: "grep_app",
        name: "grep_app",
        description: "Search code across a million public GitHub repositories.",
        transport: "streamable_http",
        url: "https://mcp.grep.app",
        auth: McpLibraryAuth::None,
        auth_header: None,
        auth_hint: None,
        docs_url: "https://vercel.com/blog/grep-a-million-github-repositories-via-mcp",
    },
    McpLibraryEntry {
        id: "github",
        name: "github",
        description: "Repositories, issues and pull requests on GitHub.",
        transport: "streamable_http",
        url: "https://api.githubcopilot.com/mcp/",
        auth: McpLibraryAuth::RequiredHeader,
        auth_header: Some("Authorization"),
        auth_hint: Some("Bearer <personal access token>"),
        docs_url: "https://github.com/github/github-mcp-server",
    },
    McpLibraryEntry {
        id: "huggingface",
        name: "huggingface",
        description: "Models, datasets and Spaces on the Hugging Face Hub.",
        transport: "streamable_http",
        url: "https://huggingface.co/mcp",
        auth: McpLibraryAuth::OptionalHeader,
        auth_header: Some("Authorization"),
        auth_hint: Some("Bearer <hf token>; anonymous use is limited"),
        docs_url: "https://huggingface.co/settings/mcp",
    },
    McpLibraryEntry {
        id: "cloudflare_docs",
        name: "cloudflare_docs",
        description: "Search the Cloudflare developer documentation.",
        transport: "streamable_http",
        url: "https://docs.mcp.cloudflare.com/mcp",
        auth: McpLibraryAuth::None,
        auth_header: None,
        auth_hint: None,
        docs_url: "https://github.com/cloudflare/mcp-server-cloudflare",
    },
];
