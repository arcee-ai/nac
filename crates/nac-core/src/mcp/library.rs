//! The MCP library: the catalog the dashboard offers when adding a server,
//! so the popular ones arrive pre-filled instead of hand-typed.
//!
//! Two sources feed it. A curated set is embedded in the binary and always
//! available; the Smithery registry — filtered to verified, remotely hosted
//! servers — extends it when the network allows. The embedded entries win a
//! name collision, so their auth hints survive.

use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

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
    pub id: String,
    /// Display name; also the default server name.
    pub name: String,
    pub description: String,
    /// All current entries are `streamable_http`; stdio ones may appear
    /// later.
    pub transport: String,
    pub url: String,
    pub auth: McpLibraryAuth,
    /// Header the form should prompt for, when auth wants one.
    pub auth_header: Option<String>,
    /// Hint shown next to the header input, e.g. the expected value shape.
    pub auth_hint: Option<String>,
    pub docs_url: String,
    /// Thumbnail shown next to the entry in the picker.
    pub icon_url: Option<String>,
}

/// The curated entries embedded in the binary: available offline, and the
/// only place auth headers and hints are known.
pub fn embedded_library_entries() -> Vec<McpLibraryEntry> {
    fn entry(
        name: &str,
        description: &str,
        url: &str,
        auth: McpLibraryAuth,
        auth_prompt: Option<(&str, &str)>,
        docs_url: &str,
        icon_url: &str,
    ) -> McpLibraryEntry {
        McpLibraryEntry {
            id: name.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            transport: "streamable_http".to_string(),
            url: url.to_string(),
            auth,
            auth_header: auth_prompt.map(|(header, _)| header.to_string()),
            auth_hint: auth_prompt.map(|(_, hint)| hint.to_string()),
            docs_url: docs_url.to_string(),
            icon_url: Some(icon_url.to_string()),
        }
    }

    vec![
        entry(
            "exa",
            "Web search and content extraction built for agents.",
            "https://mcp.exa.ai/mcp",
            McpLibraryAuth::OptionalHeader,
            Some(("x-api-key", "Exa API key; anonymous use is rate limited")),
            "https://docs.exa.ai/reference/exa-mcp",
            "https://exa.ai/favicon.ico",
        ),
        entry(
            "context7",
            "Up-to-date documentation and code examples for libraries.",
            "https://mcp.context7.com/mcp",
            McpLibraryAuth::OptionalHeader,
            Some((
                "CONTEXT7_API_KEY",
                "Context7 API key; anonymous use is rate limited",
            )),
            "https://github.com/upstash/context7",
            "https://context7.com/favicon.ico",
        ),
        entry(
            "deepwiki",
            "Ask questions about public GitHub repositories.",
            "https://mcp.deepwiki.com/mcp",
            McpLibraryAuth::None,
            None,
            "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
            "https://deepwiki.com/favicon.ico",
        ),
        entry(
            "grep_app",
            "Search code across a million public GitHub repositories.",
            "https://mcp.grep.app",
            McpLibraryAuth::None,
            None,
            "https://vercel.com/blog/grep-a-million-github-repositories-via-mcp",
            "https://vercel.com/favicon.ico",
        ),
        entry(
            "github",
            "Repositories, issues and pull requests on GitHub.",
            "https://api.githubcopilot.com/mcp/",
            McpLibraryAuth::RequiredHeader,
            Some(("Authorization", "Bearer <personal access token>")),
            "https://github.com/github/github-mcp-server",
            "https://github.githubassets.com/favicons/favicon-dark.png",
        ),
        entry(
            "huggingface",
            "Models, datasets and Spaces on the Hugging Face Hub.",
            "https://huggingface.co/mcp",
            McpLibraryAuth::OptionalHeader,
            Some((
                "Authorization",
                "Bearer <hf token>; anonymous use is limited",
            )),
            "https://huggingface.co/settings/mcp",
            "https://huggingface.co/favicon.ico",
        ),
        entry(
            "cloudflare_docs",
            "Search the Cloudflare developer documentation.",
            "https://docs.mcp.cloudflare.com/mcp",
            McpLibraryAuth::None,
            None,
            "https://github.com/cloudflare/mcp-server-cloudflare",
            "https://www.cloudflare.com/favicon.ico",
        ),
    ]
}

const SMITHERY_REGISTRY: &str = "https://registry.smithery.ai";
/// How many verified servers the registry is asked for, and the ceiling on
/// per-entry detail requests.
const SMITHERY_PAGE_SIZE: usize = 50;
const SMITHERY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct SmitheryListResponse {
    servers: Vec<SmitheryListedServer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryListedServer {
    qualified_name: String,
    display_name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    remote: bool,
    #[serde(default)]
    verified: bool,
    #[serde(default)]
    use_count: u64,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmitheryServerDetail {
    #[serde(default)]
    deployment_url: Option<String>,
}

/// A qualified name like `upstash/context7-mcp` as a server name: the last
/// path segment, with the characters a name cannot carry mapped to `_`.
fn name_from_qualified(qualified: &str) -> String {
    let segment = qualified.rsplit('/').next().unwrap_or(qualified);
    segment
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

/// Verified, remotely hosted servers from the Smithery registry, most used
/// first. Each needs a second request for its connection URL, so the details
/// are fetched concurrently and an entry that fails is dropped rather than
/// failing the list.
pub async fn fetch_smithery_library_entries() -> Result<Vec<McpLibraryEntry>> {
    let client = reqwest::Client::builder()
        .timeout(SMITHERY_TIMEOUT)
        .build()
        .context("failed to build registry client")?;

    let listing: SmitheryListResponse = client
        .get(format!(
            "{SMITHERY_REGISTRY}/servers?q=is%3Averified&pageSize={SMITHERY_PAGE_SIZE}"
        ))
        .send()
        .await
        .context("failed to reach the Smithery registry")?
        .error_for_status()
        .context("the Smithery registry refused the listing")?
        .json()
        .await
        .context("the Smithery registry listing was not understood")?;

    let mut listed: Vec<SmitheryListedServer> = listing
        .servers
        .into_iter()
        .filter(|server| server.verified && server.remote)
        .collect();
    listed.sort_by_key(|server| std::cmp::Reverse(server.use_count));

    let mut details = JoinSet::new();
    for (position, server) in listed.into_iter().enumerate() {
        let client = client.clone();
        details.spawn(async move {
            let detail: SmitheryServerDetail = client
                .get(format!(
                    "{SMITHERY_REGISTRY}/servers/{}",
                    server.qualified_name.replace('/', "%2F")
                ))
                .send()
                .await
                .ok()?
                .error_for_status()
                .ok()?
                .json()
                .await
                .ok()?;
            let url = detail.deployment_url?;
            Some((
                position,
                McpLibraryEntry {
                    id: format!("smithery:{}", server.qualified_name),
                    name: name_from_qualified(&server.qualified_name),
                    description: if server.description.is_empty() {
                        server.display_name.clone()
                    } else {
                        server.description
                    },
                    transport: "streamable_http".to_string(),
                    url,
                    auth: McpLibraryAuth::None,
                    auth_header: None,
                    auth_hint: None,
                    docs_url: server.homepage.unwrap_or_else(|| {
                        format!("https://smithery.ai/servers/{}", server.qualified_name)
                    }),
                    icon_url: server.icon_url,
                },
            ))
        });
    }

    let mut entries: Vec<(usize, McpLibraryEntry)> = Vec::new();
    while let Some(joined) = details.join_next().await {
        if let Ok(Some(entry)) = joined {
            entries.push(entry);
        }
    }
    entries.sort_by_key(|(position, _)| *position);
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

/// The full catalog: the embedded entries, extended by whatever the registry
/// answered. An embedded entry wins a name collision so its auth hints
/// survive; the registry failing costs only its own entries.
pub fn merge_library_entries(remote: Vec<McpLibraryEntry>) -> Vec<McpLibraryEntry> {
    let mut entries = embedded_library_entries();
    for entry in remote {
        if entries.iter().any(|existing| existing.name == entry.name) {
            continue;
        }
        entries.push(entry);
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualified_names_become_server_names() {
        assert_eq!(name_from_qualified("upstash/context7-mcp"), "context7_mcp");
        assert_eq!(name_from_qualified("exa"), "exa");
        assert_eq!(name_from_qualified("theagenttimes/news"), "news");
    }

    #[test]
    fn embedded_entries_win_name_collisions() {
        let remote = vec![
            McpLibraryEntry {
                id: "smithery:exa".to_string(),
                name: "exa".to_string(),
                description: "shadowed".to_string(),
                transport: "streamable_http".to_string(),
                url: "https://exa.run.tools".to_string(),
                auth: McpLibraryAuth::None,
                auth_header: None,
                auth_hint: None,
                docs_url: "https://smithery.ai/servers/exa".to_string(),
                icon_url: None,
            },
            McpLibraryEntry {
                id: "smithery:acme/tool".to_string(),
                name: "tool".to_string(),
                description: "kept".to_string(),
                transport: "streamable_http".to_string(),
                url: "https://tool.run.tools".to_string(),
                auth: McpLibraryAuth::None,
                auth_header: None,
                auth_hint: None,
                docs_url: "https://smithery.ai/servers/acme/tool".to_string(),
                icon_url: None,
            },
        ];
        let merged = merge_library_entries(remote);
        let exa = merged.iter().find(|entry| entry.name == "exa").unwrap();
        assert_eq!(exa.id, "exa");
        assert!(merged.iter().any(|entry| entry.name == "tool"));
    }
}
