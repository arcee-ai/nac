use super::*;

/// Configures `server_name` with a pre-registered client and a stored access token.
pub(crate) fn seed_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    client_id_credential: &str,
    access_token: &str,
) -> Result<()> {
    configure_mcp_oauth(
        cwd,
        server_name,
        endpoint,
        McpOAuthConfiguration {
            registration: McpOAuthRegistration::PreRegistered {
                client_id_credential: client_id_credential.to_string(),
                client_secret_credential: None,
            },
            scopes: vec!["mcp:read".to_string()],
            authorization_metadata: Some(McpOAuthAuthorizationMetadata {
                authorization_endpoint: "https://auth.example.test/authorize".into(),
                token_endpoint: "https://auth.example.test/token".into(),
                registration_endpoint: None,
                issuer: None,
                jwks_uri: None,
                scopes_supported: None,
                response_types_supported: None,
                code_challenge_methods_supported: None,
                additional_fields: BTreeMap::new(),
            }),
        },
    )?;
    let client_id = std::env::var(client_id_credential)?;
    edit_store(&oauth_store_path(cwd)?, |store| {
        store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?
            .credentials = Some(serde_json::from_value(serde_json::json!({
            "client_id": client_id,
            "token_response": {"access_token": access_token, "token_type": "bearer"},
            "granted_scopes": ["mcp:read"],
            "token_received_at": 1,
            "issuer": null
        }))?);
        Ok(())
    })
}
