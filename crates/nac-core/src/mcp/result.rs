use super::*;

pub(super) fn flatten_tool_result(result: rmcp::model::CallToolResult) -> ToolResult {
    let mut sections = Vec::new();

    for content in result.content {
        if let Some(text) = content.as_text() {
            sections.push(text.text.clone());
            continue;
        }

        if let Some(resource) = content.as_resource() {
            if let rmcp::model::ResourceContents::TextResourceContents { text, .. } =
                &resource.resource
            {
                sections.push(text.clone());
                continue;
            }
        }

        if let Some(link) = content.as_resource_link() {
            sections.push(format!("Resource: {}", link.uri));
            continue;
        }

        match serde_json::to_string_pretty(&content) {
            Ok(rendered) => sections.push(rendered),
            Err(_) => sections.push("[unsupported MCP content]".to_string()),
        }
    }

    if let Some(structured) = result.structured_content {
        match serde_json::to_string_pretty(&structured) {
            Ok(rendered) => sections.push(rendered),
            Err(_) => sections.push(structured.to_string()),
        }
    }

    if sections.is_empty() {
        sections.push("[empty MCP tool result]".to_string());
    }

    ToolResult {
        content: sections.join("\n\n"),
        is_error: result.is_error.unwrap_or(false),
    }
}
