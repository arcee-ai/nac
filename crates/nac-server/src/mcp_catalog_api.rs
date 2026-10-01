//! Curated MCP library delivery and refresh cache.

use std::time::{Duration, Instant};

use axum::Json;
use nac_core::mcp_configurations as mcp;

use crate::mcp_api::McpLibraryResponse;

/// How long a registry answer keeps serving before the next request refetches
/// it. A failed refetch keeps the previous answer and resets the clock, so an
/// unreachable registry costs one attempt per interval, never the catalog.
const LIBRARY_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

static LIBRARY_CACHE: tokio::sync::Mutex<Option<(Instant, Vec<mcp::McpLibraryEntry>)>> =
    tokio::sync::Mutex::const_new(None);

/// Serializes refreshes without holding `LIBRARY_CACHE` across the fetch, so
/// readers keep getting the cached catalog while a refresh is in flight.
static LIBRARY_REFRESH: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The embedded catalog, extended by verified servers from the Smithery
/// registry when it answers in time.
#[utoipa::path(
    get,
    path = "/mcp_library/library",
    operation_id = "get_mcp_library_library",
    tag = "mcp-library",
    responses((status = 200, description = "Success", body = McpLibraryResponse, content_type = "application/json"))
)]
pub async fn library_handler() -> Json<McpLibraryResponse> {
    Json(McpLibraryResponse {
        entries: library_entries().await,
    })
}

/// Fills the library cache ahead of the first request, so opening the picker
/// shows the full catalog immediately instead of waiting on the registry.
pub async fn warm_library_cache() {
    let _ = library_entries().await;
}

async fn library_entries() -> Vec<mcp::McpLibraryEntry> {
    if let Some((fetched_at, entries)) = LIBRARY_CACHE.lock().await.as_ref() {
        if fetched_at.elapsed() < LIBRARY_CACHE_TTL {
            return entries.clone();
        }
        if let Ok(refresh) = LIBRARY_REFRESH.try_lock() {
            tokio::spawn(async move {
                refresh_library_cache(refresh).await;
            });
        }
        return entries.clone();
    }
    let refresh = LIBRARY_REFRESH.lock().await;
    refresh_library_cache(refresh).await
}

async fn refresh_library_cache(
    _refresh: tokio::sync::MutexGuard<'static, ()>,
) -> Vec<mcp::McpLibraryEntry> {
    if let Some((fetched_at, entries)) = LIBRARY_CACHE.lock().await.as_ref() {
        if fetched_at.elapsed() < LIBRARY_CACHE_TTL {
            return entries.clone();
        }
    }
    let entries = match mcp::fetch_smithery_library_entries().await {
        Ok(remote) => mcp::merge_library_entries(remote),
        Err(error) => {
            eprintln!("MCP library registry fetch failed: {error:#}");
            let mut cache = LIBRARY_CACHE.lock().await;
            return match cache.as_mut() {
                Some((fetched_at, stale)) => {
                    *fetched_at = Instant::now();
                    stale.clone()
                }
                None => {
                    let embedded = mcp::embedded_library_entries();
                    *cache = Some((Instant::now(), embedded.clone()));
                    embedded
                }
            };
        }
    };
    *LIBRARY_CACHE.lock().await = Some((Instant::now(), entries.clone()));
    entries
}
