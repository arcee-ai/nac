use super::*;

pub(super) async fn close_mcp_service(service: &mut McpService) {
    let _ = service.close_with_timeout(MCP_SERVICE_CLOSE_TIMEOUT).await;
}

pub(super) async fn close_shared_mcp_service(service: SharedMcpService) {
    {
        let service = service.read().await;
        service.cancellation_token().cancel();
    }
    let mut service = service.write().await;
    close_mcp_service(&mut service).await;
}

pub(super) async fn connect_server(
    name: &str,
    config: &McpServerConfig,
    handler: &NacMcpClientHandler,
    cwd: &Path,
    startup_timeout: Duration,
) -> Result<McpService> {
    match config.transport.clone() {
        McpTransportConfig::Stdio {
            command,
            args,
            env,
            env_vars,
            cwd: configured_cwd,
        } => {
            let command = expand_env(&command)?;
            let args = expand_strings(&args)?;
            let mut env = expand_map(&env)?;
            forward_env_vars(&mut env, &env_vars)?;
            let cwd = configured_cwd
                .as_deref()
                .map(expand_env)
                .transpose()?
                .map(PathBuf::from)
                .map(|path| {
                    if path.is_absolute() {
                        path
                    } else {
                        cwd.join(path)
                    }
                })
                .unwrap_or_else(|| cwd.to_path_buf());
            let transport =
                TokioChildProcess::new(build_stdio_command(&command, &args, &env, &cwd)?)?;
            timeout(
                startup_timeout,
                handler
                    .clone()
                    .serve_with_lifecycle(transport, config.protocol.lifecycle()),
            )
            .await
            .map_err(|_| {
                anyhow!(
                    "timed out connecting stdio MCP server '{name}' after {}ms",
                    startup_timeout.as_millis()
                )
            })?
            .with_context(|| format!("failed to connect stdio MCP server '{name}'"))
        }
        McpTransportConfig::StreamableHttp {
            url,
            headers,
            env_headers,
            bearer_token_env_var,
            header_helper,
        } => {
            let url = expand_env(&url)?;
            let helper_headers = match header_helper.as_ref() {
                Some(helper) => Some(run_header_helper(helper, cwd).await?),
                None => None,
            };
            let parameters = HttpConnectionParameters {
                url: &url,
                headers: &headers,
                env_headers: &env_headers,
                bearer_token_env_var: bearer_token_env_var.as_deref(),
                helper_headers: helper_headers.as_ref(),
            };
            match connect_http_server_with_timeout(
                name,
                config.protocol,
                handler,
                &parameters,
                startup_timeout,
            )
            .await
            {
                Ok(service) => Ok(service),
                Err(error) => {
                    let Some(helper) = header_helper
                        .as_ref()
                        .filter(|_| authorization_required(error.as_ref()))
                    else {
                        return Err(error);
                    };
                    let refreshed = run_header_helper(helper, cwd).await?;
                    let parameters = HttpConnectionParameters {
                        helper_headers: Some(&refreshed),
                        ..parameters
                    };
                    connect_http_server_with_timeout(
                        name,
                        config.protocol,
                        handler,
                        &parameters,
                        startup_timeout,
                    )
                    .await
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
struct HttpConnectionParameters<'a> {
    url: &'a str,
    headers: &'a BTreeMap<String, String>,
    env_headers: &'a BTreeMap<String, String>,
    bearer_token_env_var: Option<&'a str>,
    helper_headers: Option<&'a BTreeMap<String, String>>,
}

async fn connect_http_server_with_timeout(
    name: &str,
    protocol: McpProtocolSelection,
    handler: &NacMcpClientHandler,
    parameters: &HttpConnectionParameters<'_>,
    startup_timeout: Duration,
) -> Result<McpService> {
    timeout(
        startup_timeout,
        connect_http_server(name, protocol, handler, parameters),
    )
    .await
    .map_err(|_| {
        anyhow!(
            "timed out connecting HTTP MCP server '{name}' after {}ms",
            startup_timeout.as_millis()
        )
    })?
}

async fn connect_http_server(
    name: &str,
    protocol: McpProtocolSelection,
    handler: &NacMcpClientHandler,
    parameters: &HttpConnectionParameters<'_>,
) -> Result<McpService> {
    let transport = StreamableHttpClientTransport::from_config(build_http_transport_config(
        parameters.url,
        parameters.headers,
        parameters.env_headers,
        parameters.bearer_token_env_var,
        parameters.helper_headers,
    )?);
    handler
        .clone()
        .serve_with_lifecycle(transport, protocol.lifecycle())
        .await
        .with_context(|| format!("failed to connect HTTP MCP server '{name}'"))
}

pub(super) fn authorization_required(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(source) = current {
        if source
            .downcast_ref::<rmcp::service::ClientInitializeError>()
            .is_some_and(rmcp::service::ClientInitializeError::is_authorization_required)
            || source
                .downcast_ref::<rmcp::transport::streamable_http_client::AuthRequiredError>()
                .is_some()
            || source
                .downcast_ref::<rmcp::transport::streamable_http_client::InsufficientScopeError>()
                .is_some()
        {
            return true;
        }
        current = source.source();
    }
    false
}

fn forward_env_vars(target: &mut BTreeMap<String, String>, names: &[String]) -> Result<()> {
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            bail!("forwarded environment variable name must not be blank");
        }
        let value =
            env::var(name).with_context(|| format!("environment variable '{name}' is not set"))?;
        target.entry(name.to_string()).or_insert(value);
    }
    Ok(())
}

/// Builds the host-side command for a stdio MCP server.
///
/// Stdio servers always run on the host, even when the worker is sandboxed:
/// the sandbox image does not contain the runtimes (`npx`, `node`, `uvx`, ...)
/// stdio servers typically need, and `cwd` is already the host workspace path.
pub(super) fn build_stdio_command(
    program: &str,
    args: &[String],
    envs: &BTreeMap<String, String>,
    cwd: &Path,
) -> Result<Command> {
    let mut command = Command::new(program);
    command.current_dir(cwd);
    command.args(args);
    command.envs(envs);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::inherit());
    // The transport owns this child after `serve` begins. If initialization is
    // cancelled or times out before a RunningService exists, dropping that
    // in-flight transport must still terminate the process.
    command.kill_on_drop(true);
    Ok(command)
}

fn build_http_transport_config(
    url: &str,
    headers: &BTreeMap<String, String>,
    env_headers: &BTreeMap<String, String>,
    bearer_token_env_var: Option<&str>,
    helper_headers: Option<&BTreeMap<String, String>>,
) -> Result<StreamableHttpClientTransportConfig> {
    let mut custom_headers = HashMap::new();
    let mut resolved = expand_map(headers)?;
    for (name, variable) in env_headers {
        let value = env::var(variable).with_context(|| {
            format!("environment variable '{variable}' for HTTP header '{name}' is not set")
        })?;
        resolved.insert(name.clone(), value);
    }
    if let Some(helper_headers) = helper_headers {
        resolved.extend(helper_headers.clone());
    }
    for (name, value) in resolved {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("invalid HTTP header name '{name}'"))?;
        let value = HeaderValue::from_str(&value)
            .with_context(|| format!("invalid HTTP header value for '{name}'"))?;
        custom_headers.insert(name, value);
    }
    let mut config =
        StreamableHttpClientTransportConfig::with_uri(url).custom_headers(custom_headers);
    if let Some(variable) = bearer_token_env_var {
        let token = env::var(variable).with_context(|| {
            format!("bearer token environment variable '{variable}' is not set")
        })?;
        config = config.auth_header(token);
    }
    Ok(config)
}

const HEADER_HELPER_DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);
const HEADER_HELPER_MAX_OUTPUT: usize = 64 * 1024;

pub(super) async fn run_header_helper(
    helper: &McpHeaderHelperConfig,
    workspace_cwd: &Path,
) -> Result<BTreeMap<String, String>> {
    let command = expand_env(&helper.command)?;
    if command.trim().is_empty() {
        bail!("header helper command must not be blank");
    }
    let args = expand_strings(&helper.args)?;
    let mut envs = expand_map(&helper.env)?;
    forward_env_vars(&mut envs, &helper.env_vars)?;
    let cwd = helper
        .cwd
        .as_deref()
        .map(expand_env)
        .transpose()?
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                workspace_cwd.join(path)
            }
        })
        .unwrap_or_else(|| workspace_cwd.to_path_buf());
    let timeout_duration = timeout_value(
        helper.timeout_ms,
        HEADER_HELPER_DEFAULT_TIMEOUT,
        "header_helper.timeout_ms",
    )?;

    let mut process = Command::new(command);
    process
        .current_dir(cwd)
        .args(args)
        .envs(envs)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let mut child = process
        .spawn()
        .context("failed to start HTTP header helper")?;
    let stdout = child
        .stdout
        .take()
        .context("HTTP header helper stdout was unavailable")?;
    let read = async move {
        let mut output = Vec::new();
        stdout
            .take((HEADER_HELPER_MAX_OUTPUT + 1) as u64)
            .read_to_end(&mut output)
            .await
            .context("failed to read HTTP header helper output")?;
        Ok::<_, anyhow::Error>(output)
    };
    tokio::pin!(read);
    let run = async {
        tokio::select! {
            status = child.wait() => {
                let status = status.context("failed to wait for HTTP header helper")?;
                let output = read.await?;
                Ok::<_, anyhow::Error>((status, output))
            }
            output = &mut read => {
                let output = output?;
                if output.len() > HEADER_HELPER_MAX_OUTPUT {
                    let _ = child.kill().await;
                    bail!("HTTP header helper output exceeded {HEADER_HELPER_MAX_OUTPUT} bytes");
                }
                let status = child.wait().await.context("failed to wait for HTTP header helper")?;
                Ok((status, output))
            }
        }
    };
    let (status, output) = timeout(timeout_duration, run)
        .await
        .map_err(|_| anyhow!("HTTP header helper timed out"))??;
    if !status.success() {
        bail!("HTTP header helper exited unsuccessfully");
    }
    if output.len() > HEADER_HELPER_MAX_OUTPUT {
        bail!("HTTP header helper output exceeded {HEADER_HELPER_MAX_OUTPUT} bytes");
    }
    let headers: BTreeMap<String, String> = serde_json::from_slice(&output)
        .context("HTTP header helper must print one JSON object of string header values")?;
    for (name, value) in &headers {
        HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("HTTP header helper returned invalid header name '{name}'"))?;
        HeaderValue::from_str(value)
            .with_context(|| format!("HTTP header helper returned invalid value for '{name}'"))?;
    }
    Ok(headers)
}
