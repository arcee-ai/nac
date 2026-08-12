use serde_json::Value;

use crate::tools::{discovery, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "grep".to_string(),
            description: "Search workspace file contents with literal or regular-expression matching. Respects .gitignore and excludes hidden paths by default. Returns stable structured matches with bounded cursor pagination. Prefer this over shell content search with grep or rg."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1, "maxLength": 65536, "description": "Literal text or regular expression to find" },
                    "roots": { "type": "array", "items": { "type": "string", "maxLength": 1024 }, "minItems": 1, "maxItems": 32, "description": "Workspace-relative files or directories to search", "default": ["."] },
                    "regex": { "type": "boolean", "description": "Interpret pattern as a regular expression", "default": true },
                    "case": { "type": "string", "enum": ["smart", "sensitive", "insensitive"], "description": "Case matching mode; smart is insensitive only when pattern has no uppercase characters", "default": "smart" },
                    "globs": { "type": "array", "items": { "type": "string", "maxLength": 1024 }, "maxItems": 128, "description": "Optional workspace-relative path glob filters" },
                    "context": { "type": "integer", "minimum": 0, "maximum": 100, "description": "Lines of before and after context", "default": 0 },
                    "multiline": { "type": "boolean", "description": "Allow matches to span lines", "default": false },
                    "gitignore": { "type": "boolean", "description": "Respect workspace .gitignore rules and default generated-directory exclusions", "default": true },
                    "hidden": { "type": "boolean", "description": "Include paths with hidden components", "default": false },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1000, "description": "Maximum records returned on this page", "default": 200 },
                    "cursor": { "type": "string", "maxLength": 4096, "description": "Opaque continuation cursor returned by an earlier identical request" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        },
    }
}

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    discovery::execute("grep", args, runtime).await
}
