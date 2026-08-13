use super::*;

pub(super) async fn connect_server(
    name: &str,
    config: &McpServerConfig,
    handler: &NacMcpClientHandler,
    cwd: &Path,
    sandbox: Option<&SandboxSession>,
) -> Result<McpService> {
    match config.transport.clone() {
        McpTransportConfig::Stdio { command, args, env } => {
            let command = expand_env(&command)?;
            let args = expand_strings(&args)?;
            let env = expand_map(&env)?;
            let transport =
                TokioChildProcess::new(build_stdio_command(&command, &args, &env, cwd, sandbox)?)?;
            handler
                .clone()
                .serve(transport)
                .await
                .with_context(|| format!("failed to connect stdio MCP server '{}'", name))
        }
        McpTransportConfig::StreamableHttp { url, headers } => {
            let url = expand_env(&url)?;
            let transport = StreamableHttpClientTransport::from_config(
                build_http_transport_config(&url, &headers)?,
            );
            handler
                .clone()
                .serve(transport)
                .await
                .with_context(|| format!("failed to connect HTTP MCP server '{}'", name))
        }
    }
}

fn build_stdio_command(
    program: &str,
    args: &[String],
    envs: &BTreeMap<String, String>,
    cwd: &Path,
    sandbox: Option<&SandboxSession>,
) -> Result<Command> {
    let env_pairs: Vec<(String, String)> = envs
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    if let Some(sandbox) = sandbox {
        let mut command = sandbox.child_process_command(program, args, &env_pairs);
        command.current_dir(cwd);
        return Ok(command);
    }

    let mut command = Command::new(program);
    command.current_dir(cwd);
    command.args(args);
    command.envs(envs);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::inherit());
    Ok(command)
}

fn build_http_transport_config(
    url: &str,
    headers: &BTreeMap<String, String>,
) -> Result<StreamableHttpClientTransportConfig> {
    let mut custom_headers = HashMap::new();
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("invalid HTTP header name '{}'", name))?;
        let value = HeaderValue::from_str(&expand_env(value)?)
            .with_context(|| format!("invalid HTTP header value for '{}'", name))?;
        custom_headers.insert(name, value);
    }
    Ok(StreamableHttpClientTransportConfig::with_uri(url).custom_headers(custom_headers))
}
