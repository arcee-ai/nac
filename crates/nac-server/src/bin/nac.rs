//! `nac` — a lightweight command-line client for the NAC backend.
//!
//! `nac` posts a single prompt to a running NAC backend. By default it creates a
//! new session via `POST /sessions` and then submits the prompt via
//! `POST /sessions/{id}/runs`. If `--session-id` is supplied it reuses that
//! session instead.
//!
//! This binary is fully self-contained (it does not use the nac-server library
//! crate); it only talks to the backend over HTTP with `reqwest`.

use std::io::Read;
use std::path::PathBuf;
use std::process;
use std::time::Duration;

use clap::{Parser, ValueEnum};
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use serde_json::Value as JsonValue;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum BackendArg {
    #[value(name = "deepseek-chat")]
    DeepSeekChat,
    #[value(name = "fireworks-chat")]
    FireworksChat,
    #[value(name = "together-chat")]
    TogetherChat,
    #[value(name = "openai-responses")]
    OpenAiResponses,
    #[value(name = "chatgpt-codex-responses")]
    ChatGptCodexResponses,
    #[value(name = "anthropic-messages")]
    AnthropicMessages,
    #[value(name = "arcee-auth")]
    ArceeAuth,
    #[value(name = "arcee-api")]
    ArceeApi,
}

impl BackendArg {
    fn as_str(&self) -> &'static str {
        match self {
            BackendArg::DeepSeekChat => "deepseek-chat",
            BackendArg::FireworksChat => "fireworks-chat",
            BackendArg::TogetherChat => "together-chat",
            BackendArg::OpenAiResponses => "openai-responses",
            BackendArg::ChatGptCodexResponses => "chatgpt-codex-responses",
            BackendArg::AnthropicMessages => "anthropic-messages",
            BackendArg::ArceeAuth => "arcee-auth",
            BackendArg::ArceeApi => "arcee-api",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum ReasoningEffortArg {
    #[value(name = "none")]
    None,
    #[value(name = "minimal")]
    Minimal,
    #[value(name = "low")]
    Low,
    #[value(name = "medium")]
    Medium,
    #[value(name = "high")]
    High,
    #[value(name = "xhigh")]
    Xhigh,
}

impl ReasoningEffortArg {
    fn as_str(&self) -> &'static str {
        match self {
            ReasoningEffortArg::None => "none",
            ReasoningEffortArg::Minimal => "minimal",
            ReasoningEffortArg::Low => "low",
            ReasoningEffortArg::Medium => "medium",
            ReasoningEffortArg::High => "high",
            ReasoningEffortArg::Xhigh => "xhigh",
        }
    }
}

#[derive(Debug, Parser)]
#[command(
    name = "nac",
    version,
    about = "Lightweight CLI for posting prompts to a NAC backend",
    long_about = "\
Post a single prompt to a running NAC backend and print the resulting run.

Workflow:
  nac 'refactor the parser module'            # create a session, then run the prompt
  nac 'continue where we left off' --session-id SESSION
                                              # reuse an existing session
  echo 'summarize the diff' | nac --stdin   # read the prompt from stdin

By default a brand-new session is created per invocation. Pass --session-id to
reuse an existing session. With --json, a single machine-readable JSON object
is printed on stdout; otherwise human text is printed. All diagnostics go to
stderr so piping stays clean."
)]
struct Cli {
    /// The prompt text to post. Omit it if --stdin is used.
    #[arg(value_name = "PROMPT")]
    prompt: Option<String>,

    /// Base URL of the NAC backend.
    #[arg(long, value_name = "URL", default_value = "http://127.0.0.1:3210")]
    nac_endpoint: String,

    /// Reuse an existing session instead of creating a new one.
    #[arg(long, value_name = "ID")]
    session_id: Option<String>,

    /// Read the prompt from stdin instead of a positional argument.
    #[arg(long)]
    stdin: bool,

    /// Create-session override: model identifier.
    #[arg(long, value_name = "MODEL")]
    model: Option<String>,

    /// Create-session override: backend identifier.
    #[arg(long, value_name = "BACKEND", value_enum)]
    backend: Option<BackendArg>,

    /// Create-session override: working directory.
    #[arg(long, value_name = "DIR")]
    cwd: Option<PathBuf>,

    /// Create-session override: reasoning effort.
    #[arg(long, value_name = "EFFORT", value_enum)]
    reasoning_effort: Option<ReasoningEffortArg>,

    /// Print a single machine-readable JSON object instead of human text.
    #[arg(long)]
    json: bool,

    /// Print extra detail to stderr.
    #[arg(short, long)]
    verbose: bool,
}

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/// Minimal view of the fields we need from the wire session snapshot. Only the
/// `metadata.session_id` field matters to the client.
#[derive(Debug, Deserialize)]
struct WireSessionFrontendSnapshot {
    metadata: WireSessionMetadata,
}

#[derive(Debug, Deserialize)]
struct WireSessionMetadata {
    session_id: Option<String>,
}

/// Response body of `POST /sessions/{id}/runs`.
#[derive(Debug, Deserialize)]
struct WireRunResponse {
    run_id: String,
    client_id: Option<String>,
    display_prompt: String,
}

/// The successfully resolved result of a full create-and-prompt (or
/// reuse-and-prompt) run.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NacResult {
    session_id: String,
    run_id: String,
    client_id: Option<String>,
    display_prompt: String,
    endpoint: String,
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

const CREATE_WHAT: &str = "POST /sessions";
const RUN_WHAT: &str = "POST /sessions/{id}/runs";

/// Cap how much of a non-2xx error body we echo back to the user.
const MAX_BODY_CHARS: usize = 500;

/// Truncate a raw body string to a safe length.
fn trim_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() > MAX_BODY_CHARS {
        let truncated: String = trimmed.chars().take(MAX_BODY_CHARS).collect();
        format!("{truncated}…")
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug)]
enum NacError {
    InvalidUrl(String),
    Usage(String),
    ConnectionFailed { endpoint: String, cause: String },
    Timeout { endpoint: String },
    Server { endpoint: String, status: u16, body: String },
    Http {
        endpoint: String,
        what: &'static str,
        status: u16,
        expected: u16,
    },
    MalformedResponse {
        endpoint: String,
        what: &'static str,
        detail: String,
    },
    /// Wraps another error with a user-facing hint (e.g. a leaked session id).
    WithHint {
        hint: String,
        inner: Box<NacError>,
    },
}

impl std::fmt::Display for NacError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NacError::InvalidUrl(raw) => write!(
                f,
                "invalid --nac-endpoint `{raw}`: expected an http:// or https:// URL"
            ),
            NacError::Usage(msg) => write!(f, "{msg}"),
            NacError::ConnectionFailed { endpoint, cause } => {
                write!(f, "could not reach NAC backend at `{endpoint}`: {cause}")
            }
            NacError::Timeout { endpoint } => {
                write!(f, "NAC backend at `{endpoint}` timed out")
            }
            NacError::Server {
                endpoint,
                status,
                body,
            } => {
                write!(
                    f,
                    "NAC backend at `{endpoint}` returned HTTP {status}: {body}"
                )
            }
            NacError::Http {
                endpoint,
                what,
                status,
                expected,
            } => write!(
                f,
                "unexpected HTTP status from NAC backend at `{endpoint}` for {what}: \
                 got {status}, expected {expected}"
            ),
            NacError::MalformedResponse {
                endpoint,
                what,
                detail,
            } => write!(
                f,
                "malformed response from NAC backend at `{endpoint}` for {what}: {detail}"
            ),
            NacError::WithHint { hint, inner } => {
                write!(f, "{inner}\nnac: hint: {hint}")
            }
        }
    }
}

impl std::error::Error for NacError {}

impl NacError {
    /// The process exit code associated with each error class.
    fn exit_code(&self) -> i32 {
        match self {
            NacError::InvalidUrl(_) => 2,
            NacError::Usage(_) => 2,
            NacError::ConnectionFailed { .. }
            | NacError::Timeout { .. }
            | NacError::Server { .. }
            | NacError::Http { .. } => 3,
            NacError::MalformedResponse { .. } => 4,
            NacError::WithHint { inner, .. } => inner.exit_code(),
        }
    }

    /// Print a friendly `nac: error: ...` message to stderr, optionally with a
    /// backend-startup hint for connection failures.
    fn print_user(&self) {
        match self {
            NacError::WithHint { hint, inner } => {
                eprintln!("nac: error: {inner}");
                eprintln!("nac: hint: {hint}");
                if matches!(inner.as_ref(), NacError::ConnectionFailed { .. }) {
                    eprintln!("nac: hint: the NAC backend may not be running.");
                    eprintln!("nac: hint: start it with: cargo run -p nac-server --bin nac-web");
                }
            }
            other => {
                eprintln!("nac: error: {other}");
                if matches!(other, NacError::ConnectionFailed { .. }) {
                    eprintln!("nac: hint: the NAC backend may not be running.");
                    eprintln!("nac: hint: start it with: cargo run -p nac-server --bin nac-web");
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Build the HTTP client used for all backend calls.
///
/// Production timeouts are generous (60s total, 10s connect) so slow backends
/// still work. Internally we delegate to [`build_client_with_timeouts`] so the
/// test suite can construct a client with a short timeout to exercise the
/// `NacError::Timeout` path.
fn build_client() -> Result<Client, reqwest::Error> {
    build_client_with_timeouts(
        Duration::from_secs(60),
        Duration::from_secs(10),
    )
}

/// Internal helper: build a reqwest client with explicit total and connect
/// timeouts. Exposed separately so tests can use a tiny timeout.
fn build_client_with_timeouts(
    timeout: Duration,
    connect_timeout: Duration,
) -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .build()
}

/// Turn a `reqwest::Error` into a `NacError`, classifying connect vs timeout.
fn classify_reqwest_error(endpoint: &str, error: reqwest::Error) -> NacError {
    if error.is_timeout() {
        NacError::Timeout {
            endpoint: endpoint.to_string(),
        }
    } else if error.is_connect() || error.is_builder() {
        NacError::ConnectionFailed {
            endpoint: endpoint.to_string(),
            cause: error.to_string(),
        }
    } else {
        NacError::ConnectionFailed {
            endpoint: endpoint.to_string(),
            cause: error.to_string(),
        }
    }
}

/// Build the create-session request body containing ONLY the override fields
/// that the caller actually set. Omitted keys are left out so the backend
/// inherits its configured defaults.
fn build_create_body(cli: &Cli) -> JsonValue {
    let mut object = serde_json::Map::new();
    if let Some(model) = &cli.model {
        object.insert("model".to_string(), JsonValue::String(model.clone()));
    }
    if let Some(backend) = cli.backend {
        object.insert(
            "backend".to_string(),
            JsonValue::String(backend.as_str().to_string()),
        );
    }
    if let Some(cwd) = &cli.cwd {
        object.insert(
            "cwd".to_string(),
            JsonValue::String(cwd.to_string_lossy().to_string()),
        );
    }
    if let Some(effort) = cli.reasoning_effort {
        object.insert(
            "reasoning_effort".to_string(),
            JsonValue::String(effort.as_str().to_string()),
        );
    }
    JsonValue::Object(object)
}

/// Read a non-2xx response body into a `Server` error (trimmed), but only
/// include the body text if it was readable.
async fn server_error_from_response(
    endpoint: &str,
    status: StatusCode,
    response: reqwest::Response,
) -> NacError {
    let body = response
        .text()
        .await
        .map(|b| trim_body(&b))
        .unwrap_or_else(|_| "<unreadable body>".to_string());
    NacError::Server {
        endpoint: endpoint.to_string(),
        status: status.as_u16(),
        body,
    }
}

/// Create a session via `POST /sessions`, returning its `session_id`.
///
/// Only the override fields present in `create_body` are sent.
async fn create_session(
    client: &Client,
    endpoint: &Url,
    create_body: &JsonValue,
) -> Result<String, NacError> {
    let sessions_url = endpoint
        .join("/sessions")
        .map_err(|e| NacError::InvalidUrl(e.to_string()))?;

    let response = match client
        .post(sessions_url.clone())
        .json(create_body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => return Err(classify_reqwest_error(endpoint.as_str(), e)),
    };

    let status = response.status();
    if status != StatusCode::CREATED {
        if status.is_success() {
            return Err(NacError::Http {
                endpoint: endpoint.to_string(),
                what: CREATE_WHAT,
                status: status.as_u16(),
                expected: StatusCode::CREATED.as_u16(),
            });
        }
        return Err(server_error_from_response(endpoint.as_str(), status, response).await);
    }

    let body: JsonValue = match response.json().await {
        Ok(value) => value,
        Err(_) => {
            return Err(NacError::MalformedResponse {
                endpoint: endpoint.to_string(),
                what: CREATE_WHAT,
                detail: "response body was not valid JSON".to_string(),
            })
        }
    };

    let snapshot: WireSessionFrontendSnapshot = match serde_json::from_value(body.clone()) {
        Ok(snapshot) => snapshot,
        Err(e) => {
            return Err(NacError::MalformedResponse {
                endpoint: endpoint.to_string(),
                what: CREATE_WHAT,
                detail: format!(
                    "expected a SessionFrontendSnapshot with metadata.session_id: {e}"
                ),
            })
        }
    };

    snapshot
        .metadata
        .session_id
        .ok_or_else(|| NacError::MalformedResponse {
            endpoint: endpoint.to_string(),
            what: CREATE_WHAT,
            detail: "response is missing `metadata.session_id`".to_string(),
        })
}

/// Post a prompt to `POST /sessions/{id}/runs`, returning the run details.
async fn submit_prompt(
    client: &Client,
    endpoint: &Url,
    session_id: &str,
    prompt: &str,
) -> Result<WireRunResponse, NacError> {
    let url = endpoint
        .join(&format!("/sessions/{session_id}/runs"))
        .map_err(|e| NacError::InvalidUrl(e.to_string()))?;

    let body = serde_json::json!({ "prompt": prompt });
    let response = match client.post(url.clone()).json(&body).send().await {
        Ok(response) => response,
        Err(e) => return Err(classify_reqwest_error(endpoint.as_str(), e)),
    };

    let status = response.status();
    if status != StatusCode::ACCEPTED {
        if status.is_success() {
            return Err(NacError::Http {
                endpoint: endpoint.to_string(),
                what: RUN_WHAT,
                status: status.as_u16(),
                expected: StatusCode::ACCEPTED.as_u16(),
            });
        }
        return Err(server_error_from_response(endpoint.as_str(), status, response).await);
    }

    let raw = response
        .text()
        .await
        .map(|b| trim_body(&b))
        .unwrap_or_else(|_| "<unreadable body>".to_string());

    match serde_json::from_str::<WireRunResponse>(&raw) {
        Ok(run) => Ok(run),
        Err(e) => {
            Err(NacError::MalformedResponse {
                endpoint: endpoint.to_string(),
                what: RUN_WHAT,
                detail: format!(
                    "expected {{run_id, client_id, display_prompt}} JSON; body: {raw} (serde: {e})"
                ),
            })
        }
    }
}

/// Validate a `--session-id` value up front so it cannot escape the URL mount.
///
/// Only non-empty ids consisting of `[A-Za-z0-9_-]` are accepted. Anything else
/// (empty, path segments, query/fragment delimiters, `..`, etc.) is rejected
/// as a usage error rather than being spliced into a URL path.
fn validate_session_id(id: &str) -> Result<(), NacError> {
    if id.is_empty() {
        return Err(NacError::Usage(
            "invalid --session-id: id must not be empty".to_string(),
        ));
    }
    let ok = id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err(NacError::Usage(format!(
            "invalid --session-id `{id}`: only [A-Za-z0-9_-] are allowed"
        )));
    }
    Ok(())
}

/// Full client flow: create (or reuse) a session, then post the prompt.
///
/// This is the injectable core the test suite drives directly against a real
/// mock backend, asserting on the returned `Result` without going through
/// stdout.
async fn run_create_and_prompt(
    client: &Client,
    endpoint: &Url,
    session_id: Option<&str>,
    prompt: &str,
    create_body: &JsonValue,
) -> Result<NacResult, NacError> {
    if let Some(id) = session_id {
        validate_session_id(id)?;
    }

    let resolved_session_id = match session_id {
        Some(id) => id.to_string(),
        None => create_session(client, endpoint, create_body).await?,
    };

    let run = match submit_prompt(client, endpoint, &resolved_session_id, prompt).await {
        Ok(run) => run,
        Err(e) => {
            // If we created the session ourselves and the prompt submission
            // failed, wrap the error with a hint carrying the created id so the
            // user can retry with --session-id instead of leaking the session.
            if session_id.is_none() {
                return Err(NacError::WithHint {
                    hint: format!(
                        "a new session {resolved_session_id} was created; retry the prompt with: \
                         nac --session-id {resolved_session_id} \"{prompt}\""
                    ),
                    inner: Box::new(e),
                });
            }
            return Err(e);
        }
    };

    Ok(NacResult {
        session_id: resolved_session_id,
        run_id: run.run_id,
        client_id: run.client_id,
        display_prompt: run.display_prompt,
        endpoint: endpoint.to_string(),
    })
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn validate_endpoint(raw: &str) -> Result<Url, NacError> {
    let Ok(url) = Url::parse(raw) else {
        return Err(NacError::InvalidUrl(raw.to_string()));
    };
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err(NacError::InvalidUrl(raw.to_string())),
    }
}

/// Resolve the effective prompt from the CLI, enforcing the positional-XOR-
/// stdin rule that clap cannot express by itself.
fn resolve_prompt(cli: &Cli) -> Result<String, String> {
    let prompt = match (&cli.prompt, cli.stdin) {
        (Some(_), true) => {
            return Err(
                "cannot use both a positional PROMPT and --stdin; provide exactly one prompt source"
                    .to_string(),
            )
        }
        (None, false) => {
            return Err(
                "missing prompt: provide a positional PROMPT or use --stdin".to_string(),
            )
        }
        (Some(prompt), false) => prompt.clone(),
        (None, true) => {
            let mut input = String::new();
            if let Err(e) = std::io::stdin().read_to_string(&mut input) {
                return Err(format!("failed to read prompt from stdin: {e}"));
            }
            input
        }
    };

    if prompt.trim().is_empty() {
        return Err("missing prompt: prompt must not be empty".to_string());
    }

    Ok(prompt)
}

async fn run(cli: Cli) -> Result<(), NacError> {
    let prompt = resolve_prompt(&cli).map_err(NacError::Usage)?;
    let endpoint = validate_endpoint(&cli.nac_endpoint)?;

    if cli.verbose {
        eprintln!(
            "nac: endpoint={endpoint} session_id={} stdin={}",
            cli.session_id.as_deref().unwrap_or("<new>"),
            cli.stdin
        );
    }

    let client = build_client().map_err(|e| {
        NacError::ConnectionFailed {
            endpoint: endpoint.to_string(),
            cause: format!("failed to build HTTP client: {e}"),
        }
    })?;

    let create_body = build_create_body(&cli);
    if cli.verbose {
        // Verbose detail goes to stderr only; stdout stays clean. Redact the
        // cwd value (if any) so absolute paths are not echoed.
        let mut redacted = create_body.clone();
        if let Some(cwd) = redacted.get_mut("cwd") {
            *cwd = JsonValue::String("<redacted>".to_string());
        }
        eprintln!("nac: create-session body: {redacted}");
    }

    let result = run_create_and_prompt(
        &client,
        &endpoint,
        cli.session_id.as_deref(),
        &prompt,
        &create_body,
    )
    .await?;

    if cli.json {
        let json = serde_json::json!({
            "session_id": result.session_id,
            "run_id": result.run_id,
            "client_id": result.client_id,
            "display_prompt": result.display_prompt,
            "endpoint": result.endpoint,
        });
        println!("{}", serde_json::to_string_pretty(&json).unwrap());
    } else {
        println!("session_id: {}", result.session_id);
        println!("run_id: {}", result.run_id);
        if let Some(client_id) = &result.client_id {
            println!("client_id: {client_id}");
        }
        println!("prompt: {}", result.display_prompt);
        println!("submitted to {}", result.endpoint);
    }

    Ok(())
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    if let Err(e) = run(cli).await {
        e.print_user();
        process::exit(e.exit_code());
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::{get, post}, Json, Router};
    use serde_json::json;

    // ---- CLI parsing tests -------------------------------------------------

    #[test]
    fn cli_default_endpoint() {
        let cli = Cli::try_parse_from(["nac", "hello"]).unwrap();
        assert_eq!(cli.nac_endpoint, "http://127.0.0.1:3210");
        assert_eq!(cli.prompt.as_deref(), Some("hello"));
        assert!(!cli.stdin);
        assert!(!cli.json);
        assert!(!cli.verbose);
    }

    #[test]
    fn cli_endpoint_override() {
        let cli = Cli::try_parse_from([
            "nac",
            "hello",
            "--nac-endpoint",
            "http://localhost:9999",
        ])
        .unwrap();
        assert_eq!(cli.nac_endpoint, "http://localhost:9999");
    }

    #[test]
    fn cli_positional_prompt_and_session_id() {
        let cli = Cli::try_parse_from(["nac", "continue", "--session-id", "abc123", "--json"])
            .unwrap();
        assert_eq!(cli.prompt.as_deref(), Some("continue"));
        assert_eq!(cli.session_id.as_deref(), Some("abc123"));
        assert!(cli.json);
    }

    #[test]
    fn cli_create_session_overrides() {
        let cli = Cli::try_parse_from([
            "nac",
            "hey",
            "--model",
            "gpt-4o",
            "--backend",
            "anthropic-messages",
            "--cwd",
            "/tmp/work",
            "--reasoning-effort",
            "high",
        ])
        .unwrap();
        assert_eq!(cli.model.as_deref(), Some("gpt-4o"));
        assert_eq!(cli.backend.map(|b| b.as_str()), Some("anthropic-messages"));
        assert_eq!(cli.cwd.as_deref(), Some(std::path::Path::new("/tmp/work")));
        assert_eq!(cli.reasoning_effort.map(|e| e.as_str()), Some("high"));
    }

    #[test]
    fn cli_prompt_with_stdin_conflicts_at_resolve() {
        // The conflict (positional XOR --stdin) is enforced in resolve_prompt,
        // which is where we claim it: parsing succeeds, resolution fails.
        let cli = Cli::try_parse_from(["nac", "hello", "--stdin"]).unwrap();
        assert!(cli.prompt.is_some() && cli.stdin);
        assert!(resolve_prompt(&cli).is_err());
    }

    #[test]
    fn cli_missing_prompt_without_stdin() {
        let cli = Cli::try_parse_from(["nac"]).unwrap();
        assert!(cli.prompt.is_none() && !cli.stdin);
        assert!(resolve_prompt(&cli).is_err());
    }

    #[test]
    fn cli_stdin_alone_is_valid() {
        let cli = Cli::try_parse_from(["nac", "--stdin"]).unwrap();
        assert!(cli.stdin);
        assert!(cli.prompt.is_none());
    }

    #[test]
    fn cli_rejects_invalid_backend_value() {
        let error = Cli::try_parse_from(["nac", "hello", "--backend", "not-a-backend"]).unwrap_err();
        assert!(error.to_string().contains("invalid value"), "{error}");
    }

    // ---- Endpoint validation tests ----------------------------------------

    #[test]
    fn validate_endpoint_accepts_http_and_https() {
        assert!(validate_endpoint("http://127.0.0.1:3210").is_ok());
        assert!(validate_endpoint("https://example.com").is_ok());
    }

    #[test]
    fn validate_endpoint_rejects_bad_scheme_and_junk() {
        assert!(matches!(
            validate_endpoint("ftp://example.com").unwrap_err(),
            NacError::InvalidUrl(_)
        ));
        assert!(matches!(
            validate_endpoint("not a url").unwrap_err(),
            NacError::InvalidUrl(_)
        ));
    }

    // ---- HTTP flow against a real mock backend ----------------------------

    /// A tiny axum app mirroring the NAC backend surface used by this client.
    fn mock_app() -> Router {
        async fn create_session() -> (axum::http::StatusCode, Json<JsonValue>) {
            (
                axum::http::StatusCode::CREATED,
                Json(json!({
                    "metadata": { "session_id": "mock-session-1" },
                    "messages": [],
                })),
            )
        }

        async fn submit_prompt(
            axum::extract::Path(session_id): axum::extract::Path<String>,
        ) -> (axum::http::StatusCode, Json<JsonValue>) {
            // Failure fixtures driven by the session id.
            if session_id.as_str() == "fail500" {
                return (
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "boom" })),
                );
            }
            // Unknown session ids get a 404, mirroring the real backend.
            if session_id.as_str() == "nosuch123" {
                return (
                    axum::http::StatusCode::NOT_FOUND,
                    Json(json!({ "error": "session not found" })),
                );
            }
            (
                axum::http::StatusCode::ACCEPTED,
                Json(json!({
                    "run_id": "mock-run-1",
                    "client_id": "mock-client-1",
                    "display_prompt": "hello from mock",
                    "session": session_id,
                })),
            )
        }

        /// A 202 with a non-JSON body for the malformed-response test.
        async fn run_junk() -> (axum::http::StatusCode, String) {
            (axum::http::StatusCode::ACCEPTED, "not json at all".to_string())
        }

        Router::new()
            .route("/sessions", post(create_session))
            .route("/sessions/{session_id}/runs", post(submit_prompt))
            // A distinct path that returns 202 with a non-JSON body for the
            // malformed-response test (the dynamic route above always 202s).
            .route("/sessions/junk2/runs", post(run_junk))
            .route("/health", get(|| async { "ok" }))
    }

    /// Spin up the mock backend on an ephemeral port and hand back (client, url).
    fn mock_endpoint() -> (Client, Url) {
        let app = mock_app();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let listener = runtime.block_on(async {
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap()
        });
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            runtime.block_on(async {
                axum::serve(listener, app.into_make_service())
                    .await
                    .unwrap();
            });
        });
        let client = Client::new();
        let url = Url::parse(&format!("http://{addr}")).unwrap();
        (client, url)
    }

    #[test]
    fn happy_path_create_and_prompt() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let result = runtime
            .block_on(run_create_and_prompt(&client, &endpoint, None, "hello", &json!({})))
            .unwrap();
        assert_eq!(result.session_id, "mock-session-1");
        assert_eq!(result.run_id, "mock-run-1");
        assert_eq!(result.client_id.as_deref(), Some("mock-client-1"));
        assert_eq!(result.display_prompt, "hello from mock");
        assert_eq!(result.endpoint, endpoint.to_string());
    }

    #[test]
    fn happy_path_reuse_session() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let result = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                Some("existing-session"),
                "hello",
                &json!({}),
            ))
            .unwrap();
        assert_eq!(result.session_id, "existing-session");
        assert_eq!(result.run_id, "mock-run-1");
    }

    #[test]
    fn run_endpoint_500_returns_server_error() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                Some("fail500"),
                "hello",
                &json!({}),
            ))
            .unwrap_err();
        match err {
            NacError::Server { status, body, .. } => {
                assert_eq!(status, 500);
                assert!(body.contains("boom"), "{body}");
            }
            other => panic!("expected Server error, got {other:?}"),
        }
    }

    #[test]
    fn run_endpoint_404_is_server_error() {
        // Use a valid safe id that does not exist on the mock; axum returns 404
        // for unknown session ids.
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                Some("nosuch123"),
                "hello",
                &json!({}),
            ))
            .unwrap_err();
        assert!(
            matches!(err, NacError::Server { status, .. } if status == 404),
            "{err:?}"
        );
    }

    #[test]
    fn malformed_run_response_returns_malformed_error() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                Some("junk2"),
                "hello",
                &json!({}),
            ))
            .unwrap_err();
        match err {
            NacError::MalformedResponse {
                what,
                detail,
                endpoint: e,
                ..
            } => {
                assert_eq!(what, RUN_WHAT);
                // The body excerpt ("not json at all") and serde error appear.
                assert!(detail.contains("not json at all"), "{detail}");
                assert!(detail.contains("serde:"), "{detail}");
                assert_eq!(e, endpoint.to_string());
            }
            other => panic!("expected MalformedResponse, got {other:?}"),
        }
    }

    #[test]
    fn invalid_session_id_rejected_as_usage() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for bad in ["nosuch/123", "a?b", "a#b", "..", "../evil", "a b", ""] {
            let err = runtime
                .block_on(run_create_and_prompt(
                    &client,
                    &endpoint,
                    Some(bad),
                    "hello",
                    &json!({}),
                ))
                .unwrap_err();
            assert!(
                matches!(err, NacError::Usage(_)),
                "id `{bad}` should be a Usage error, got {err:?}"
            );
        }
    }

    #[test]
    fn valid_session_id_accepted() {
        let (client, endpoint) = mock_endpoint();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let result = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                Some("abc-123_XYZ"),
                "hello",
                &json!({}),
            ))
            .unwrap();
        assert_eq!(result.session_id, "abc-123_XYZ");
    }

    #[test]
    fn created_session_leak_hint_on_submit_failure() {
        // A mock where create-session yields an id that 500s on submission, so
        // the created session id must be surfaced in the error hint.
        async fn create_session() -> (axum::http::StatusCode, Json<JsonValue>) {
            (
                axum::http::StatusCode::CREATED,
                Json(json!({
                    "metadata": { "session_id": "fail500" },
                    "messages": [],
                })),
            )
        }
        async fn submit_prompt(
            axum::extract::Path(_session_id): axum::extract::Path<String>,
        ) -> (axum::http::StatusCode, Json<JsonValue>) {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "boom" })),
            )
        }
        let app = Router::new()
            .route("/sessions", post(create_session))
            .route("/sessions/{session_id}/runs", post(submit_prompt));
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let listener = runtime.block_on(async {
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap()
        });
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                axum::serve(listener, app.into_make_service())
                    .await
                    .unwrap();
            });
        });
        let client = Client::new();
        let endpoint = Url::parse(&format!("http://{addr}")).unwrap();

        let err = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                None, // create a new session
                "hello",
                &json!({}),
            ))
            .unwrap_err();
        match err {
            NacError::WithHint { hint, inner } => {
                assert!(hint.contains("fail500"), "{hint}");
                assert!(hint.contains("--session-id fail500"), "{hint}");
                assert!(matches!(
                    inner.as_ref(),
                    NacError::Server { status: 500, .. }
                ));
            }
            other => panic!("expected WithHint carrying the created session, got {other:?}"),
        }
        // Display string should mention the created id too.
        let err = runtime
            .block_on(run_create_and_prompt(
                &client,
                &endpoint,
                None,
                "hello",
                &json!({}),
            ))
            .unwrap_err();
        assert!(err.to_string().contains("fail500"), "{err}");
    }

    #[test]
    fn empty_stdin_prompt_is_usage_error() {
        // A CLI with --stdin but no positional prompt; simulated empty stdin is
        // hard to inject here, so we test the whitespace/empty rejection on the
        // resolved value directly via the positional path and the empty rule.
        let cli = Cli {
            prompt: Some("   ".to_string()),
            nac_endpoint: "http://127.0.0.1:3210".to_string(),
            session_id: None,
            stdin: false,
            model: None,
            backend: None,
            cwd: None,
            reasoning_effort: None,
            json: false,
            verbose: false,
        };
        // Whitespace-only prompt is rejected as empty.
        let err = resolve_prompt(&cli).unwrap_err();
        assert!(err.contains("empty"), "{err}");
    }

    #[test]
    fn timeout_returns_timeout_error() {
        // Build a client with a very short timeout and point it at a handler
        // that never responds (std::future::pending).
        let app = Router::new().route(
            "/sessions/{session_id}/runs",
            post(|| async { std::future::pending::<()>().await }),
        );
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let listener = runtime.block_on(async {
            tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap()
        });
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                axum::serve(listener, app.into_make_service())
                    .await
                    .unwrap();
            });
        });
        let client = build_client_with_timeouts(
            Duration::from_millis(200),
            Duration::from_secs(1),
        )
        .unwrap();
        let endpoint = Url::parse(&format!("http://{addr}")).unwrap();
        let err = runtime
            .block_on(submit_prompt(&client, &endpoint, "sess1", "hello"))
            .unwrap_err();
        assert!(
            matches!(err, NacError::Timeout { .. }),
            "expected Timeout, got {err:?}"
        );
    }

    #[test]
    fn connection_refused_returns_connect_error() {
        // Bind a listener, grab its port, then drop it so nothing listens.
        let addr = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap()
        };
        let client = Client::new();
        let url = Url::parse(&format!("http://{addr}")).unwrap();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let err = runtime
            .block_on(run_create_and_prompt(&client, &url, None, "hello", &json!({})))
            .unwrap_err();
        assert!(
            matches!(err, NacError::ConnectionFailed { .. }),
            "expected ConnectionFailed, got {err:?}"
        );
    }

    #[test]
    fn build_create_body_omits_unset_fields() {
        let cli = Cli {
            prompt: Some("x".to_string()),
            nac_endpoint: "http://127.0.0.1:3210".to_string(),
            session_id: None,
            stdin: false,
            model: None,
            backend: None,
            cwd: None,
            reasoning_effort: None,
            json: false,
            verbose: false,
        };
        assert_eq!(build_create_body(&cli), json!({}));

        let mut cli = cli;
        cli.model = Some("gpt".to_string());
        cli.backend = Some(BackendArg::AnthropicMessages);
        cli.reasoning_effort = Some(ReasoningEffortArg::High);
        assert_eq!(
            build_create_body(&cli),
            json!({
                "model": "gpt",
                "backend": "anthropic-messages",
                "reasoning_effort": "high",
            })
        );
    }
}
