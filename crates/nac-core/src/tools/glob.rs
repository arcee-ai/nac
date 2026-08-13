use serde_json::Value;

use crate::tools::{discovery, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "glob".to_string(),
            description: "Find workspace paths by glob pattern. Respects .gitignore and excludes hidden paths by default. Returns stable structured results with bounded cursor pagination. Prefer this over shell path discovery with find, fd, or ls."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1, "maxLength": 1024, "description": "Glob pattern relative to root, for example crates/**/*.rs" },
                    "root": { "type": "string", "maxLength": 1024, "description": "Workspace-relative directory to search", "default": "." },
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
    discovery::execute("glob", args, runtime).await
}
