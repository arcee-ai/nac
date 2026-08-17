use crate::tool_content::{ToolImage, MAX_IMAGES_PER_RESULT, MAX_RESULT_IMAGE_BYTES};
use crate::types::{ToolContent, ToolContentPart};

use super::*;

pub(super) async fn flatten_tool_result(
    result: rmcp::model::CallToolResult,
    image_results: bool,
) -> ToolResult {
    match tokio::task::spawn_blocking(move || flatten_tool_result_blocking(result, image_results))
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
) -> ToolResult {
    let mut parts = Vec::new();
    let mut text_sections = Vec::new();
    let mut image_count = 0usize;
    let mut encoded_image_bytes = 0usize;

    for content in result.content {
        if let Some(text) = content.as_text() {
            text_sections.push(text.text.clone());
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

        if let Some(resource) = content.as_resource() {
            if let rmcp::model::ResourceContents::TextResourceContents { text, .. } =
                &resource.resource
            {
                text_sections.push(text.clone());
                continue;
            }
        }

        if let Some(link) = content.as_resource_link() {
            text_sections.push(format!("Resource: {}", link.uri));
            continue;
        }

        match serde_json::to_string_pretty(&content) {
            Ok(rendered) => text_sections.push(rendered),
            Err(_) => text_sections.push("[unsupported MCP content]".to_string()),
        }
    }

    if let Some(structured) = result.structured_content {
        match serde_json::to_string_pretty(&structured) {
            Ok(rendered) => text_sections.push(rendered),
            Err(_) => text_sections.push(structured.to_string()),
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
    use rmcp::model::{CallToolResult, Content};
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

        let flattened = flatten_tool_result(result, true).await;
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
        let flattened = flatten_tool_result(result, true).await;
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

        let flattened = flatten_tool_result(result, true).await;
        assert!(flattened.is_error);
        assert!(flattened.content.contains("image_limit_exceeded"));
    }

    #[tokio::test]
    async fn mcp_image_is_rejected_when_selected_model_lacks_vision() {
        let result = CallToolResult::success(vec![Content::image("not decoded", "image/png")]);
        let flattened = flatten_tool_result(result, false).await;

        assert!(flattened.is_error);
        assert!(flattened.content.contains("unsupported_image"));
        assert!(!flattened.content.contains_images());
    }
}
