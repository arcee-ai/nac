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
    profile.pending_authorization_url = Some(url);
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

pub(crate) fn discard_mcp_oauth_pending_authorization(
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
