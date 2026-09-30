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

    pub(crate) async fn call(&self, args: Value, image_results: bool) -> ToolResult {
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
        let service = self.server.service.read().await.clone();
        let first_result = service.read().await.call_tool(params.clone()).await;
        match first_result {
            Ok(result) => {
                flatten_tool_result(result, image_results, self.server.redactor.clone()).await
            }
            Err(error)
                if self.server.config.has_header_helper() && authorization_required(&error) =>
            {
                let _refresh = self.server.refresh.lock().await;
                let refreshed_service = {
                    let current = self.server.service.read().await.clone();
                    if Arc::ptr_eq(&current, &service) {
                        let generation = self.server.next_connection_generation();
                        let handler = self.server.handler.with_connection_generation(generation);
                        match connect_server(
                            &self.server.name,
                            &self.server.config,
                            &handler,
                            &self.server.cwd,
                            self.server.startup_timeout,
                        )
                        .await
                        {
                            Ok(refreshed) => {
                                let refreshed = Arc::new(tokio::sync::RwLock::new(refreshed));
                                self.server.activate_connection_generation(generation);
                                let replaced = {
                                    let mut current = self.server.service.write().await;
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
                let refreshed_result = refreshed_service.read().await.call_tool(params).await;
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
