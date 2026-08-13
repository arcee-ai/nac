use super::*;

pub(super) fn allocate_tool_name(
    server_name: &str,
    tool_name: &str,
    seen_names: &mut HashMap<String, usize>,
) -> String {
    let base = format!(
        "mcp__{}__{}",
        sanitize_identifier(server_name),
        sanitize_identifier(tool_name)
    );
    let count = seen_names.entry(base.clone()).or_insert(0);
    *count += 1;
    if *count == 1 {
        base
    } else {
        format!("{}__{}", base, count)
    }
}

pub(super) fn sanitize_identifier(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}
