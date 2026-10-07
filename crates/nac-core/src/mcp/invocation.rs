use super::*;

#[derive(Clone)]
pub(crate) struct McpToolCapture {
    pub(super) binding: Arc<McpToolBinding>,
    pub(super) server: Arc<McpServer>,
}

impl McpToolCapture {
    pub(crate) fn definition(&self) -> ToolDefinition {
        self.binding.definition.clone()
    }

    pub(crate) fn execution_timeout(&self) -> Duration {
        self.binding.execution_timeout
    }

    pub(crate) fn approval(&self) -> McpToolApproval {
        self.binding.approval
    }

    pub(crate) async fn call(&self, args: Value, image_results: bool) -> ToolResult {
        match self
            .server
            .during_runtime_effect(async { Ok(self.call_inner(args, image_results).await) })
            .await
        {
            Ok(result) => result,
            Err(error) => self.runtime_error(error),
        }
    }

    fn runtime_error(&self, error: anyhow::Error) -> ToolResult {
        ToolResult::text(
            self.server.redactor.redact(&format!("Error: {error:#}")),
            true,
        )
    }

    async fn call_inner(&self, args: Value, image_results: bool) -> ToolResult {
        let name = &self.binding.definition.function.name;
        let arguments = match args {
            Value::Object(map) => Some(map),
            Value::Null => None,
            _ => {
                return ToolResult {
                    content: format!("Error: MCP tool '{name}' requires object arguments").into(),
                    is_error: true,
                }
            }
        };
        let mut params = CallToolRequestParams::new(self.binding.tool_name.clone());
        if let Some(arguments) = arguments {
            params = params.with_arguments(arguments);
        }
        let peer = match self.server.request_service().await {
            Ok(peer) => peer,
            Err(error) => return self.runtime_error(error),
        };
        let service = Arc::clone(tokio::sync::OwnedRwLockReadGuard::rwlock(&peer));
        let first_result = peer.call_tool(params.clone()).await;
        drop(peer);
        match first_result {
            Ok(result) => {
                flatten_tool_result(result, image_results, self.server.redactor.clone()).await
            }
            Err(error)
                if self.server.config.has_header_helper() && authorization_required(&error) =>
            {
                let _refresh = self.server.refresh.lock().await;
                if let Err(error) = self.server.check_runtime_effect().await {
                    return self.runtime_error(error);
                }
                let refreshed_service = {
                    let current = self.server.service.read().await.clone();
                    if Arc::ptr_eq(&current, &service) {
                        let generation = self.server.next_connection_generation();
                        let handler = self.server.handler.with_connection_generation(generation);
                        match self
                            .server
                            .during_runtime_effect(connect_server(
                                &self.server.name,
                                &self.server.config,
                                &handler,
                                &self.server.cwd,
                                self.server.startup_timeout,
                            ))
                            .await
                        {
                            Ok(refreshed) => {
                                let refreshed = Arc::new(tokio::sync::RwLock::new(refreshed));
                                let cancellation = refreshed.read().await.cancellation_token();
                                let replaced = {
                                    let mut current = self.server.service.write().await;
                                    if let Err(error) = self.server.check_runtime_effect().await {
                                        drop(current);
                                        close_shared_mcp_service(refreshed).await;
                                        return self.runtime_error(error);
                                    }
                                    if let Err(error) =
                                        self.server.retain_runtime_cancellation(cancellation)
                                    {
                                        drop(current);
                                        close_shared_mcp_service(refreshed).await;
                                        return self.runtime_error(error);
                                    }
                                    self.server.activate_connection_generation(generation);
                                    std::mem::replace(&mut *current, Arc::clone(&refreshed))
                                };
                                close_shared_mcp_service(replaced).await;
                                self.server.start_notification_processing().await;
                                refreshed
                            }
                            Err(refresh_error) => {
                                return ToolResult {
                                    content: self.server.redactor.redact(&format!(
                                        "Error calling MCP tool '{name}': authentication refresh failed: {refresh_error:#}"
                                    ))
                                    .into(),
                                    is_error: true,
                                };
                            }
                        }
                    } else {
                        current
                    }
                };
                // Retain the refreshed connection ownership until this branch
                // settles; acquire the currently selected peer with the same
                // original check after any connection-lock wait.
                let _refreshed_service = refreshed_service;
                let peer = match self.server.request_service().await {
                    Ok(peer) => peer,
                    Err(error) => return self.runtime_error(error),
                };
                let refreshed_result = peer.call_tool(params).await;
                match refreshed_result {
                    Ok(result) => {
                        flatten_tool_result(result, image_results, self.server.redactor.clone())
                            .await
                    }
                    Err(error) => ToolResult {
                        content: self
                            .server
                            .redactor
                            .redact(&format!(
                            "Error calling MCP tool '{name}' after authentication refresh: {error}"
                        ))
                            .into(),
                        is_error: true,
                    },
                }
            }
            Err(error) => ToolResult {
                content: self
                    .server
                    .redactor
                    .redact(&format!("Error calling MCP tool '{name}': {error}"))
                    .into(),
                is_error: true,
            },
        }
    }
}
