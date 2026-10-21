//! Automatic review of eligible Ask requests ("Approve for me").
//!
//! Review runs only after ordered configured rules, hard denials and
//! remembered grants have produced Ask. A reviewer can answer one prepared
//! invocation once; it cannot deny on deterministic grounds, create grants,
//! or change the backend. Everything a reviewer sees is a bounded, redacted
//! projection of the prepared request, never model output or tool results.

use std::collections::VecDeque;
use std::sync::OnceLock;

use futures_util::future::BoxFuture;
use regex::Regex;

use super::*;

/// Total time allowed for one review, including at most one transient retry.
pub const REVIEW_DEADLINE: Duration = Duration::from_secs(30);

const CONSECUTIVE_BLOCK_LIMIT: usize = 3;
const BLOCK_WINDOW: usize = 50;
const WINDOW_BLOCK_LIMIT: usize = 10;
const CONSECUTIVE_UNAVAILABLE_LIMIT: usize = 2;
const RECENT_BLOCKED_LIMIT: usize = 10;
const RECENT_REVIEW_LIMIT: usize = 20;
const AUTHORIZED_RETRY_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_DISPLAY_CHARS: usize = 1_000;
const MAX_INTENT_CHARS: usize = 8_000;
const REDACTED: &str = "«redacted»";

/// One resource as the reviewer sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ReviewResource {
    pub action: String,
    pub resource: String,
    pub display: String,
}

/// The complete reviewer input for one prepared invocation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReviewRequest {
    pub tool: String,
    /// `local`, `ssh`, `podman` or `podman_with_host_mounts`.
    pub backend: &'static str,
    pub resources: Vec<ReviewResource>,
    /// The messages a person typed to the session tree that owns the answer
    /// policy since Approve for me was last turned off, oldest first. Never assistant text or tool
    /// output. A request is built only when every message can be shown in
    /// full; empty only in reviewer tests and fixtures.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub user_intent: Vec<String>,
    /// The user explicitly authorized retrying this exact blocked action.
    pub user_authorized_retry: bool,
}

/// Risk category reported by a reviewer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ReviewCategory {
    Routine,
    Destructive,
    Exfiltration,
    Credential,
    OutOfScope,
    Unclear,
}

impl ReviewCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Routine => "routine",
            Self::Destructive => "destructive",
            Self::Exfiltration => "exfiltration",
            Self::Credential => "credential",
            Self::OutOfScope => "out_of_scope",
            Self::Unclear => "unclear",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "routine" => Self::Routine,
            "destructive" => Self::Destructive,
            "exfiltration" => Self::Exfiltration,
            "credential" => Self::Credential,
            "out_of_scope" => Self::OutOfScope,
            "unclear" => Self::Unclear,
            _ => return None,
        })
    }
}

/// A reviewer's answer. A reviewer cannot express Always.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewVerdict {
    ApproveOnce,
    Reject(ReviewCategory),
    Uncertain(Option<ReviewCategory>),
}

/// The narrow port the broker uses. Adapters (Jev, test fakes, a future
/// open-source reviewer) live outside the permission domain.
pub trait PermissionReviewer: Send + Sync {
    /// Reviews one invocation. Implementations own their deadline handling
    /// but the broker also bounds the call by [`REVIEW_DEADLINE`].
    fn review<'a>(
        &'a self,
        request: &'a ReviewRequest,
    ) -> BoxFuture<'a, Result<ReviewVerdict, ReviewUnavailable>>;

    /// Local check, without a network request, that the reviewer has the
    /// credentials it needs. Used before the mode can be selected. It may
    /// read credential files, so callers run it off the async workers.
    fn check_available(&self) -> Result<(), String>;

    /// Stable reviewer identity recorded with each decision.
    fn identity(&self) -> String;
}

/// The outcome reported to clients and recorded for audit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PermissionReviewOutcome {
    Approved,
    Rejected,
    Uncertain,
    Unavailable,
}

/// Stable machine-readable codes returned to the model with an unexecuted
/// operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PermissionReviewCode {
    ReviewRejected,
    ReviewUncertain,
    ReviewUnavailable,
    ReviewStopped,
}

impl PermissionReviewCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReviewRejected => "review_rejected",
            Self::ReviewUncertain => "review_uncertain",
            Self::ReviewUnavailable => "review_unavailable",
            Self::ReviewStopped => "review_stopped",
        }
    }
}

/// Redacted record of one automatic review, emitted to clients. It carries
/// no arguments beyond the redacted display already shown to the reviewer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionReview {
    pub id: String,
    pub session_id: String,
    pub call_id: Option<String>,
    pub tool: String,
    pub backend: String,
    pub resources: Vec<ReviewResource>,
    pub user_authorized_retry: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<PermissionReviewOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<PermissionReviewCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<ReviewCategory>,
    /// A fixed, safe explanation for an unavailable review. No provider text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<PermissionReviewFailureReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub reviewer: String,
    pub created_at_epoch_ms: u64,
}

/// Why an Ask request keeps the manual path instead of review.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Ineligible(pub &'static str);

/// Decides whether a whole prepared invocation may be reviewed. Every
/// resource must be eligible; one ineligible resource keeps the manual path.
pub(crate) fn review_eligibility(
    resources: &[PermissionResource],
    backend: impl Into<ReviewBackend>,
) -> Result<(), Ineligible> {
    let backend = backend.into();
    for resource in resources {
        // Credential operands are excluded whatever action carries them:
        // shell projection uses execute_path for file operands, and canonical
        // command resources embed their operands.
        if mentions_credential(&resource.resource) {
            return Err(Ineligible(
                "credential files are never reviewed automatically",
            ));
        }
        match resource.action.as_str() {
            // An external_directory guard accompanies a read or an edit; edits
            // fall to the last arm, so only reads outside the workspace pass.
            "execute" | "execute_cwd" | "execute_path" | "read" | "glob" | "grep"
            | "external_directory" => {}
            "execute_broad" if backend == ReviewBackend::Podman => {}
            "execute_broad" => {
                return Err(Ineligible(
                    "arbitrary code execution outside a workspace-only sandbox is never reviewed automatically",
                ));
            }
            "execute_opaque" => {
                return Err(Ineligible(
                    "unsupported shell syntax is never reviewed automatically",
                ));
            }
            "terminal_input" => {
                return Err(Ineligible("terminal input is never reviewed automatically"));
            }
            _ => {
                return Err(Ineligible(
                    "this kind of operation is not eligible for automatic review",
                ));
            }
        }
    }
    Ok(())
}

/// Builds the reviewer projection. Fails as ineligible when redaction had to
/// remove content, because the reviewer would be judging an incomplete action.
pub(crate) fn review_request(
    tool: &str,
    resources: &[PermissionResource],
    backend: impl Into<ReviewBackend>,
    user_intent: &[String],
    user_authorized_retry: bool,
    secrets: &ExactSecrets,
) -> Result<ReviewRequest, Ineligible> {
    let mut projected = Vec::with_capacity(resources.len());
    for resource in resources {
        let (display, display_redacted) = redact_text_with(&resource.display, secrets);
        let (canonical, canonical_redacted) = redact_text_with(&resource.resource, secrets);
        if display_redacted || canonical_redacted {
            return Err(Ineligible(
                "the operation carries secret-bearing values that cannot be shown to the reviewer",
            ));
        }
        if display.chars().count() > MAX_DISPLAY_CHARS
            || canonical.chars().count() > MAX_DISPLAY_CHARS
        {
            return Err(Ineligible(
                "the operation is too long to describe to the reviewer",
            ));
        }
        projected.push(ReviewResource {
            action: resource.action.clone(),
            resource: canonical,
            display,
        });
    }
    // The reviewer judges scope from the person's messages, so they are
    // shown whole or not at all. Dropping or cutting one could hide a
    // restriction, and pattern matching cannot prove the rest of free text
    // is free of secrets once one was found.
    if user_intent.iter().all(|message| message.trim().is_empty()) {
        return Err(Ineligible("the person's request is empty"));
    }
    if user_intent
        .iter()
        .any(|message| redact_text_with(message, secrets).1)
    {
        return Err(Ineligible(
            "the person's request carries secret-bearing values that cannot be shown to the reviewer",
        ));
    }
    if user_intent
        .iter()
        .map(|message| message.chars().count())
        .sum::<usize>()
        > MAX_INTENT_CHARS
    {
        return Err(Ineligible(
            "the person's request is too long to show the reviewer in full",
        ));
    }
    Ok(ReviewRequest {
        tool: tool.to_owned(),
        backend: backend_name(backend.into()),
        resources: projected,
        user_intent: user_intent.to_vec(),
        user_authorized_retry,
    })
}

/// Where a reviewed operation runs. A Podman sandbox counts as confined only
/// when its one writable host directory is a workspace without Git
/// metadata; otherwise code running there can change other host data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReviewBackend {
    Local,
    Ssh,
    Podman,
    PodmanWithHostMounts,
}

impl From<PermissionBackend> for ReviewBackend {
    fn from(backend: PermissionBackend) -> Self {
        match backend {
            PermissionBackend::Local => Self::Local,
            PermissionBackend::Ssh => Self::Ssh,
            PermissionBackend::Podman => Self::Podman,
        }
    }
}

/// Where a session's reviews run. A Podman sandbox is classified again at
/// every review: Git metadata can appear in its workspace after the session
/// starts, for example when someone runs `git init` there.
#[derive(Clone, Debug)]
pub(crate) enum ReviewBackendSource {
    Fixed(ReviewBackend),
    Sandbox(Box<crate::sandbox::SandboxSpec>),
}

impl ReviewBackendSource {
    pub(crate) fn from_execution_backend(backend: &crate::sandbox::ExecutionBackend) -> Self {
        match backend {
            crate::sandbox::ExecutionBackend::Sandbox(session) => {
                Self::Sandbox(Box::new(session.spec().clone()))
            }
            backend => Self::Fixed(PermissionBackend::from_execution_backend(backend).into()),
        }
    }

    /// The backend as of now. For a sandbox this reads its workspace, so
    /// call it off the async workers.
    pub(crate) fn current(&self) -> ReviewBackend {
        match self {
            Self::Fixed(backend) => *backend,
            Self::Sandbox(spec) if spec.mounts_host_data_beyond_workspace() => {
                ReviewBackend::PodmanWithHostMounts
            }
            Self::Sandbox(_) => ReviewBackend::Podman,
        }
    }
}

pub(crate) fn backend_name(backend: ReviewBackend) -> &'static str {
    match backend {
        ReviewBackend::Local => "local",
        ReviewBackend::Ssh => "ssh",
        ReviewBackend::Podman => "podman",
        ReviewBackend::PodmanWithHostMounts => "podman_with_host_mounts",
    }
}

/// Identity of an invocation for matching an explicit retry authorization.
/// It names the tool and canonical resources, not the call id, because a
/// retry is a new call.
pub(crate) fn invocation_fingerprint(tool: &str, resources: &[PermissionResource]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(tool.as_bytes());
    for resource in resources {
        hasher.update([0]);
        hasher.update(resource.action.as_bytes());
        hasher.update([0]);
        hasher.update(resource.resource.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn mentions_credential(resource: &str) -> bool {
    resource
        .split(|character: char| {
            character.is_whitespace()
                || matches!(character, '[' | ']' | '=' | ',' | ';' | '\'' | '"')
        })
        .filter(|operand| !operand.is_empty())
        .any(credential_path)
}

fn credential_path(path: &str) -> bool {
    let lower = path.replace('\\', "/").to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or(&lower);
    (name.starts_with(".env") && name != ".env.example")
        || matches!(
            name,
            ".netrc"
                | ".npmrc"
                | ".pypirc"
                | ".git-credentials"
                | "credentials"
                | "credentials.json"
                | "id_rsa"
                | "id_ecdsa"
                | "id_ed25519"
                | "id_dsa"
                | "auth.json"
                | "arcee_auth.json"
                | "credentials.toml"
                | "credentials.tfrc.json"
                | ".pgpass"
                | ".vault-token"
                | ".terraformrc"
                | ".boto"
                | ".authinfo"
                | ".authinfo.gpg"
                | ".bash_history"
                | ".zsh_history"
                | ".python_history"
                | ".mysql_history"
                | ".psql_history"
        )
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.ends_with(".p12")
        || name.ends_with(".pfx")
        || [
            "/.ssh/",
            "/.aws/",
            "/.gnupg/",
            "/.kube/",
            "/.docker/",
            "/.azure/",
            "/.password-store/",
            "/.config/hub/",
            "/.config/gcloud/",
            "/.config/gh/",
            "/.config/nac/",
        ]
        .iter()
        .any(|segment| format!("/{}/", lower.trim_matches('/')).contains(segment))
        || (lower.starts_with("/proc/") && lower.ends_with("/environ"))
        || lower.starts_with("/run/secrets/")
        || lower.starts_with("/var/run/secrets/")
        || matches!(lower.as_str(), "/etc/shadow" | "/etc/gshadow")
}

/// Replaces credential-shaped values. Returns whether anything was replaced.
/// Exact credential values known to this process, removed before any text
/// reaches the reviewer, in addition to the shape patterns.
/// Names whose values are treated as secrets: environment variables,
/// assignments, JSON and YAML keys.
const SECRET_NAME: &str = r"(?:[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|COOKIE|PRIVATE)[A-Za-z0-9_]*|[A-Za-z0-9_]*_(?:AUTH|PASS|SESSION)|(?:AUTH|PASS|SESSION)(?:_[A-Za-z0-9_]*)?|AUTHORIZATION)";

/// Whether a whole variable name is secret-shaped, by the same rule that
/// redacts secret-named assignments.
#[expect(
    clippy::expect_used,
    reason = "the secret-name pattern is a compile-time literal covered by redaction tests"
)]
pub(crate) fn is_secret_name(name: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| {
            Regex::new(&format!("(?i)^{SECRET_NAME}$")).expect("secret-name pattern compiles")
        })
        .is_match(name)
}

#[derive(Default)]
pub(crate) struct ExactSecrets {
    values: Vec<String>,
    command_environment: Option<nac_contracts::CommandEnvironmentSnapshot>,
}

impl ExactSecrets {
    /// NAC's stored credentials and secret-named process variables, plus
    /// the managed command-environment redactions when a provider exists.
    pub(crate) fn current(
        command_environment: Option<&dyn nac_contracts::CommandEnvironmentProvider>,
    ) -> Result<Self, Ineligible> {
        // A configured provider that cannot report its secrets would leave
        // the projection with partial knowledge; keep the manual path.
        let command_environment = command_environment
            .map(nac_contracts::CommandEnvironmentProvider::redaction_snapshot)
            .transpose()
            .map_err(|_| Ineligible("managed command secrets could not be loaded for redaction"))?;
        // The same holds for NAC's own credential stores.
        let values = crate::model::known_credential_values()
            .map_err(|_| Ineligible("stored credentials could not be loaded for redaction"))?;
        Ok(Self {
            values,
            command_environment,
        })
    }

    #[cfg(test)]
    pub(crate) fn from_values(values: impl IntoIterator<Item = String>) -> Self {
        Self {
            values: values.into_iter().collect(),
            command_environment: None,
        }
    }
}

#[cfg(test)]
pub(crate) fn redact_text(text: &str) -> (String, bool) {
    redact_text_with(text, &ExactSecrets::default())
}

#[expect(
    clippy::expect_used,
    reason = "the review redaction patterns are compile-time literals covered by redaction tests"
)]
pub(crate) fn redact_text_with(text: &str, secrets: &ExactSecrets) -> (String, bool) {
    static PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        // A secret value is a quoted string or an unquoted run of
        // non-space, non-quote characters.
        const VALUE: &str = r#"(?:"[^"]*"|'[^']*'|[^\s'"]+)"#;
        const NAME: &str = SECRET_NAME;
        [
            // Header values and bearer tokens.
            (
                format!(
                    r"(?i)\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)\s*:\s*{VALUE}(\s+[^\s'\x22]+)?"
                ),
                "$1: «redacted»",
            ),
            (
                r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}".to_string(),
                "Bearer «redacted»",
            ),
            // URL user information.
            (
                r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@".to_string(),
                "${1}«redacted»@",
            ),
            // JSON style quoted secret-named keys, and YAML style keys at the
            // start of a line. Bare prose such as NAC's own "broad executable
            // authority: …" display must not match.
            (
                format!(r#"(?i)((["']){NAME}["']\s*:\s*){VALUE}"#),
                "${1}«redacted»",
            ),
            (
                format!(r"(?im)(^\s*{NAME}\s*:\s*){VALUE}"),
                "${1}«redacted»",
            ),
            // Secret-named assignments and options.
            (format!(r"(?i)\b({NAME})\s*=\s*{VALUE}"), "$1=«redacted»"),
            (
                format!(
                    r"(?i)(--?(?:password|passwd|pass|token|secret|api[-_]?key|access[-_]?key|auth|cookie)(?:=|\s+|\]\[)){VALUE}"
                ),
                "${1}«redacted»",
            ),
            // Known credential shapes.
            (r"\bsk-[A-Za-z0-9_-]{16,}".to_string(), "«redacted»"),
            (r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}".to_string(), "«redacted»"),
            (r"\bgithub_pat_[A-Za-z0-9_]{20,}".to_string(), "«redacted»"),
            (r"\bxox[abprs]-[A-Za-z0-9-]{10,}".to_string(), "«redacted»"),
            (r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b".to_string(), "«redacted»"),
            (r"\bAIza[0-9A-Za-z_-]{30,}".to_string(), "«redacted»"),
            (
                r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}".to_string(),
                "«redacted»",
            ),
            (r"-----BEGIN [A-Z ]*PRIVATE KEY-----".to_string(), "«redacted»"),
        ]
        .into_iter()
        .map(|(pattern, replacement)| {
            (
                Regex::new(&pattern).expect("review redaction pattern is valid"),
                replacement,
            )
        })
        .collect()
    });
    let mut redacted = match &secrets.command_environment {
        Some(snapshot) => snapshot.redact(text),
        None => text.to_owned(),
    };
    let exact = secrets
        .values
        .iter()
        .map(String::as_str)
        .filter(|secret| !secret.is_empty())
        .collect::<Vec<_>>();
    redacted = crate::model::redact_credentials(&redacted, &exact);
    let mut changed = redacted != text;
    if changed {
        redacted = redacted.replace(crate::model::REDACTED_MARKER, REDACTED);
    }
    for (pattern, replacement) in patterns {
        let next = pattern.replace_all(&redacted, *replacement).into_owned();
        if next != redacted {
            changed = true;
            redacted = next;
        }
    }
    (redacted, changed)
}

/// Text returned to the model for an unexecuted reviewed operation. It names
/// a stable code and a fixed next step, never the reviewer's own words.
pub(crate) fn blocked_message(
    code: PermissionReviewCode,
    category: Option<ReviewCategory>,
) -> String {
    let reason = match (code, category) {
        (PermissionReviewCode::ReviewRejected, Some(category)) => {
            format!(
                "automatic review rejected this operation (category: {})",
                category.as_str()
            )
        }
        (PermissionReviewCode::ReviewRejected, None) => {
            "automatic review rejected this operation".to_string()
        }
        (PermissionReviewCode::ReviewUncertain, _) => {
            "automatic review could not confirm this operation is safe".to_string()
        }
        (PermissionReviewCode::ReviewUnavailable, _) => {
            "automatic review is unavailable".to_string()
        }
        (PermissionReviewCode::ReviewStopped, _) => {
            "automatic review stopped this run after repeated blocked operations".to_string()
        }
    };
    let next = match code {
        PermissionReviewCode::ReviewUnavailable => {
            "Do not retry immediately. Tell the user review is unavailable; they can retry later or switch to Manual approval."
        }
        _ => {
            "Do not attempt the same outcome through a workaround, indirect execution or a variant command. Use a materially safer alternative, or stop and ask the user, who can authorize a retry."
        }
    };
    format!(
        "{reason}; code={}; operation_executed=false. {next}",
        code.as_str()
    )
}

/// The user-authored message that asks the model to retry a blocked action
/// the user explicitly authorized. It names the action exactly as the user
/// saw it and says the retry is reviewed again.
pub fn retry_authorization_message(review: &PermissionReview) -> String {
    let action = review
        .resources
        .iter()
        .map(|resource| resource.display.as_str())
        .filter(|display| !display.is_empty())
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "I authorize retrying this blocked action once: `{}` {action}. Retry exactly this action; it will be reviewed again before it runs.",
        review.tool
    )
}

/// A captured run capability is permanently closed on stop or retirement.
/// A successor receives a new capability; old futures cannot adopt it.
#[derive(Clone, Default)]
pub(crate) struct ReviewRunPermit {
    wake: crate::tools::ThreadCancellation,
    grants: Arc<crate::store::PermissionGrantCommitFence>,
}

impl ReviewRunPermit {
    pub(crate) fn close(&self) {
        self.grants.close();
        self.wake.cancel();
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.grants.is_closed()
    }

    pub(crate) async fn cancelled(&self) {
        self.wake.cancelled().await;
    }

    pub(crate) fn grant_fence(&self) -> Arc<crate::store::PermissionGrantCommitFence> {
        Arc::clone(&self.grants)
    }

    pub(crate) async fn settle(&self) {
        let fence = Arc::clone(&self.grants);
        if let Err(error) = tokio::task::spawn_blocking(move || fence.settle()).await {
            eprintln!("nac: stopped permission grant settlement failed: {error}");
        }
    }
}

/// Per-run review limits. Counts span all variants of a request, which is
/// what catches near-variant retries after a rejection.
#[derive(Default)]
pub(crate) struct ReviewRunState {
    consecutive_blocks: usize,
    window: VecDeque<bool>,
    consecutive_unavailable: usize,
    stop: Option<String>,
    // This run owns its own latched wake-up; taking the diagnostic cannot
    // reopen authorization, and a successor run gets an independent signal.
    stop_signal: ReviewRunPermit,
}

impl ReviewRunState {
    pub(crate) fn stopped(&self) -> bool {
        self.stop_signal.is_closed()
    }

    pub(crate) fn stop_signal(&self) -> ReviewRunPermit {
        self.stop_signal.clone()
    }

    pub(crate) fn record(&mut self, outcome: PermissionReviewOutcome) {
        if self.stopped() {
            return;
        }
        let blocked = matches!(
            outcome,
            PermissionReviewOutcome::Rejected | PermissionReviewOutcome::Uncertain
        );
        match outcome {
            PermissionReviewOutcome::Unavailable => {
                self.consecutive_unavailable += 1;
            }
            _ => {
                self.consecutive_unavailable = 0;
                self.consecutive_blocks = if blocked {
                    self.consecutive_blocks + 1
                } else {
                    0
                };
                self.window.push_back(blocked);
                if self.window.len() > BLOCK_WINDOW {
                    self.window.pop_front();
                }
            }
        }
        if self.stop.is_some() {
            return;
        }
        let window_blocks = self.window.iter().filter(|blocked| **blocked).count();
        if self.consecutive_blocks >= CONSECUTIVE_BLOCK_LIMIT {
            self.stop = Some(format!(
                "Stopped after {CONSECUTIVE_BLOCK_LIMIT} consecutive operations blocked by automatic review"
            ));
        } else if window_blocks >= WINDOW_BLOCK_LIMIT {
            self.stop = Some(format!(
                "Stopped after {WINDOW_BLOCK_LIMIT} of the last {BLOCK_WINDOW} reviewed operations were blocked"
            ));
        } else if self.consecutive_unavailable >= CONSECUTIVE_UNAVAILABLE_LIMIT {
            self.stop = Some(
                "Stopped because automatic review is unavailable; switch to Manual approval to continue"
                    .to_string(),
            );
        }
        if self.stop.is_some() {
            self.stop_signal.close();
        }
    }

    pub(crate) fn take_stop(&mut self) -> Option<String> {
        self.stop.take()
    }
}

/// A recently blocked review that the user may authorize for one retry.
#[derive(Clone, Debug)]
pub(crate) struct BlockedReview {
    pub(crate) review: PermissionReview,
    pub(crate) fingerprint: String,
}

/// Broker-local review memory. Not persisted: a restart drops blocked
/// reviews and pending retry authorizations, and a retry is always reviewed
/// again.
#[derive(Default)]
pub(crate) struct ReviewMemory {
    pub(crate) run: ReviewRunState,
    /// Recent reviews in every state, newest last, for clients to show
    /// Reviewing, allowed, blocked and unavailable states.
    recent: VecDeque<PermissionReview>,
    blocked: VecDeque<BlockedReview>,
    authorized: Vec<(BlockedReview, Instant)>,
}

/// A consumed retry authorization, held while its review runs.
pub(crate) struct RetryAuthorization((BlockedReview, Instant));

impl ReviewMemory {
    pub(crate) fn begin_run(&mut self) -> ReviewRunPermit {
        // A waiter admitted under an earlier run cannot inherit its successor
        // run's fresh budget or receive a late manual approval.
        self.run.stop_signal.close();
        let retired = self.run.stop_signal();
        self.run = ReviewRunState::default();
        retired
    }

    /// Records a review as started or updates it with its outcome.
    pub(crate) fn record(&mut self, review: &PermissionReview) {
        match self.recent.iter_mut().find(|recent| recent.id == review.id) {
            Some(recent) => *recent = review.clone(),
            None => self.recent.push_back(review.clone()),
        }
        while self.recent.len() > RECENT_REVIEW_LIMIT {
            self.recent.pop_front();
        }
    }

    /// Forgets a review whose verdict was superseded by a mode change.
    pub(crate) fn forget(&mut self, review_id: &str) {
        self.recent.retain(|recent| recent.id != review_id);
    }

    /// Recent reviews, newest first, including every review still blocked
    /// and authorizable even after newer reviews pushed it out of `recent`,
    /// so a client that counts blocked reviews can always show their rows.
    pub(crate) fn recent(&self) -> Vec<PermissionReview> {
        let mut reviews: Vec<PermissionReview> = self.recent.iter().cloned().collect();
        for blocked in &self.blocked {
            if !reviews.iter().any(|review| review.id == blocked.review.id) {
                reviews.push(blocked.review.clone());
            }
        }
        reviews.sort_by_key(|review| std::cmp::Reverse(review.created_at_epoch_ms));
        reviews
    }

    pub(crate) fn remember_blocked(&mut self, blocked: BlockedReview) {
        self.blocked.push_back(blocked);
        while self.blocked.len() > RECENT_BLOCKED_LIMIT {
            self.blocked.pop_front();
        }
    }

    pub(crate) fn blocked(&self) -> Vec<PermissionReview> {
        self.blocked
            .iter()
            .rev()
            .map(|blocked| blocked.review.clone())
            .collect()
    }

    /// Records the user's authorization for one fresh review of a blocked
    /// action and removes it from the blocked list, so it is authorized once.
    pub(crate) fn authorize_retry(&mut self, review_id: &str) -> Option<PermissionReview> {
        let index = self
            .blocked
            .iter()
            .position(|blocked| blocked.review.id == review_id)?;
        let blocked = self.blocked.remove(index)?;
        self.authorized
            .retain(|(authorized, _)| authorized.fingerprint != blocked.fingerprint);
        let review = blocked.review.clone();
        self.authorized.push((blocked, Instant::now()));
        Some(review)
    }

    /// Undoes an authorization whose retry request could not be delivered:
    /// the authorization is withdrawn and the blocked action returns to the
    /// list, so it can be authorized again.
    pub(crate) fn revoke_retry(&mut self, review_id: &str) -> bool {
        let Some(index) = self
            .authorized
            .iter()
            .position(|(authorized, _)| authorized.review.id == review_id)
        else {
            return false;
        };
        let (blocked, _) = self.authorized.remove(index);
        self.remember_blocked(blocked);
        true
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn pending_authorizations(&self) -> usize {
        self.authorized.len()
    }

    /// Consumes a live authorization for this invocation, if one exists.
    pub(crate) fn take_authorization(&mut self, fingerprint: &str) -> Option<RetryAuthorization> {
        self.authorized
            .retain(|(_, at)| at.elapsed() < AUTHORIZED_RETRY_TTL);
        let index = self
            .authorized
            .iter()
            .position(|(authorized, _)| authorized.fingerprint == fingerprint)?;
        Some(RetryAuthorization(self.authorized.remove(index)))
    }

    /// Returns an authorization whose review was discarded, keeping its
    /// original expiry.
    pub(crate) fn restore_authorization(&mut self, authorization: RetryAuthorization) {
        let RetryAuthorization(entry) = authorization;
        self.authorized
            .retain(|(authorized, _)| authorized.fingerprint != entry.0.fingerprint);
        self.authorized.push(entry);
    }
}

#[cfg(test)]
#[path = "review_tests.rs"]
mod tests;
