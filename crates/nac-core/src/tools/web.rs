//! Credential-gated native Exa web retrieval for top-level direct agents.
//!
//! `web_fetch` sends a public target URL to Exa Contents. NAC never connects
//! to the target itself. The Exa credential is captured by the admitting
//! model-request capability snapshot and is unavailable to model-visible data.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::tools::kernel::{
    NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices,
};
use crate::tools::{ThreadCancellation, ToolResult};
use crate::types::{FunctionDef, ToolDefinition};

const EXA_API_BASE: &str = "https://api.exa.ai/";
const DEFAULT_SEARCH_RESULTS: u32 = 8;
const MAX_SEARCH_RESULTS: u32 = 20;
const MAX_QUERY_CHARS: usize = 2_000;
const MAX_CONTEXT_CHARS: usize = 1_500;
const MAX_SNIPPET_CHARS: usize = 300;
const DEFAULT_FETCH_CHARS: usize = 20_000;
const MAX_FETCH_CHARS: usize = 50_000;
const MAX_PROVIDER_BYTES: usize = 2 * 1024 * 1024;
const MAX_ERROR_CHARS: usize = 500;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(35);
const MAX_RETRIES: usize = 2;
static HTTP_URL_PATTERN: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"https?://[^\s<>\"']+"#).expect("fixed web URL redaction regex")
});

#[derive(Clone)]
pub(crate) struct ExaCredential(String);

impl ExaCredential {
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }

    fn secret(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ExaCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ExaCredential([REDACTED])")
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchWireInput {
    query: String,
    #[serde(default)]
    num_results: Option<u32>,
}

#[derive(Debug)]
pub(crate) struct WebSearchInput {
    query: String,
    num_results: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct FetchWireInput {
    url: String,
    #[serde(default)]
    max_chars: Option<usize>,
}

#[derive(Debug)]
pub(crate) struct WebFetchInput {
    target: Url,
    max_chars: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExaSearchResponse {
    #[serde(default)]
    results: Vec<ExaResult>,
    #[serde(default)]
    autoprompt_string: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExaContentsResponse {
    #[serde(default)]
    results: Vec<ExaResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExaResult {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    published_date: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    highlights: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct WebSearchOutput {
    query: String,
    retrieved_at_unix_ms: u64,
    context: Option<String>,
    results: Vec<WebSearchResultCard>,
}

#[derive(Debug, Serialize)]
struct WebSearchResultCard {
    url: String,
    domain: String,
    title: Option<String>,
    published_date: Option<String>,
    author: Option<String>,
    score: Option<u32>,
    snippet: Option<String>,
}

#[derive(Debug, Serialize)]
struct WebFetchOutput {
    requested_url: String,
    final_url: String,
    title: Option<String>,
    published_date: Option<String>,
    author: Option<String>,
    word_count: usize,
    truncated: bool,
    retrieved_at_unix_ms: u64,
    content: String,
}

pub(crate) struct WebSearchTool;
pub(crate) struct WebFetchTool;

impl NativeTool for WebSearchTool {
    type Input = WebSearchInput;

    fn definition(&self) -> ToolDefinition {
        search_definition()
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        decode_search(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let digest = Sha256::digest(input.query.as_bytes());
        Ok(vec![PermissionResource::new(
            "web_search",
            format!("search:sha256:{digest:x}"),
        )
        .with_display("Allow `web_search` to search the web?")
        .with_save_resource("search:*")])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(credential) = services.runtime.web_credential.as_ref() else {
                return ToolResult::text(
                    "Error: web_search is unavailable in this capability snapshot",
                    true,
                );
            };
            let endpoint = official_endpoint("search");
            match execute_search(
                input,
                credential,
                endpoint,
                &services.runtime.command_cancellation,
            )
            .await
            {
                Ok(output) => serialized_result(&output, credential),
                Err(error) => web_error("web_search", error, credential),
            }
        })
    }
}

impl NativeTool for WebFetchTool {
    type Input = WebFetchInput;

    fn definition(&self) -> ToolDefinition {
        fetch_definition()
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        decode_fetch(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let resource = permission_url_resource(&input.target);
        let display = display_url(&input.target);
        let origin = target_origin(&input.target);
        Ok(vec![PermissionResource::new("web_fetch", resource)
            .with_display(format!("Allow `web_fetch` to fetch this URL?\n{display}"))
            .with_save_resource(format!("url:{origin}/*"))])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(credential) = services.runtime.web_credential.as_ref() else {
                return ToolResult::text(
                    "Error: web_fetch is unavailable in this capability snapshot",
                    true,
                );
            };
            let endpoint = official_endpoint("contents");
            match execute_fetch(
                input,
                credential,
                endpoint,
                &services.runtime.command_cancellation,
            )
            .await
            {
                Ok(output) => serialized_result(&output, credential),
                Err(error) => web_error("web_fetch", error, credential),
            }
        })
    }
}

pub(crate) fn definitions() -> [ToolDefinition; 2] {
    [search_definition(), fetch_definition()]
}

fn search_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "web_search".to_string(),
            description: "Search the public web with Exa semantic search. Use a natural-language question or description, not a keyword-stuffed query. Returns bounded citable result cards with public URLs and short snippets.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": MAX_QUERY_CHARS,
                        "description": "Natural-language search question or description"
                    },
                    "num_results": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_SEARCH_RESULTS,
                        "description": "Number of results (default 8, maximum 20)"
                    }
                },
                "required": ["query"],
                "additionalProperties": false
            }),
        },
    }
}

fn fetch_definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "web_fetch".to_string(),
            description: "Retrieve bounded text for one public HTTP or HTTPS URL through Exa Contents. NAC sends the URL to Exa and never connects directly to the target. Returns validated public metadata and content.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "maxLength": 8_192,
                        "description": "Public HTTP or HTTPS URL to retrieve"
                    },
                    "max_chars": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": MAX_FETCH_CHARS,
                        "description": "Maximum decoded content characters (default 20000, maximum 50000)"
                    }
                },
                "required": ["url"],
                "additionalProperties": false
            }),
        },
    }
}

fn decode_search(value: Value) -> Result<WebSearchInput, ToolResult> {
    let wire: SearchWireInput = serde_json::from_value(value).map_err(|error| {
        ToolResult::text(
            format!("Error: invalid web_search arguments: {error}"),
            true,
        )
    })?;
    let query = wire.query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(ToolResult::text(
            format!("Error: web_search query must contain 1 to {MAX_QUERY_CHARS} characters"),
            true,
        ));
    }
    let num_results = wire.num_results.unwrap_or(DEFAULT_SEARCH_RESULTS);
    if !(1..=MAX_SEARCH_RESULTS).contains(&num_results) {
        return Err(ToolResult::text(
            format!("Error: web_search num_results must be between 1 and {MAX_SEARCH_RESULTS}"),
            true,
        ));
    }
    Ok(WebSearchInput {
        query: query.to_string(),
        num_results,
    })
}

fn decode_fetch(value: Value) -> Result<WebFetchInput, ToolResult> {
    let wire: FetchWireInput = serde_json::from_value(value).map_err(|error| {
        ToolResult::text(format!("Error: invalid web_fetch arguments: {error}"), true)
    })?;
    if wire.url.len() > 8_192 {
        return Err(ToolResult::text("Error: web_fetch URL is too long", true));
    }
    let target = validate_public_url(&wire.url).map_err(|error| {
        ToolResult::text(
            format!("Error: web_fetch URL is not allowed: {error}"),
            true,
        )
    })?;
    let max_chars = wire.max_chars.unwrap_or(DEFAULT_FETCH_CHARS);
    if !(1..=MAX_FETCH_CHARS).contains(&max_chars) {
        return Err(ToolResult::text(
            format!("Error: web_fetch max_chars must be between 1 and {MAX_FETCH_CHARS}"),
            true,
        ));
    }
    Ok(WebFetchInput { target, max_chars })
}

async fn execute_search(
    input: WebSearchInput,
    credential: &ExaCredential,
    endpoint: Url,
    cancellation: &ThreadCancellation,
) -> Result<WebSearchOutput> {
    let body = json!({
        "query": input.query,
        "numResults": input.num_results,
        "type": "neural",
        "contents": {
            "text": { "maxCharacters": 500 },
            "highlights": { "numSentences": 2, "highlightsPerUrl": 2 },
            "summary": {}
        }
    });
    let response: ExaSearchResponse =
        request_json(endpoint, body, credential, cancellation).await?;
    let mut results = Vec::with_capacity(response.results.len().min(input.num_results as usize));
    for result in response
        .results
        .into_iter()
        .take(input.num_results as usize)
    {
        if cancellation.is_cancelled() {
            return Err(anyhow!("web retrieval cancelled"));
        }
        let parsed = validate_public_url(&result.url)
            .context("Exa search returned a non-public or invalid result URL")?;
        let url = result_url(&parsed);
        let domain = parsed
            .host_str()
            .expect("validated URL has a host")
            .to_string();
        let snippet = result
            .highlights
            .as_ref()
            .and_then(|highlights| highlights.iter().find(|value| !value.trim().is_empty()))
            .or(result.summary.as_ref())
            .map(|value| trim_chars(value, MAX_SNIPPET_CHARS));
        results.push(WebSearchResultCard {
            url,
            domain,
            title: trim_optional(result.title, 500),
            published_date: trim_optional(result.published_date, 100),
            author: trim_optional(result.author, 300),
            score: result.score.map(scale_score),
            snippet,
        });
    }
    if cancellation.is_cancelled() {
        return Err(anyhow!("web retrieval cancelled"));
    }
    Ok(WebSearchOutput {
        query: input.query,
        retrieved_at_unix_ms: now_ms(),
        context: response
            .autoprompt_string
            .map(|value| trim_chars(&value, MAX_CONTEXT_CHARS)),
        results,
    })
}

async fn execute_fetch(
    input: WebFetchInput,
    credential: &ExaCredential,
    endpoint: Url,
    cancellation: &ThreadCancellation,
) -> Result<WebFetchOutput> {
    let requested_url = input.target.to_string();
    let provider_char_limit = u32::try_from(input.max_chars).expect("fetch bound fits u32");
    let body = json!({
        "urls": [requested_url],
        "contents": { "text": { "maxCharacters": provider_char_limit } },
        "livecrawl": "fallback",
        "filterEmptyResults": true
    });
    let mut response: ExaContentsResponse =
        request_json(endpoint, body, credential, cancellation).await?;
    if cancellation.is_cancelled() {
        return Err(anyhow!("web retrieval cancelled"));
    }
    if response.results.len() != 1 {
        return Err(anyhow!(
            "Exa Contents returned {} results for one requested URL",
            response.results.len()
        ));
    }
    let result = response.results.remove(0);
    let final_url = validate_public_url(&result.url)
        .context("Exa Contents returned a non-public or invalid final URL")?;
    let raw_content = result
        .text
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("Exa Contents returned no text for the requested URL"))?;
    let truncated = raw_content.chars().count() > input.max_chars;
    let content = trim_chars_without_suffix(&raw_content, input.max_chars);
    if cancellation.is_cancelled() {
        return Err(anyhow!("web retrieval cancelled"));
    }
    Ok(WebFetchOutput {
        requested_url: result_url(&input.target),
        final_url: result_url(&final_url),
        title: trim_optional(result.title, 500),
        published_date: trim_optional(result.published_date, 100),
        author: trim_optional(result.author, 300),
        word_count: content.split_whitespace().count(),
        truncated,
        retrieved_at_unix_ms: now_ms(),
        content,
    })
}

async fn request_json<T: serde::de::DeserializeOwned>(
    endpoint: Url,
    body: Value,
    credential: &ExaCredential,
    cancellation: &ThreadCancellation,
) -> Result<T> {
    let origin = provider_origin(&endpoint)?;
    let redirect_origin = origin.clone();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() < 3
                && provider_origin(attempt.url()).ok().as_ref() == Some(&redirect_origin)
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .context("failed to initialize Exa HTTP client")?;
    let operation = async {
        for attempt in 0..=MAX_RETRIES {
            if cancellation.is_cancelled() {
                return Err(anyhow!("web retrieval cancelled"));
            }
            let send = client
                .post(endpoint.clone())
                .header("x-api-key", credential.secret())
                .header("accept", "application/json")
                .json(&body)
                .send();
            let response = tokio::select! {
                response = send => response.context("Exa request failed")?,
                () = cancellation.cancelled() => return Err(anyhow!("web retrieval cancelled")),
            };
            let status = response.status();
            let bytes = read_bounded_body(response, cancellation).await?;
            if status.is_success() {
                if cancellation.is_cancelled() {
                    return Err(anyhow!("web retrieval cancelled"));
                }
                let decoded = serde_json::from_slice(&bytes)
                    .context("Exa returned an invalid bounded JSON response")?;
                if cancellation.is_cancelled() {
                    return Err(anyhow!("web retrieval cancelled"));
                }
                return Ok(decoded);
            }
            if is_retryable(status) && attempt < MAX_RETRIES {
                let delay = Duration::from_millis(250 * (1_u64 << attempt));
                tokio::select! {
                    () = tokio::time::sleep(delay) => {},
                    () = cancellation.cancelled() => return Err(anyhow!("web retrieval cancelled")),
                }
                continue;
            }
            return Err(provider_status_error(status, &bytes, credential));
        }
        unreachable!("bounded retry loop always returns")
    };
    tokio::time::timeout(TOTAL_TIMEOUT, operation)
        .await
        .map_err(|_| anyhow!("Exa request exceeded the total timeout"))?
}

async fn read_bounded_body(
    response: reqwest::Response,
    cancellation: &ThreadCancellation,
) -> Result<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            () = cancellation.cancelled() => return Err(anyhow!("web retrieval cancelled")),
        };
        let Some(chunk) = chunk else {
            return Ok(bytes);
        };
        let chunk = chunk.context("failed to read bounded Exa response")?;
        if bytes.len().saturating_add(chunk.len()) > MAX_PROVIDER_BYTES {
            return Err(anyhow!("Exa response exceeded the provider byte limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
}

fn provider_status_error(
    status: StatusCode,
    body: &[u8],
    credential: &ExaCredential,
) -> anyhow::Error {
    let provider_message = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .or_else(|| value.get("error"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "provider returned no safe diagnostic".to_string());
    let provider_message =
        redact_exa_credential(&trim_chars(&provider_message, MAX_ERROR_CHARS), credential);
    anyhow!(
        "Exa request failed with status {status}: {}",
        redact_url_queries(&provider_message)
    )
}

fn web_error(tool: &str, error: anyhow::Error, credential: &ExaCredential) -> ToolResult {
    let diagnostic = redact_exa_credential(&redact_url_queries(&format!("{error:#}")), credential);
    ToolResult::text(
        format!("Error: {tool} failed: {}", trim_chars(&diagnostic, 2_000)),
        true,
    )
}

fn serialized_result(output: &impl Serialize, credential: &ExaCredential) -> ToolResult {
    match serde_json::to_string_pretty(output) {
        Ok(output) => {
            let output = redact_exa_credential(&output, credential);
            ToolResult::text(redact_url_queries(&output), false)
        }
        Err(error) => ToolResult::text(
            format!("Error: web result serialization failed: {error}"),
            true,
        ),
    }
}

fn redact_exa_credential(text: &str, credential: &ExaCredential) -> String {
    let secret = credential.secret();
    let exact = if secret.is_empty() {
        text.to_string()
    } else {
        text.replace(secret, "[REDACTED]")
    };
    crate::model::redact_credentials(&exact, &[secret])
}

fn official_endpoint(path: &str) -> Url {
    Url::parse(EXA_API_BASE)
        .expect("fixed Exa base URL")
        .join(path)
        .expect("fixed Exa endpoint path")
}

fn provider_origin(url: &Url) -> Result<String> {
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("Exa endpoint has no host"))?;
    Ok(format!(
        "{}://{}:{}",
        url.scheme(),
        host.to_ascii_lowercase(),
        url.port_or_known_default()
            .ok_or_else(|| anyhow!("Exa endpoint has no effective port"))?
    ))
}

fn is_retryable(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn validate_public_url(raw: &str) -> Result<Url> {
    if raw.len() > 8_192 {
        return Err(anyhow!("URL exceeds the length limit"));
    }
    let mut url = Url::parse(raw).map_err(|_| anyhow!("expected an absolute public URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(anyhow!("only http and https schemes are supported"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("embedded URL credentials are not allowed"));
    }
    let host = url.host().ok_or_else(|| anyhow!("URL has no host"))?;
    let public = match host {
        url::Host::Ipv4(address) => is_public_ipv4(address),
        url::Host::Ipv6(address) => is_public_ipv6(address),
        url::Host::Domain(domain) => is_public_domain(domain),
    };
    if !public {
        return Err(anyhow!(
            "local, private, or reserved targets are not allowed"
        ));
    }
    url.set_fragment(None);
    Ok(url)
}

fn is_public_domain(domain: &str) -> bool {
    let domain = domain.trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() || !domain.contains('.') {
        return false;
    }
    if matches!(
        domain.as_str(),
        "example.com" | "example.net" | "example.org"
    ) {
        return false;
    }
    ![
        "localhost",
        "local",
        "internal",
        "home.arpa",
        "test",
        "invalid",
        "example",
        "onion",
    ]
    .iter()
    .any(|reserved| domain == *reserved || domain.ends_with(&format!(".{reserved}")))
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, d] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224
        || (a == 255 && b == 255 && c == 255 && d == 255))
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let global_unicast = segments[0] & 0xe000 == 0x2000;
    let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
    global_unicast && !documentation
}

fn permission_url_resource(url: &Url) -> String {
    let mut base = url.clone();
    let query = base.query().map(str::to_string);
    base.set_query(None);
    base.set_fragment(None);
    match query {
        Some(query) => {
            let digest = Sha256::digest(query.as_bytes());
            format!("url:{base}?query_sha256={digest:x}")
        }
        None => format!("url:{base}"),
    }
}

fn display_url(url: &Url) -> String {
    let had_query = url.query().is_some();
    let mut display = url.clone();
    display.set_query(None);
    display.set_fragment(None);
    if had_query {
        format!("{display}?[query omitted]")
    } else {
        display.to_string()
    }
}

fn target_origin(url: &Url) -> String {
    format!(
        "{}://{}:{}",
        url.scheme(),
        url.host_str().expect("validated URL has a host"),
        url.port_or_known_default()
            .expect("http(s) URL has an effective port")
    )
}

fn result_url(url: &Url) -> String {
    let mut result = url.clone();
    result.set_query(None);
    result.set_fragment(None);
    result.to_string()
}

fn redact_url_queries(text: &str) -> String {
    HTTP_URL_PATTERN
        .replace_all(text, |captures: &regex::Captures<'_>| {
            let raw = captures.get(0).expect("whole URL capture").as_str();
            let Ok(mut url) = Url::parse(raw) else {
                return raw.to_string();
            };
            if url.query().is_none() && url.fragment().is_none() {
                return raw.to_string();
            }
            url.set_query(None);
            url.set_fragment(None);
            format!("{url}?[query omitted]")
        })
        .into_owned()
}

fn trim_optional(value: Option<String>, max: usize) -> Option<String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(|value| trim_chars(&value, max))
}

fn trim_chars(value: &str, max: usize) -> String {
    match value.char_indices().nth(max) {
        Some((index, _)) => format!("{}…", &value[..index]),
        None => value.to_string(),
    }
}

fn trim_chars_without_suffix(value: &str, max: usize) -> String {
    match value.char_indices().nth(max) {
        Some((index, _)) => value[..index].to_string(),
        None => value.to_string(),
    }
}

fn scale_score(score: f64) -> u32 {
    if !score.is_finite() || score <= 0.0 {
        return 0;
    }
    if score >= 1.0 {
        return 100;
    }
    (score * 100.0).round() as u32
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "web_tests.rs"]
mod tests;
