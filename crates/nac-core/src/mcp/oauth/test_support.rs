use super::*;

/// Configures a pre-registered client with an epoch-issued access token and no refresh token.
pub(crate) fn seed_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    client_id_credential: &str,
    access_token: &str,
    expires_in: Option<u64>,
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
            "token_response": {"access_token": access_token, "token_type": "bearer", "expires_in": expires_in},
            "granted_scopes": ["mcp:read"],
            "token_received_at": 1,
            "issuer": null
        }))?);
        Ok(())
    })
}

/// The stored logout generation, for building credential stores the way `manager_and_profile` does.
pub(crate) fn logout_generation(path: &Path, server_name: &str) -> u64 {
    read_store(path).unwrap().profiles[server_name].logout_generation
}
