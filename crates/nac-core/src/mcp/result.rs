use crate::tool_content::{ToolImage, MAX_IMAGES_PER_RESULT, MAX_RESULT_IMAGE_BYTES};
use crate::types::{ToolContent, ToolContentPart};
use serde::Serialize;

use super::*;

const MAX_MCP_CONTENT_BLOCKS: usize = 100;
const MAX_MCP_NON_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub(super) const MAX_MCP_METADATA_BYTES: usize = 64 * 1024;

#[derive(Clone, Default)]
pub(super) struct McpRedactor {
    exact_values: Arc<Vec<String>>,
}

impl McpRedactor {
    pub(super) fn new(mut exact_values: Vec<String>) -> Self {
        exact_values.retain(|value| !value.is_empty());
        exact_values.sort_by_key(|value| std::cmp::Reverse(value.len()));
        exact_values.dedup();
        Self {
            exact_values: Arc::new(exact_values),
        }
    }

    pub(super) fn redact(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        for value in self.exact_values.iter() {
            redacted = redacted.replace(value, "[REDACTED]");
        }
        crate::model::redact_credentials(&redacted, &[])
    }

    pub(super) fn safe_text(&self, text: &str) -> String {
        let text = self.redact(text);
        if text.len() > MAX_MCP_METADATA_BYTES {
            "[metadata_limit_exceeded]".to_string()
        } else {
            text
        }
    }

    pub(super) fn safe_value<T: Serialize + ?Sized>(&self, value: Option<&T>) -> Option<Value> {
        self.safe_value_with_context(value, false)
    }

    pub(super) fn safe_metadata_value<T: Serialize + ?Sized>(
        &self,
        value: Option<&T>,
    ) -> Option<Value> {
        self.safe_value_with_context(value, true)
    }

    fn safe_value_with_context<T: Serialize + ?Sized>(
        &self,
        value: Option<&T>,
        metadata: bool,
    ) -> Option<Value> {
        let value = value?;
        let mut value = serde_json::to_value(value).ok()?;
        let encoded = serde_json::to_vec(&value).ok()?;
        if encoded.len() > MAX_MCP_METADATA_BYTES {
            return Some(serde_json::json!({
                "_nac": "metadata_limit_exceeded"
            }));
        }
        self.redact_value(&mut value, metadata);
        Some(value)
    }

    fn redact_value(&self, value: &mut Value, metadata: bool) {
        match value {
            Value::String(text) => *text = self.redact(text),
            Value::Array(values) => {
                for value in values {
                    self.redact_value(value, metadata);
                }
            }
            Value::Object(values) => {
                for (key, value) in values {
                    if metadata && is_sensitive_metadata_key(key) {
                        *value = Value::String("[REDACTED]".to_string());
                    } else {
                        self.redact_value(value, metadata || key == "_meta");
                    }
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }
}

fn is_sensitive_metadata_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "authorization"
            | "proxy-authorization"
            | "x-api-key"
            | "api-key"
            | "api_key"
            | "apikey"
            | "access_token"
            | "refresh_token"
            | "token"
            | "secret"
            | "password"
            | "cookie"
            | "set-cookie"
    )
}

pub(super) async fn flatten_tool_result(
    result: rmcp::model::CallToolResult,
    image_results: bool,
    redactor: McpRedactor,
) -> ToolResult {
    match tokio::task::spawn_blocking(move || {
        flatten_tool_result_blocking(result, image_results, &redactor)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => ToolResult::text(
            format!("Error: MCP result conversion task failed: {error}"),
            true,
        ),
    }
}

fn flatten_tool_result_blocking(
    result: rmcp::model::CallToolResult,
    image_results: bool,
    redactor: &McpRedactor,
) -> ToolResult {
    if result.content.len() > MAX_MCP_CONTENT_BLOCKS {
        return ToolResult::text(
            "Error: content_limit_exceeded: MCP result contains too many content blocks",
            true,
        );
    }
    let mut parts = Vec::new();
    let mut text_sections = Vec::new();
    let mut image_count = 0usize;
    let mut encoded_image_bytes = 0usize;
    let mut non_image_bytes = 0usize;

    for content in result.content {
        if let Some(text) = content.as_text() {
            if text.meta.is_none() && text.annotations.is_none() {
                if let Err(error) = push_text(
                    &mut text_sections,
                    &mut non_image_bytes,
                    redactor.redact(&text.text),
                ) {
                    return error;
                }
            } else if let Err(error) = push_protocol_value(
                &mut text_sections,
                &mut non_image_bytes,
                "content",
                &content,
                redactor,
            ) {
                return error;
            }
            continue;
        }

        if let Some(image) = content.as_image() {
            if !image_results {
                return ToolResult::text(
                    "Error: unsupported_image: the selected model cannot view MCP image results",
                    true,
                );
            }
            image_count = image_count.saturating_add(1);
            encoded_image_bytes = encoded_image_bytes.saturating_add(image.data.len());
            let max_encoded_bytes =
                MAX_RESULT_IMAGE_BYTES.div_ceil(3) * 4 + 4 * MAX_IMAGES_PER_RESULT;
            if image_count > MAX_IMAGES_PER_RESULT || encoded_image_bytes > max_encoded_bytes {
                return ToolResult::text(
                    "Error: image_limit_exceeded: MCP image result exceeds the image limit",
                    true,
                );
            }
            if image.meta.is_some() || image.annotations.is_some() {
                let metadata = serde_json::json!({
                    "type": "image_metadata",
                    "mimeType": image.mime_type,
                    "_meta": image.meta,
                    "annotations": image.annotations,
                });
                if let Err(error) = push_protocol_value(
                    &mut text_sections,
                    &mut non_image_bytes,
                    "content",
                    &metadata,
                    redactor,
                ) {
                    return error;
                }
            }
            flush_text(&mut parts, &mut text_sections);
            let image = match ToolImage::from_base64(&image.data, &image.mime_type) {
                Ok(image) => image,
                Err(error) => {
                    return ToolResult::text(
                        format!("Error: invalid MCP image content: {error}"),
                        true,
                    )
                }
            };
            parts.push(ToolContentPart::Image(image));
            continue;
        }

        if let Err(error) = push_protocol_value(
            &mut text_sections,
            &mut non_image_bytes,
            "content",
            &content,
            redactor,
        ) {
            return error;
        }
    }

    if let Some(structured) = result.structured_content {
        if let Err(error) = push_protocol_value(
            &mut text_sections,
            &mut non_image_bytes,
            "structuredContent",
            &structured,
            redactor,
        ) {
            return error;
        }
    }
    if let Some(meta) = result.meta {
        if let Err(error) = push_protocol_value(
            &mut text_sections,
            &mut non_image_bytes,
            "_meta",
            &meta,
            redactor,
        ) {
            return error;
        }
    }

    if parts.is_empty() {
        if text_sections.is_empty() {
            text_sections.push("[empty MCP tool result]".to_string());
        }
        return ToolResult::text(text_sections.join("\n\n"), result.is_error.unwrap_or(false));
    }

    flush_text(&mut parts, &mut text_sections);
    match ToolContent::from_parts(parts) {
        Ok(content) => ToolResult {
            content,
            is_error: result.is_error.unwrap_or(false),
        },
        Err(error) => ToolResult::text(format!("Error: invalid MCP tool result: {error}"), true),
    }
}

fn push_text(
    sections: &mut Vec<String>,
    total: &mut usize,
    text: String,
) -> Result<(), ToolResult> {
    *total = total.saturating_add(text.len());
    if *total > MAX_MCP_NON_IMAGE_BYTES {
        return Err(ToolResult::text(
            "Error: content_limit_exceeded: MCP non-image result exceeds the byte limit",
            true,
        ));
    }
    sections.push(text);
    Ok(())
}

fn push_protocol_value<T: Serialize + ?Sized>(
    sections: &mut Vec<String>,
    total: &mut usize,
    field: &str,
    value: &T,
    redactor: &McpRedactor,
) -> Result<(), ToolResult> {
    let mut value = serde_json::to_value(value).map_err(|_| {
        ToolResult::text(
            "Error: unsupported_content: MCP content could not be represented safely",
            true,
        )
    })?;
    redactor.redact_value(&mut value, field == "_meta");
    let rendered = serde_json::to_string(&serde_json::json!({ field: value })).map_err(|_| {
        ToolResult::text(
            "Error: unsupported_content: MCP content could not be represented safely",
            true,
        )
    })?;
    push_text(sections, total, rendered)
}

fn flush_text(parts: &mut Vec<ToolContentPart>, sections: &mut Vec<String>) {
    if !sections.is_empty() {
        parts.push(ToolContentPart::Text(sections.join("\n\n")));
        sections.clear();
    }
}

#[cfg(test)]
mod tests {
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use rmcp::model::{CallToolResult, ContentBlock as Content};
    use std::io::Cursor;

    use super::*;

    #[tokio::test]
    async fn mcp_text_and_image_blocks_remain_ordered_and_typed() {
        let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut bytes = Cursor::new(Vec::new());
        source.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let result = CallToolResult::success(vec![
            Content::text("before"),
            Content::image(BASE64.encode(bytes.into_inner()), "image/png"),
            Content::text("after"),
        ]);

        let flattened = flatten_tool_result(result, true, McpRedactor::default()).await;
        assert!(!flattened.is_error);
        let parts = flattened.content.parts().expect("mixed typed result");
        assert_eq!(parts.len(), 3);
        assert!(matches!(&parts[0], ToolContentPart::Text(text) if text == "before"));
        assert!(
            matches!(&parts[1], ToolContentPart::Image(image) if image.mime_type().as_str() == "image/png")
        );
        assert!(matches!(&parts[2], ToolContentPart::Text(text) if text == "after"));
    }

    #[tokio::test]
    async fn malformed_mcp_image_is_a_tool_error() {
        let result = CallToolResult::success(vec![Content::image("not base64", "image/png")]);
        let flattened = flatten_tool_result(result, true, McpRedactor::default()).await;
        assert!(flattened.is_error);
        assert!(flattened.content.contains("invalid_image"));
    }

    #[tokio::test]
    async fn excessive_mcp_image_count_is_rejected() {
        let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(1, 1, Rgba([1, 2, 3, 255])));
        let mut bytes = Cursor::new(Vec::new());
        source.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let encoded = BASE64.encode(bytes.into_inner());
        let result = CallToolResult::success(
            (0..=MAX_IMAGES_PER_RESULT)
                .map(|_| Content::image(encoded.clone(), "image/png"))
                .collect(),
        );

        let flattened = flatten_tool_result(result, true, McpRedactor::default()).await;
        assert!(flattened.is_error);
        assert!(flattened.content.contains("image_limit_exceeded"));
    }

    #[tokio::test]
    async fn mcp_image_is_rejected_when_selected_model_lacks_vision() {
        let result = CallToolResult::success(vec![Content::image("not decoded", "image/png")]);
        let flattened = flatten_tool_result(result, false, McpRedactor::default()).await;

        assert!(flattened.is_error);
        assert!(flattened.content.contains("unsupported_image"));
        assert!(!flattened.content.contains_images());
    }

    #[tokio::test]
    async fn legacy_result_without_discriminator_remains_accepted() {
        let result: CallToolResult = serde_json::from_value(serde_json::json!({
            "content": [{"type": "text", "text": "legacy response"}],
            "isError": false
        }))
        .unwrap();

        let flattened = flatten_tool_result(result, false, McpRedactor::default()).await;

        assert!(!flattened.is_error);
        assert_eq!(flattened.content.as_text(), Some("legacy response"));
    }

    #[tokio::test]
    async fn current_complete_result_preserves_non_object_structured_content() {
        let result: CallToolResult = serde_json::from_value(serde_json::json!({
            "resultType": "complete",
            "content": [{"type": "text", "text": "current response"}],
            "structuredContent": ["baseline", 3]
        }))
        .unwrap();

        let flattened = flatten_tool_result(result, false, McpRedactor::default()).await;

        assert!(!flattened.is_error);
        assert!(flattened.content.contains("current response"));
        assert!(flattened.content.contains("baseline"));
        assert!(flattened.content.contains("3"));
    }

    #[tokio::test]
    async fn rich_blocks_metadata_and_error_state_are_preserved_and_redacted() {
        let result: CallToolResult = serde_json::from_value(serde_json::json!({
            "resultType": "complete",
            "content": [
                {"type": "text", "text": "secret-value", "_meta": {"trace": "secret-value"}},
                {"type": "audio", "data": "c291bmQ=", "mimeType": "audio/wav"},
                {"type": "resource", "resource": {"uri": "memory://note", "mimeType": "text/plain", "text": "body"}},
                {"type": "resource_link", "uri": "https://example.test/item", "name": "item", "title": "Item"}
            ],
            "structuredContent": {"answer": 42, "token": "secret-value"},
            "isError": true,
            "_meta": {"request": "secret-value"}
        }))
        .unwrap();

        let flattened = flatten_tool_result(
            result,
            false,
            McpRedactor::new(vec!["secret-value".to_string()]),
        )
        .await;
        let rendered = flattened.content.to_string();

        assert!(flattened.is_error);
        assert!(rendered.contains("audio/wav"));
        assert!(rendered.contains("memory://note"));
        assert!(rendered.contains("https://example.test/item"));
        assert!(rendered.contains("structuredContent"));
        assert!(rendered.contains("[REDACTED]"));
        assert!(!rendered.contains("secret-value"));
    }

    #[tokio::test]
    async fn oversized_non_image_result_is_a_deterministic_tool_error() {
        let result =
            CallToolResult::success(vec![Content::text("x".repeat(MAX_MCP_NON_IMAGE_BYTES + 1))]);

        let flattened = flatten_tool_result(result, false, McpRedactor::default()).await;

        assert!(flattened.is_error);
        assert_eq!(
            flattened.content.as_text(),
            Some("Error: content_limit_exceeded: MCP non-image result exceeds the byte limit")
        );
    }
}
