use super::*;

pub(super) async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    let mut join_set: JoinSet<(usize, String, String, ToolResult)> = JoinSet::new();

    for (index, tool_call) in tool_calls.into_iter().enumerate() {
        let id = tool_call.id;
        let name = tool_call.function.name;
        let args_str = tool_call.function.arguments;
        let runtime = runtime.clone();
        let client = client.clone();
        event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: thread_name.clone(),
            call_id: id.clone(),
            name: name.clone(),
            args_preview: preview_tool_args(&name, &args_str),
            args_detail: Some(tool_args_detail(&args_str)),
        });

        join_set.spawn(async move {
            let args = match serde_json::from_str::<serde_json::Value>(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        index,
                        id,
                        name.clone(),
                        ToolResult {
                            content: format!(
                                "Error: failed to parse tool arguments for '{}': {}",
                                name, error
                            ),
                            is_error: true,
                        },
                    );
                }
            };

            let result = tools::execute_tool(&name, args, &runtime, &client).await;
            (index, id, name, result)
        });
    }

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((index, tool_call_id, tool_name, result)) => {
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    content_preview: preview_tool_result(&tool_name, &result),
                    is_error: result.is_error,
                });
                results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => results.push((
                usize::MAX,
                "unknown".to_string(),
                "unknown".to_string(),
                ToolResult {
                    content: format!("Tool task panicked: {}", error),
                    is_error: true,
                },
            )),
        }
    }

    results.sort_by_key(|(index, ..)| *index);
    results
        .into_iter()
        .map(|(_, tool_call_id, tool_name, result)| (tool_call_id, tool_name, result))
        .collect()
}
