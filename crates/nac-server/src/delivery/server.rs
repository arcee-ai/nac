use crate::*;

pub(crate) fn response_compression_layer() -> CompressionLayer<impl Predicate> {
    CompressionLayer::new()
        .gzip(true)
        .compress_when(DefaultPredicate::new().and(NotForContentType::SSE))
}

/// Whether a server listener may be reachable beyond this machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BindPolicy {
    /// Preserve the default trust boundary: only this machine can connect.
    LoopbackOnly,
    /// The operator has arranged an authenticated, encrypted network boundary
    /// and accepts every reachable client as equivalent to the local user.
    AllowRemote,
}

impl BindPolicy {
    /// Validate an address before starting any server setup work.
    pub fn validate(self, addr: SocketAddr) -> Result<()> {
        if !addr.ip().is_loopback() && self != Self::AllowRemote {
            anyhow::bail!(
                "refusing non-loopback bind address {addr}; every reachable client would receive \
                 full control of nac-web. Configure an authenticated, encrypted network boundary \
                 and explicitly allow remote access (CLI: --allow-remote)"
            );
        }
        Ok(())
    }
}

/// Extra names this server answers to, as a comma-separated list.
///
/// A tunnel, reverse proxy, or direct client may use a DNS name in `Host`, which
/// the rebinding guard below would otherwise refuse. Naming it here is the
/// operator's statement that the name is expected to reach this server. `*`
/// disables the guard entirely.
pub(crate) const ALLOWED_HOSTS_ENV: &str = "NAC_ALLOWED_HOSTS";

fn configured_allowed_hosts() -> Vec<String> {
    std::env::var(ALLOWED_HOSTS_ENV)
        .unwrap_or_default()
        .split(',')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// The host name inside a `Host` header, without its port.
pub(crate) fn bare_host(host: &str) -> Option<&str> {
    let host = host.trim();
    match host.strip_prefix('[') {
        // IPv6 literals are bracketed, so the port separator is the colon that
        // follows the closing bracket rather than the last colon in the string.
        Some(rest) => rest.split_once(']').map(|(address, _port)| address),
        None => host.split(':').next().filter(|bare| !bare.is_empty()),
    }
}

/// Whether a `Host` header cannot itself be changed through DNS rebinding.
///
/// An attacker can point their own domain at an address on the machine running
/// nac-web and drive the API from a victim's browser. A browser always sends the
/// name it dialled and cannot forge an IP-literal `Host`, so localhost and IP
/// literals do not need the DNS-name allowlist. This is not client
/// authentication and does not make a reachable address trusted.
pub(crate) fn is_non_rebindable_host(host: &str) -> bool {
    let Some(bare) = bare_host(host) else {
        return false;
    };
    bare.eq_ignore_ascii_case("localhost") || bare.parse::<std::net::IpAddr>().is_ok()
}

pub(crate) fn host_is_allowed(host: &str, allowed: &[String]) -> bool {
    if is_non_rebindable_host(host) {
        return true;
    }
    let host = host.trim().to_ascii_lowercase();
    let bare = bare_host(&host).unwrap_or_default().to_string();
    allowed
        .iter()
        .any(|entry| entry == "*" || *entry == host || *entry == bare)
}

async fn reject_foreign_host(
    State(allowed): State<Arc<Vec<String>>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .map(|value| value.to_str().unwrap_or_default())
        // HTTP/2 carries the authority in the pseudo-header instead.
        .or_else(|| request.uri().host());
    match host {
        // An absent header is accepted because HTTP/1.1 clients that omit it
        // are never browsers.
        Some(host) if !host_is_allowed(host, &allowed) => (
            StatusCode::FORBIDDEN,
            format!(
                "refusing request for host '{host}'; add it to {ALLOWED_HOSTS_ENV} if this name \
                 is expected to reach nac-web"
            ),
        )
            .into_response(),
        _ => next.run(request).await,
    }
}

fn is_safe_method(method: &axum::http::Method) -> bool {
    method == axum::http::Method::GET
        || method == axum::http::Method::HEAD
        || method == axum::http::Method::OPTIONS
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|uri| {
            uri.authority()
                .map(|authority| authority.as_str().to_string())
        })
        .is_some_and(|authority| authority.eq_ignore_ascii_case(host.trim()))
}

/// Reject browser-forged mutations independently of the DNS-rebinding guard.
///
/// Fetch Metadata is browser-controlled. Origin is the fallback for browsers
/// that omit it; requests carrying neither remain available to non-browser API
/// clients. Host validation still runs separately for every request.
async fn reject_cross_origin_mutation(request: axum::extract::Request, next: Next) -> Response {
    if is_safe_method(request.method()) {
        return next.run(request).await;
    }

    let headers = request.headers();
    let fetch_site = headers
        .get(header::HeaderName::from_static("sec-fetch-site"))
        .and_then(|value| value.to_str().ok());
    if matches!(fetch_site, Some("cross-site" | "same-site")) {
        return (
            StatusCode::FORBIDDEN,
            "refusing a cross-origin state-changing browser request",
        )
            .into_response();
    }

    if !matches!(fetch_site, Some("same-origin" | "none")) {
        if let Some(origin) = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            let host = headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                .or_else(|| {
                    request
                        .uri()
                        .authority()
                        .map(axum::http::uri::Authority::as_str)
                });
            if !host.is_some_and(|host| origin_matches_host(origin, host)) {
                return (
                    StatusCode::FORBIDDEN,
                    "refusing a cross-origin state-changing browser request",
                )
                    .into_response();
            }
        }
    }

    next.run(request).await
}
async fn secure_docs(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::HeaderName::from_static("content-security-policy"),
        header::HeaderValue::from_static("frame-ancestors 'none'"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("x-frame-options"),
        header::HeaderValue::from_static("DENY"),
    );
    response
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "nac-web HTTP API",
        version = env!("CARGO_PKG_VERSION"),
        description = "Live OpenAPI 3.1 contract for nac-web's REST and SSE surface. nac-web binds to loopback by default. Non-loopback binds require --allow-remote and an authenticated, encrypted network boundary; every reachable client receives control equivalent to the local user because the API has no client authentication. IP-literal Host values bypass only the DNS-name allowlist, not authentication. DNS names must be listed in NAC_ALLOWED_HOSTS. Cross-origin browser mutations are rejected independently. Finite JSON responses may be gzip-compressed. The SSE stream is text/event-stream and is never gzip-compressed. Credential values are write-only. /mcp is streamable-HTTP MCP (JSON-RPC), not REST, and is intentionally out of band."
    ),
    components(schemas(
        filesystem::BrowseKind,
        // Only ever referenced from a query parameter, which utoipa does not
        // walk for schemas the way it walks bodies and responses.
        DeleteProjectSessions,
        ReplayBoundaryEvent,
        ReplayGapEvent,
        SessionEventEnvelope,
        AssistantStreamDelta,
        LaggedEvent
    ))
)]
struct ApiDoc;

pub fn router(manager: SessionManager) -> Router {
    // The registry answer takes a few seconds, so it is warmed in the
    // background rather than on the first picker open.
    tokio::spawn(mcp_api::warm_library_cache());
    let (api, openapi) = api_router(manager);
    let docs = Router::new()
        .merge(
            SwaggerUi::new("/docs")
                .url("/openapi.json", openapi)
                .config(SwaggerConfig::default().validator_url("none")),
        )
        .layer(middleware::from_fn(secure_docs));
    api.merge(docs)
        .merge(embedded_frontend_router())
        .layer(response_compression_layer())
        .layer(middleware::from_fn(reject_cross_origin_mutation))
        .layer(middleware::from_fn_with_state(
            Arc::new(configured_allowed_hosts()),
            reject_foreign_host,
        ))
}

fn embedded_frontend_router() -> Router {
    Router::new()
        .route("/", get(index_html))
        .route("/app", get(index_html))
        .route("/assets/{*path}", get(serve_asset))
}

fn documented_api() -> OpenApiRouter<SessionManager> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health))
        .routes(routes!(managed_status::healthz_handler))
        .routes(routes!(managed_status::readyz_handler))
        .routes(routes!(managed_status::managed_status_handler))
        .routes(routes!(store_info))
        .routes(routes!(sandbox_availability_handler))
        .routes(routes!(sandbox_activity_handler))
        .routes(routes!(browse_filesystem_handler))
        .routes(routes!(browse_ssh_handler))
        .routes(routes!(provider_models_handler))
        .routes(routes!(
            delivery::model_configurations::list_handler,
            delivery::model_configurations::create_handler
        ))
        .routes(routes!(
            delivery::projects::list_handler,
            delivery::projects::create_handler
        ))
        .routes(routes!(delivery::projects::reorder_handler))
        .routes(routes!(
            delivery::projects::update_handler,
            delivery::projects::delete_handler
        ))
        .routes(routes!(delivery::projects::assign_session_handler))
        .routes(routes!(
            delivery::model_configurations::resolve_file_handler
        ))
        .routes(routes!(
            delivery::model_configurations::update_handler,
            delivery::model_configurations::delete_handler
        ))
        .routes(routes!(
            delivery::model_configurations::resolve_saved_handler
        ))
        .routes(routes!(
            delivery::ssh_configurations::list_handler,
            delivery::ssh_configurations::create_handler
        ))
        .routes(routes!(
            delivery::ssh_configurations::update_handler,
            delivery::ssh_configurations::delete_handler
        ))
        .routes(routes!(mcp_api::library_handler))
        .routes(routes!(
            mcp_api::list_servers_handler,
            mcp_api::create_server_handler
        ))
        .routes(routes!(mcp_api::test_server_handler))
        .routes(routes!(
            mcp_api::update_server_handler,
            mcp_api::delete_server_handler
        ))
        .routes(routes!(managed_auth::list_handler))
        .routes(routes!(managed_auth::logout_handler))
        .routes(routes!(managed_auth::start_login_handler))
        .routes(routes!(
            managed_auth::poll_login_handler,
            managed_auth::cancel_login_handler
        ))
        .routes(routes!(
            managed_github::status_handler,
            managed_github::disconnect_handler
        ))
        .routes(routes!(managed_github::start_login_handler))
        .routes(routes!(
            managed_github::poll_login_handler,
            managed_github::cancel_login_handler
        ))
        .routes(routes!(managed_github::repositories_handler))
        .routes(routes!(managed_github::branches_handler))
        .routes(routes!(managed_github::start_clone_handler))
        .routes(routes!(
            managed_github::clone_operation_handler,
            managed_github::cancel_clone_handler
        ))
        .routes(routes!(
            managed_github::git_identity_handler,
            managed_github::update_git_identity_handler
        ))
        .routes(routes!(delivery::managed_secrets::list_handler))
        .routes(routes!(
            delivery::managed_secrets::put_handler,
            delivery::managed_secrets::delete_handler
        ))
        .routes(routes!(
            delivery::credentials::list_handler,
            delivery::credentials::generate_handler
        ))
        .routes(routes!(
            delivery::credentials::put_handler,
            delivery::credentials::delete_handler
        ))
        .routes(routes!(launch_model_defaults_handler))
        .routes(routes!(models_handler))
        .routes(routes!(commands_handler))
        .routes(routes!(
            delivery::sessions::list_handler,
            delivery::session_lifecycle::create_session
        ))
        .routes(routes!(delivery::sessions::reorder_handler))
        .routes(routes!(delivery::sessions::update_presentation_handler))
        .routes(routes!(delivery::session_state::session_messages))
        .routes(routes!(
            delivery::session_state::list_direct_inbox,
            delivery::session_state::create_direct_inbox_item
        ))
        .routes(routes!(
            delivery::session_state::update_direct_inbox_item,
            delivery::session_state::cancel_direct_inbox_item
        ))
        .routes(routes!(
            delivery::session_state::get_direct_goal,
            delivery::session_state::create_direct_goal
        ))
        .routes(routes!(
            delivery::session_state::update_direct_goal,
            delivery::session_state::clear_direct_goal
        ))
        .routes(routes!(
            delivery::delegation::list_traditional_children,
            delivery::delegation::start_traditional_child
        ))
        .routes(routes!(delivery::delegation::get_traditional_child))
        .routes(routes!(delivery::delegation::cancel_traditional_child))
        .routes(routes!(
            delivery::delegation::list_managed_orchestrators,
            delivery::delegation::start_managed_orchestrator
        ))
        .routes(routes!(delivery::delegation::get_managed_orchestrator))
        .routes(routes!(delivery::delegation::cancel_managed_orchestrator))
        .routes(routes!(delivery::session_state::permission_state))
        .routes(routes!(delivery::session_state::reply_permission_request))
        .routes(routes!(delivery::session_state::delete_permission_grant))
        .routes(routes!(delivery::session_state::thread_events))
        .routes(routes!(delivery::workspace::workspace_diff))
        .routes(routes!(delivery::workspace::workspace_files))
        .routes(routes!(delivery::workspace::workspace_file))
        .routes(routes!(delivery::workspace::open_workspace_path))
        .routes(routes!(
            delivery::workspace::workspace_branches,
            delivery::workspace::switch_workspace_branch
        ))
        .routes(routes!(delivery::workspace::commit_workspace))
        .routes(routes!(delivery::workspace::workspace_revisions))
        .routes(routes!(delivery::workspace::workspace_revision_changes))
        .routes(routes!(
            delivery::session_state::session_snapshot,
            delivery::session_lifecycle::delete_session_handler
        ))
        .routes(routes!(
            delivery::session_lifecycle::session_config_handler,
            delivery::session_lifecycle::update_config_handler
        ))
        .routes(routes!(delivery::session_lifecycle::session_skills_handler))
        .routes(routes!(delivery::session_runs::submit_prompt))
        .routes(routes!(compaction::handler))
        .routes(routes!(revert::handler))
        .routes(routes!(revert::regenerate_handler))
        .routes(routes!(fork::handler))
        .routes(routes!(fork::dismiss_handler))
        .routes(routes!(handoff::handler))
        .routes(routes!(
            delivery::session_runs::queue_orchestrator_steering_handler
        ))
        .routes(routes!(
            delivery::session_runs::queue_thread_steering_handler
        ))
        .routes(routes!(delivery::session_runs::recent_events))
        .routes(routes!(delivery::session_runs::stream_events))
        .routes(routes!(delivery::session_runs::cancel_active_run))
}

/// Return the exact OpenAPI document assembled for the running HTTP router.
///
/// Build tooling uses this state-free seam so checked-in consumers derive from
/// the same route and schema registrations served at `/openapi.json`.
pub fn openapi_document() -> utoipa::openapi::OpenApi {
    documented_api().split_for_parts().1
}

fn api_router(manager: SessionManager) -> (Router, utoipa::openapi::OpenApi) {
    let documented = documented_api().with_state(manager.clone());
    let (router, openapi) = documented.split_for_parts();
    (
        router.nest_service("/mcp", mcp::streamable_http_service(manager)),
        openapi,
    )
}

pub async fn serve(addr: SocketAddr, manager: SessionManager) -> Result<()> {
    serve_with(addr, manager, |_| {}).await
}

/// Bind, invoke `on_listening` with the actual local address, then serve.
///
/// Callers that open a browser must do so from `on_listening` so the socket is
/// already accepting connections (printing "listening" before `bind` races the
/// first page load against a still-closed port).
pub async fn serve_with(
    addr: SocketAddr,
    manager: SessionManager,
    on_listening: impl FnOnce(SocketAddr),
) -> Result<()> {
    serve_with_policy(addr, BindPolicy::LoopbackOnly, manager, on_listening).await
}

/// Serve under an explicit network exposure policy.
pub async fn serve_with_policy(
    addr: SocketAddr,
    policy: BindPolicy,
    manager: SessionManager,
    on_listening: impl FnOnce(SocketAddr),
) -> Result<()> {
    policy.validate(addr)?;
    // Establish the durable store before serving requests. Readiness probes
    // then verify this store in place and never create a blank replacement
    // if it disappears while the process is running.
    nac_core::store::initialize(&manager.inner.store_path)?;
    nac_core::reconcile_podman_creation_records(&manager.inner.store_path).await?;
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    let bound = listener
        .local_addr()
        .with_context(|| format!("failed to read bound address for {addr}"))?;
    on_listening(bound);
    serve_listener_with_shutdown(
        listener,
        manager,
        shutdown_signal(),
        COMPLETE_SHUTDOWN_TIMEOUT,
        || std::process::exit(0),
    )
    .await
}

#[expect(
    clippy::expect_used,
    reason = "the single forced-shutdown callback is moved only after graceful shutdown starts"
)]
pub(crate) async fn serve_listener_with_shutdown<F, X>(
    listener: TcpListener,
    manager: SessionManager,
    shutdown: F,
    complete_shutdown_timeout: Duration,
    force_shutdown: X,
) -> Result<()>
where
    F: Future<Output = ()> + Send + 'static,
    X: FnOnce() + Send + 'static,
{
    let mut force_shutdown = Some(force_shutdown);
    let shutdown_manager = manager.clone();
    let (graceful_tx, graceful_rx) = tokio::sync::oneshot::channel();
    let mut server = tokio::spawn(
        axum::serve(listener, router(manager))
            .with_graceful_shutdown(async move {
                let _ = graceful_rx.await;
            })
            .into_future(),
    );
    tokio::pin!(shutdown);

    let result = tokio::select! {
        result = &mut server => result
            .context("server task stopped unexpectedly")?
            .context("server stopped unexpectedly"),
        () = &mut shutdown => {
            // Stop accepting new work before cancellation. The single outer
            // deadline covers both run cleanup and graceful HTTP/SSE drain.
            // Its watchdog is independent of the async runtime so a wedged
            // connection task cannot starve the forced process exit.
            let _ = graceful_tx.send(());
            let (shutdown_complete_tx, shutdown_complete_rx) = std::sync::mpsc::channel();
            let force_shutdown = force_shutdown.take().expect("force shutdown callback");
            let watchdog = std::thread::Builder::new()
                .name("nac-shutdown-watchdog".to_string())
                .spawn(move || {
                    if shutdown_complete_rx
                        .recv_timeout(complete_shutdown_timeout)
                        .is_err()
                    {
                        forced_shutdown_after_timeout(complete_shutdown_timeout, force_shutdown);
                    }
                })
                .context("failed to start shutdown watchdog")?;

            shutdown_manager.cancel_local_active_runs_for_shutdown().await;
            let result = (&mut server)
                .await
                .context("server task stopped unexpectedly")?
                .context("server stopped unexpectedly");
            let _ = shutdown_complete_tx.send(());
            watchdog
                .join()
                .map_err(|_| anyhow!("shutdown watchdog panicked"))?;
            result
        }
    };
    result
}

fn forced_shutdown_after_timeout(timeout: Duration, force_shutdown: impl FnOnce()) {
    eprintln!(
        "nac: complete graceful shutdown exceeded {} ms; forcing runtime exit",
        timeout.as_millis()
    );
    force_shutdown();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            eprintln!("nac: failed to install Ctrl-C handler: {error}");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let terminate = async {
            match signal(SignalKind::terminate()) {
                Ok(mut stream) => {
                    stream.recv().await;
                }
                Err(error) => {
                    eprintln!("nac: failed to install SIGTERM handler: {error}");
                    std::future::pending::<()>().await;
                }
            }
        };
        tokio::select! {
            () = ctrl_c => {}
            () = terminate => {}
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

#[utoipa::path(
    get,
    path = "/health",
    operation_id = "get_health",
    tag = "system",
    responses(
        (status = 200, description = "Session store ready", body = HealthResponse, content_type = "application/json"),
        (status = 503, description = "Session store unavailable", body = HealthResponse, content_type = "application/json")
    )
)]
async fn health(State(manager): State<SessionManager>) -> (StatusCode, Json<HealthResponse>) {
    let store_path = manager.inner.store_path.clone();
    let ready =
        tokio::task::spawn_blocking(move || nac_core::store::check_readiness(&store_path)).await;
    match ready {
        Ok(Ok(())) => (StatusCode::OK, Json(HealthResponse { status: "ok" })),
        Ok(Err(error)) => {
            eprintln!("nac: session store readiness check failed: {error:#}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "unavailable",
                }),
            )
        }
        Err(error) => {
            eprintln!("nac: session store readiness task failed: {error}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "unavailable",
                }),
            )
        }
    }
}

// The frontend is a Vite/React app built from `web/` into `assets/dist/`. That
// output is committed, so building this crate never needs Node, and the whole
// `assets/` tree is embedded at compile time to keep `nac-web` a single
// self-contained executable with no runtime filesystem dependency.
pub(crate) static ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/assets");

async fn index_html() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            // The entry document names the hashed bundles, so it must never be
            // cached or a client would keep loading a stale build forever.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        include_str!("../../assets/dist/index.html"),
    )
}

pub(crate) fn asset_content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("png") => "image/png",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

// Everything Vite emits under `dist/assets/` carries a content hash in its
// filename, so those responses can be cached indefinitely.
pub(crate) fn asset_cache_control(path: &str) -> &'static str {
    if path.starts_with("dist/assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

// Serve any embedded asset by its path relative to the `assets/` root (the
// `/assets/` prefix is stripped by the route). Returns 404 for unknown paths.
async fn serve_asset(AxumPath(path): AxumPath<String>) -> Response {
    match ASSETS.get_file(&path) {
        Some(file) => (
            [
                (header::CONTENT_TYPE, asset_content_type(&path)),
                (header::CACHE_CONTROL, asset_cache_control(&path)),
            ],
            file.contents(),
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "asset not found").into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/store",
    operation_id = "get_store",
    tag = "system",
    responses((status = 200, description = "Success", body = StoreInfo, content_type = "application/json"))
)]
async fn store_info(State(manager): State<SessionManager>) -> Json<StoreInfo> {
    Json(manager.store_info())
}

/// Whether this host can run sandboxed sessions right now. The launch UI
/// queries this only when the user picks sandbox mode, so the probe's
/// subprocess cost is paid on demand rather than on every page load.
#[utoipa::path(
    get,
    path = "/sandbox/availability",
    operation_id = "get_sandbox_availability",
    tag = "system",
    responses((status = 200, description = "Success", body = runtime::SandboxAvailability, content_type = "application/json"))
)]
async fn sandbox_availability_handler() -> Json<runtime::SandboxAvailability> {
    Json(runtime::probe_availability().await)
}

/// Sandbox setup currently in progress for one launch (image pull, container
/// start), or `null` when that launch is idle. The launch UI generates a key
/// per attempt, sends it with the create request, and polls here with it —
/// keyed so concurrent launches never show each other's phase. A first image
/// pull can take minutes with no other visible signal.
#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SandboxActivityQuery {
    /// The activity key the create request carried (`sandbox.activity_key`).
    pub key: String,
}

#[utoipa::path(
    get,
    path = "/sandbox/activity",
    operation_id = "get_sandbox_activity",
    tag = "system",
    params(SandboxActivityQuery),
    responses((status = 200, description = "Success", body = Option<runtime::SandboxActivity>, content_type = "application/json"))
)]
async fn sandbox_activity_handler(
    Query(query): Query<SandboxActivityQuery>,
) -> Json<Option<runtime::SandboxActivity>> {
    Json(runtime::current_activity(&query.key))
}

/// The picker starts wherever the caller last was; with no path yet it opens on
/// the server root the session would default to anyway.
#[utoipa::path(
    get,
    path = "/fs/browse",
    operation_id = "get_fs_browse",
    tag = "filesystem",
    params(filesystem::BrowseQuery),
    responses((status = 200, description = "Success", body = filesystem::BrowseListing, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 403, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn browse_filesystem_handler(
    State(manager): State<SessionManager>,
    Query(query): Query<filesystem::BrowseQuery>,
) -> std::result::Result<Json<filesystem::BrowseListing>, ApiError> {
    let listing = filesystem::browse(&query, &manager.inner.root_cwd)?;
    Ok(Json(listing))
}

/// The same listing for a directory on an SSH host, which is also how the launch
/// form tests the connection before it offers the rest of the form.
#[utoipa::path(
    post,
    path = "/ssh/browse",
    operation_id = "post_ssh_browse",
    tag = "filesystem",
    request_body(content = SshBrowseRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = filesystem::BrowseListing, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn browse_ssh_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<SshBrowseRequest>, JsonRejection>,
) -> std::result::Result<Json<filesystem::BrowseListing>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let listing = manager.browse_ssh(request).await?;
    Ok(Json(listing))
}

/// Validate a credential by asking its provider which models it may use.
///
/// A key arrives in the request body and is forwarded once; it is never stored
/// by this route, and the destination goes through the same credential trust
/// check as a session launch. A provider signed in through the browser has no
/// key to send, so the stored login answers instead — and its answer is the
/// same evidence the launch UI needs that the login still works.
#[utoipa::path(
    post,
    path = "/providers/models",
    operation_id = "post_providers_models",
    tag = "models",
    request_body(content = ProviderModelsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProviderModelList, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn provider_models_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<ProviderModelsRequest>, JsonRejection>,
) -> std::result::Result<Json<ProviderModelList>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let backend = request.backend;

    let api_key = request.api_key.unwrap_or_default();
    let api_key_env = request
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(provider) = ManagedAuthProvider::for_backend(backend) {
        if !api_key.trim().is_empty() || api_key_env.is_some() {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: format!(
                    "backend '{backend}' authenticates with a stored login and accepts no API key"
                ),
            });
        }
        let models = list_managed_provider_models(provider)
            .await
            .map_err(|error| ApiError {
                status: StatusCode::BAD_GATEWAY,
                message: error.to_string(),
            })?;
        // The endpoint belongs to the login rather than to the caller, so it is
        // reported back the same way a validated key's is.
        let base_url = provider_default_base_url(backend)
            .map(str::to_string)
            .unwrap_or_default();
        return Ok(Json(ProviderModelList { base_url, models }));
    }
    // A key already filed away is named rather than sent, so a setup that is
    // only being reviewed never has to hand its secret back to the page first.
    let api_key = match api_key_env {
        Some(name) if api_key.trim().is_empty() => resolve_backend_api_key(backend, Some(name))
            .map_err(|error| ApiError {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            })?,
        _ => api_key,
    };
    if api_key.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires a nonblank API key"),
        });
    }

    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;

    let models = list_provider_models(backend, &base_url, &api_key)
        .await
        .map_err(|error| ApiError {
            // A rejected key is the caller's problem, not a server fault.
            status: StatusCode::BAD_GATEWAY,
            message: error.to_string(),
        })?;
    Ok(Json(ProviderModelList { base_url, models }))
}

#[utoipa::path(
    post,
    path = "/sessions/launch-defaults",
    operation_id = "post_sessions_launch_defaults",
    tag = "sessions",
    request_body(content = LaunchModelDefaultsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = LaunchModelDefaults, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn launch_model_defaults_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<LaunchModelDefaultsRequest>, JsonRejection>,
) -> std::result::Result<Json<LaunchModelDefaults>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.launch_model_defaults(request)?))
}

/// The model catalog listing for the frontend picker: every provider with
/// auth requirements, managed base URL, catalog endpoint default,
/// `_default` limits and real entries. Reads the process-global catalog;
/// synchronous, local-only, never fails. `auth_status`/`auth_hint` are
/// computed per request from the process environment and the managed
/// credential files.
#[utoipa::path(
    get,
    path = "/models",
    operation_id = "get_models",
    tag = "models",
    responses((status = 200, description = "Success", body = ModelListing, content_type = "application/json"))
)]
async fn models_handler(State(manager): State<SessionManager>) -> Json<ModelListing> {
    Json(manager.model_catalog().listing())
}

#[utoipa::path(
    get,
    path = "/commands",
    operation_id = "get_commands",
    tag = "system",
    responses((status = 200, description = "Success", body = Vec<SlashCommandDefinition>, content_type = "application/json"))
)]
async fn commands_handler() -> Json<&'static [SlashCommandDefinition]> {
    Json(slash_command_definitions())
}
