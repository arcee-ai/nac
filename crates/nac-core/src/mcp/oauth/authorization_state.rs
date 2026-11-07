use super::*;

pub(super) fn authorization_state(url: &str) -> Option<String> {
    let url = Url::parse(url).ok()?;
    let mut states = url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    let state = states.next()?;
    states.next().is_none().then_some(state)
}

pub(super) fn publish_pending_authorization(profile: &mut OAuthProfile, url: String) -> Result<()> {
    let state =
        authorization_state(&url).ok_or_else(|| anyhow!("authorization URL has invalid state"))?;
    if !profile.states.contains_key(&state) {
        bail!("authorization URL state was not persisted");
    }
    profile.states.retain(|value, _| value == &state);
    profile.completing_authorization = None;
    profile.pending_authorization_url = Some(url);
    Ok(())
}

/// Refuses work an authorization started before the latest logout.
pub(super) fn ensure_not_logged_out(profile: &OAuthProfile, logout_generation: u64) -> Result<()> {
    if profile.logout_generation != logout_generation {
        bail!("MCP OAuth was logged out while this authorization was in progress");
    }
    Ok(())
}

pub(super) fn merge_pending_scopes(current: &mut Vec<String>, requested: &[String]) {
    for scope in requested {
        if !current.contains(scope) {
            current.push(scope.clone());
        }
    }
}

pub(super) fn pending_authorization_is_live(profile: &OAuthProfile) -> bool {
    let Some(url) = profile.pending_authorization_url.as_deref() else {
        return false;
    };
    let Some(state) = authorization_state(url) else {
        return false;
    };
    profile
        .states
        .get(&state)
        .is_some_and(authorization_state_is_live)
}

pub fn discard_mcp_oauth_pending_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    authorization_url: &str,
) -> Result<bool> {
    let state = authorization_state(authorization_url)
        .ok_or_else(|| anyhow!("authorization URL has invalid state"))?;
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        if profile
            .pending_authorization_url
            .as_deref()
            .and_then(authorization_state)
            .as_deref()
            != Some(&state)
        {
            return Ok(false);
        }
        profile.pending_authorization_url = None;
        profile.completing_authorization = None;
        profile.states.remove(&state);
        Ok(true)
    })
}

pub(super) fn failed_authorization_start(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    authorization_url: &str,
    error: anyhow::Error,
) -> anyhow::Error {
    match discard_mcp_oauth_pending_authorization(cwd, server_name, endpoint, authorization_url) {
        Ok(_) => error,
        Err(cleanup_error) => error.context(format!(
            "unpublished MCP OAuth authorization cleanup also failed: {cleanup_error:#}"
        )),
    }
}

fn authorization_state_is_live(state: &StoredAuthorizationState) -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.saturating_sub(state.created_at) <= MCP_OAUTH_STATE_TTL.as_secs()
}

#[cfg(test)]
mod tests {
    use super::merge_pending_scopes;

    #[test]
    fn publishing_authorization_preserves_scopes_added_after_begin() {
        let mut current = vec!["scope-added-concurrently".to_string()];
        merge_pending_scopes(&mut current, &["scope-snapshotted-at-begin".to_string()]);
        assert_eq!(
            current,
            ["scope-added-concurrently", "scope-snapshotted-at-begin"]
        );
    }
}

/// Tests completion ownership, not whether a URL may be offered or replayed.
/// The one-use state is consumed before token exchange, while this binding
/// remains until completion, cancellation, logout or replacement.
pub fn mcp_oauth_authorization_is_current(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    authorization_url: &str,
) -> Result<bool> {
    let store = read_store(&oauth_store_path(cwd)?)?;
    let Some(profile) = store.profiles.get(server_name) else {
        return Ok(false);
    };
    validate_profile_binding(profile, endpoint)?;
    Ok(profile.pending_authorization_url.as_deref() == Some(authorization_url))
}

// Each manager shares this fence between its state and credential adapters.
// Consuming a state does not retire the flow; clearing/replacing its binding does.
#[derive(Clone, Default)]
pub(super) struct CompletionOwnership(std::sync::Arc<std::sync::Mutex<Option<String>>>);

impl CompletionOwnership {
    pub(super) fn current(&self) -> Result<Option<String>> {
        self.0
            .lock()
            .map(|value| value.clone())
            .map_err(|_| anyhow!("MCP OAuth completion ownership lock was poisoned"))
    }

    pub(super) fn capture(&self, state: &str) -> Result<()> {
        *self
            .0
            .lock()
            .map_err(|_| anyhow!("MCP OAuth completion ownership lock was poisoned"))? =
            Some(state.into());
        Ok(())
    }

    pub(super) fn claim(&self, profile: &mut OAuthProfile, state: &str) -> Result<()> {
        let stored = profile
            .states
            .get(state)
            .filter(|stored| authorization_state_is_live(stored))
            .filter(|_| {
                profile
                    .pending_authorization_url
                    .as_deref()
                    .and_then(authorization_state)
                    .as_deref()
                    == Some(state)
            })
            .ok_or_else(|| {
                anyhow!("MCP OAuth authorization state was consumed, expired or replaced")
            })?;
        let completion = CompletingAuthorization {
            state: state.into(),
            created_at: stored.created_at,
        };
        self.capture(state)?;
        profile.states.remove(state);
        profile.completing_authorization = Some(completion);
        Ok(())
    }

    pub(super) fn validate(profile: &OAuthProfile, expected: Option<&str>) -> Result<()> {
        if expected.is_some_and(|state| {
            !completion_is_live(profile)
                || profile
                    .completing_authorization
                    .as_ref()
                    .is_none_or(|value| value.state != state)
        }) {
            bail!("MCP OAuth authorization was retired while completing");
        }
        Ok(())
    }

    pub(super) fn settled(&self, expected: Option<String>) -> Result<()> {
        let mut current = self
            .0
            .lock()
            .map_err(|_| anyhow!("MCP OAuth completion ownership lock was poisoned"))?;
        if *current == expected {
            *current = None;
        }
        Ok(())
    }
}

// This private optional v2 field retains only completion identity and the
// original state age. The PKCE verifier remains deleted and cannot be replayed.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct CompletingAuthorization {
    state: String,
    created_at: u64,
}

pub(super) fn completion_is_live(profile: &OAuthProfile) -> bool {
    profile
        .completing_authorization
        .as_ref()
        .is_some_and(|completion| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            now.saturating_sub(completion.created_at) <= MCP_OAUTH_STATE_TTL.as_secs()
                && profile
                    .pending_authorization_url
                    .as_deref()
                    .and_then(authorization_state)
                    .as_deref()
                    == Some(completion.state.as_str())
        })
}

pub fn mcp_oauth_completion_is_pending(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<bool> {
    let store = read_store(&oauth_store_path(cwd)?)?;
    let Some(profile) = store.profiles.get(server_name) else {
        return Ok(false);
    };
    validate_profile_binding(profile, endpoint)?;
    Ok(completion_is_live(profile))
}

pub fn fail_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    expected_authorization_url: Option<&str>,
) -> Result<bool> {
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        if expected_authorization_url
            .is_some_and(|expected| profile.pending_authorization_url.as_deref() != Some(expected))
        {
            return Ok(false);
        }
        profile.pending_authorization_url = None;
        profile.completing_authorization = None;
        profile.pending_scopes.clear();
        profile.states.clear();
        Ok(true)
    })
}

#[derive(Debug)]
struct ClaimedCallbackFailure;
impl std::fmt::Display for ClaimedCallbackFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("MCP OAuth callback failed after claiming its state")
    }
}
impl std::error::Error for ClaimedCallbackFailure {}

pub(super) fn callback_failure(
    error: AuthError,
    completion: &CompletionOwnership,
    state: &str,
) -> anyhow::Error {
    let error = anyhow!(error).context("MCP OAuth callback was rejected");
    if completion
        .current()
        .is_ok_and(|owned| owned.as_deref() == Some(state))
    {
        error.context(ClaimedCallbackFailure)
    } else {
        error
    }
}

/// Only the callback that consumed state may retire its failed completion.
pub fn mcp_oauth_callback_failure_was_owned(error: &anyhow::Error) -> bool {
    error.downcast_ref::<ClaimedCallbackFailure>().is_some()
}
