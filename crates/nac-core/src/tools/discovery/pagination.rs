use super::*;

struct PublicRecord {
    value: Value,
    is_error: bool,
    encoded_len: usize,
}

pub(super) fn paginate(
    tool: &str,
    args: &Value,
    records: Vec<Record>,
    limit: usize,
) -> SearchResult<Value> {
    let fingerprint = canonical_request(tool, args)?;
    let total = records.len();
    let offset = decode_cursor(args.get("cursor"), &fingerprint, total)?;
    let mut selected = Vec::new();
    let mut entry_count = 0usize;
    let mut entry_bytes = 0usize;
    let mut error_count = 0usize;
    let mut error_bytes = 0usize;
    let mut index = offset;
    for record in records.into_iter().skip(offset).take(limit) {
        let public = public_record(tool, record)?;
        let candidate_index = index + 1;
        let envelope = page_body(tool, &[], candidate_index, total, &fingerprint)?;
        let envelope_len = serde_json::to_vec(&envelope)
            .map_err(|error| SearchError::new("internal_error", error.to_string()))?
            .len();
        let candidate_entry_count = entry_count + usize::from(!public.is_error);
        let candidate_entry_bytes = entry_bytes
            + if public.is_error {
                0
            } else {
                public.encoded_len
            };
        let candidate_error_count = error_count + usize::from(public.is_error);
        let candidate_error_bytes = error_bytes
            + if public.is_error {
                public.encoded_len
            } else {
                0
            };
        let extra = candidate_entry_bytes
            + candidate_entry_count.saturating_sub(1)
            + candidate_error_bytes
            + candidate_error_count.saturating_sub(1);
        if envelope_len.saturating_add(extra) > MAX_OUTPUT_BYTES {
            break;
        }
        if public.is_error {
            error_count += 1;
            error_bytes += public.encoded_len;
        } else {
            entry_count += 1;
            entry_bytes += public.encoded_len;
        }
        selected.push(public);
        index = candidate_index;
    }
    if index == offset && index < total {
        return Err(SearchError::new(
            "output_limit",
            "the next bounded record cannot fit in the output limit",
        ));
    }
    page_body(tool, &selected, index, total, &fingerprint)
}

fn public_record(tool: &str, record: Record) -> SearchResult<PublicRecord> {
    let is_error = record.is_error();
    let mut record = record.into_value();
    if let Some(object) = record.as_object_mut() {
        object.remove("_start");
        object.remove("_end");
        if tool == "glob" {
            object.remove("size");
        }
    }
    let encoded_len = serde_json::to_vec(&record)
        .map_err(|error| SearchError::new("internal_error", error.to_string()))?
        .len();
    Ok(PublicRecord {
        value: record,
        is_error,
        encoded_len,
    })
}

fn page_body(
    tool: &str,
    selected: &[PublicRecord],
    index: usize,
    total: usize,
    fingerprint: &str,
) -> SearchResult<Value> {
    let truncated = index < total;
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    for record in selected {
        if record.is_error {
            errors.push(record.value.clone());
        } else {
            entries.push(record.value.clone());
        }
    }
    Ok(json!({
        if tool == "glob" { "entries" } else { "matches" }: entries,
        "truncated": truncated,
        "next_cursor": if truncated { Some(encode_cursor(fingerprint, index)?) } else { None },
        "errors": errors,
    }))
}

pub(super) fn canonical_request(tool: &str, args: &Value) -> SearchResult<String> {
    let mut args = args.clone();
    if let Some(object) = args.as_object_mut() {
        object.remove("cursor");
    }
    let raw = serde_json::to_vec(&json!({ "tool": tool, "args": args }))
        .map_err(|error| SearchError::new("internal_error", error.to_string()))?;
    Ok(format!("{:x}", Sha256::digest(raw)))
}

pub(super) fn encode_cursor(fingerprint: &str, offset: usize) -> SearchResult<String> {
    let raw = serde_json::to_vec(&json!({
        "v": CURSOR_VERSION,
        "q": fingerprint,
        "o": offset,
    }))
    .map_err(|error| SearchError::new("internal_error", error.to_string()))?;
    Ok(URL_SAFE_NO_PAD.encode(raw))
}

pub(super) fn decode_cursor(
    value: Option<&Value>,
    fingerprint: &str,
    total: usize,
) -> SearchResult<usize> {
    let Some(value) = value else {
        return Ok(0);
    };
    if value.is_null()
        || value.as_str().is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "" | "none" | "null"
            )
        })
    {
        return Ok(0);
    }
    let value = value
        .as_str()
        .ok_or_else(|| SearchError::new("invalid_cursor", "cursor must be a string"))?;
    if value.len() > MAX_CURSOR_BYTES {
        return Err(SearchError::new("invalid_cursor", "cursor is too large"));
    }
    let raw = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| SearchError::new("invalid_cursor", "cursor is malformed"))?;
    let payload: Value = serde_json::from_slice(&raw)
        .map_err(|_| SearchError::new("invalid_cursor", "cursor is malformed"))?;
    if payload.get("v").and_then(Value::as_u64) != Some(CURSOR_VERSION) {
        return Err(SearchError::new(
            "invalid_cursor",
            "cursor version is unsupported",
        ));
    }
    if payload.get("q").and_then(Value::as_str) != Some(fingerprint) {
        return Err(SearchError::new(
            "invalid_cursor",
            "cursor does not match this request",
        ));
    }
    let offset = payload
        .get("o")
        .and_then(Value::as_u64)
        .and_then(|offset| usize::try_from(offset).ok())
        .filter(|offset| *offset <= total)
        .ok_or_else(|| SearchError::new("invalid_cursor", "cursor offset is out of range"))?;
    Ok(offset)
}

pub(super) fn validate_collection(
    values: &[Value],
    name: &str,
    maximum: usize,
) -> SearchResult<()> {
    if values.len() > maximum {
        return Err(SearchError::new(
            "invalid_arguments",
            format!("{name} may contain at most {maximum} values"),
        ));
    }
    let bytes = values
        .iter()
        .filter_map(Value::as_str)
        .map(str::len)
        .sum::<usize>();
    if bytes > MAX_COLLECTION_BYTES {
        return Err(SearchError::new(
            "invalid_arguments",
            format!("{name} exceeds the aggregate byte limit"),
        ));
    }
    Ok(())
}

pub(super) fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    code: &'static str,
    message: &'static str,
) -> SearchResult<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| SearchError::new(code, message))
}

pub(super) fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    default: bool,
) -> SearchResult<bool> {
    match object.get(key) {
        None => Ok(default),
        Some(value) => value.as_bool().ok_or_else(|| {
            SearchError::new("invalid_arguments", format!("{key} must be a boolean"))
        }),
    }
}

pub(super) fn optional_usize(
    object: &Map<String, Value>,
    key: &str,
    default: usize,
    minimum: usize,
    maximum: usize,
) -> SearchResult<usize> {
    let Some(value) = object.get(key) else {
        return Ok(default);
    };
    let value = value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value >= minimum && *value <= maximum)
        .ok_or_else(|| {
            SearchError::new(
                "invalid_arguments",
                format!("{key} must be between {minimum} and {maximum}"),
            )
        })?;
    Ok(value)
}

pub(super) fn diagnostic(code: &str, message: &str, path: Option<&str>) -> Record {
    let (message, message_truncated) = bounded_bytes(message.as_bytes(), MAX_FIELD_BYTES);
    let mut item = Map::new();
    item.insert("code".into(), Value::String(code.to_string()));
    item.insert("message".into(), Value::String(message));
    let mut truncated = message_truncated;
    if let Some(path) = path {
        let (path, path_truncated) = bounded_bytes(path.as_bytes(), MAX_FIELD_BYTES);
        item.insert("path".into(), Value::String(path));
        truncated |= path_truncated;
    }
    if truncated {
        item.insert("message_truncated".into(), Value::Bool(true));
    }
    Record::Error(Value::Object(item))
}

pub(super) fn error_result(code: &str, message: &str, path: Option<&str>) -> ToolResult {
    ToolResult {
        content: (json!({
            "error": {
                "code": code,
                "message": message,
                "path": path,
            }
        })
        .to_string())
        .into(),
        is_error: true,
    }
}

pub(super) fn bounded_bytes(bytes: &[u8], maximum: usize) -> (String, bool) {
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= maximum {
        return (text.into_owned(), false);
    }
    let mut end = maximum;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}…", &text[..end]), true)
}

pub(super) fn line_ranges(bytes: &[u8]) -> Vec<(usize, usize, usize)> {
    if bytes.is_empty() {
        return vec![(0, 0, 0)];
    }
    let mut ranges = Vec::new();
    let mut start = 0;
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == b'\n' {
            let content_end = if index > start && bytes[index - 1] == b'\r' {
                index - 1
            } else {
                index
            };
            ranges.push((start, content_end, index + 1));
            start = index + 1;
        }
    }
    if start < bytes.len() {
        let content_end = if bytes.last() == Some(&b'\r') {
            bytes.len() - 1
        } else {
            bytes.len()
        };
        ranges.push((start, content_end, bytes.len()));
    }
    ranges
}

pub(super) fn line_index_at(starts: &[usize], position: usize) -> usize {
    starts
        .partition_point(|start| *start <= position)
        .saturating_sub(1)
}

pub(super) fn sort_records(records: &mut [Record]) {
    records.sort_by(|left, right| {
        let left_key = (
            record_path(left).as_bytes(),
            left.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            left.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            left.sort_tag(),
            left.get("kind").and_then(Value::as_str).unwrap_or_default(),
            left.get("code").and_then(Value::as_str).unwrap_or_default(),
        );
        let right_key = (
            record_path(right).as_bytes(),
            right.get("_start").and_then(Value::as_i64).unwrap_or(-1),
            right.get("_end").and_then(Value::as_i64).unwrap_or(-1),
            right.sort_tag(),
            right
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            right
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        left_key.cmp(&right_key)
    });
}

pub(super) fn cap_records(records: &mut Vec<Record>, path: &str) {
    if records.len() <= MAX_RECORDS {
        return;
    }
    records.truncate(MAX_RECORDS - 1);
    records.push(diagnostic(
        "record_limit",
        &format!("search exceeded {MAX_RECORDS} structured records"),
        Some(path),
    ));
}

pub(super) fn record_path(record: &Record) -> &str {
    record
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

pub(super) fn join_path(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

pub(super) fn relative_path_string(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => parts.push(part.to_str()?),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(parts.join("/"))
}

pub(super) fn display_path(path: &str) -> String {
    if path.is_empty() {
        ".".to_string()
    } else {
        path.to_string()
    }
}

pub(super) fn is_hidden(path: &str) -> bool {
    path.split('/')
        .any(|part| part.starts_with('.') && part != "." && part != "..")
}

pub(super) fn ancestors_before(path: &str) -> Vec<String> {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        return Vec::new();
    }
    let mut ancestors = vec![String::new()];
    let mut current = String::new();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        current = join_path(&current, part);
        ancestors.push(current.clone());
    }
    ancestors
}

pub(super) fn normalize_ignore_pattern(line: &str) -> String {
    let mut line = line.trim_end_matches('\r').to_string();
    while line.ends_with(' ') {
        let slash_count = line[..line.len() - 1]
            .bytes()
            .rev()
            .take_while(|byte| *byte == b'\\')
            .count();
        if slash_count % 2 == 1 {
            break;
        }
        line.pop();
    }
    line
}
