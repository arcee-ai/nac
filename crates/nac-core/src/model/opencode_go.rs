use super::*;

pub fn validate_base_url(base_url: &str) -> Result<Url> {
    let parsed = Url::parse(base_url).map_err(|error| {
        anyhow!("invalid OpenCode Go base URL '{base_url}': not a valid absolute URL: {error}")
    })?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("invalid OpenCode Go base URL '{base_url}': must include a host"))?;
    if host != "opencode.ai" {
        return Ok(parsed);
    }
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "invalid OpenCode Go base URL '{base_url}': the official origin requires HTTPS"
        ));
    }
    if parsed.port_or_known_default() != Some(443) {
        return Err(anyhow!(
            "invalid OpenCode Go base URL '{base_url}': the official origin requires effective port 443"
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!(
            "invalid OpenCode Go base URL '{base_url}': userinfo is not allowed"
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(anyhow!(
            "invalid OpenCode Go base URL '{base_url}': query parameters and fragments are not allowed"
        ));
    }
    if !matches!(parsed.path(), "/zen/go/v1" | "/zen/go/v1/") {
        return Err(anyhow!(
            "invalid OpenCode Go base URL '{base_url}': the official origin requires path '/zen/go/v1'"
        ));
    }
    Ok(parsed)
}

pub fn messages_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}/v1/messages")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_go_urls_are_the_canonical_v1_origin() {
        for url in [
            OPENCODE_GO_CANONICAL_BASE_URL,
            "https://opencode.ai/zen/go/v1/",
        ] {
            validate_base_url(url).unwrap_or_else(|error| panic!("{url}: {error}"));
        }
    }

    #[test]
    fn unofficial_hosts_are_left_to_the_caller_host_policy() {
        for url in [
            "https://proxy.example/v1",
            "http://localhost:8080/v1",
            "https://127.0.0.1/zen/go/v1",
        ] {
            validate_base_url(url).unwrap_or_else(|error| panic!("{url}: {error}"));
        }
    }

    #[test]
    fn official_zen_and_other_go_paths_are_rejected() {
        for url in [
            "http://opencode.ai/zen/go/v1",
            "https://opencode.ai/zen/v1",
            "https://opencode.ai/zen/go",
            "https://opencode.ai/zen/go/v1/messages",
            "https://opencode.ai/zen/go/v1/chat/completions",
            "https://user@opencode.ai/zen/go/v1",
            "https://opencode.ai/zen/go/v1?x=1",
        ] {
            let error = validate_base_url(url).unwrap_err().to_string();
            assert!(
                error.contains("invalid OpenCode Go base URL"),
                "{url}: {error}"
            );
        }
    }

    #[test]
    fn anthropic_join_does_not_double_v1() {
        assert_eq!(
            messages_url(OPENCODE_GO_CANONICAL_BASE_URL),
            "https://opencode.ai/zen/go/v1/messages"
        );
        assert_eq!(
            messages_url("https://opencode.ai/zen/go/v1/"),
            "https://opencode.ai/zen/go/v1/messages"
        );
        assert_eq!(
            messages_url("https://proxy.example"),
            "https://proxy.example/v1/messages"
        );
    }
}
