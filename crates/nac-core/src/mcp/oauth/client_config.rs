use super::*;

pub(super) fn oauth_application_type(redirect_uri: &str) -> &'static str {
    if redirect_uri.starts_with("https://") {
        "web"
    } else {
        "native"
    }
}

pub(super) fn restored_client_config(
    profile: &OAuthProfile,
    registration: &ResolvedRegistration,
    redirect_uri: &str,
    scopes: Vec<String>,
) -> Result<OAuthClientConfig> {
    let stored_client_id = profile
        .credentials
        .as_ref()
        .map(|credentials| credentials.client_id.as_str())
        .ok_or_else(|| anyhow!("MCP OAuth authorization has no registered client"))?;
    let client_id = match registration {
        ResolvedRegistration::ClientMetadata { url } => {
            if stored_client_id != url {
                bail!("stored MCP OAuth client does not match its metadata document");
            }
            url.clone()
        }
        _ => stored_client_id.to_string(),
    };
    let mut client = OAuthClientConfig::new(client_id, redirect_uri)
        .with_scopes(scopes)
        .with_application_type(oauth_application_type(redirect_uri));
    if let Some(secret) = restored_client_secret(profile, registration) {
        client = client.with_client_secret(secret);
    }
    Ok(client)
}

pub(super) fn restored_client_secret<'a>(
    profile: &'a OAuthProfile,
    registration: &'a ResolvedRegistration,
) -> Option<&'a str> {
    match registration {
        ResolvedRegistration::PreRegistered { client_secret, .. } => client_secret.as_deref(),
        ResolvedRegistration::Dynamic { .. } => profile.registered_client_secret.as_deref(),
        ResolvedRegistration::ClientMetadata { .. } => None,
    }
}
