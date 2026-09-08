use super::*;

pub(super) fn search_bytes(
    raw: Vec<u8>,
    path: &str,
    plan: &GrepPlan,
    match_budget: usize,
    materialized_bytes: &mut usize,
    cancellation: &AtomicBool,
) -> (Vec<Record>, usize) {
    if raw.iter().take(8192).any(|byte| *byte == 0) {
        return (
            vec![diagnostic("binary_file", "binary file skipped", Some(path))],
            raw.len(),
        );
    }
    let text = String::from_utf8_lossy(&raw);
    let bytes = text.as_bytes();
    let mut line_count = usize::from(bytes.is_empty() || !bytes.ends_with(b"\n"));
    for chunk in bytes.chunks(64 * 1024) {
        if cancellation.load(Ordering::Acquire) {
            return (
                vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                raw.len(),
            );
        }
        line_count += chunk.iter().filter(|byte| **byte == b'\n').count();
        if line_count > MAX_LINES_PER_FILE {
            return (
                vec![diagnostic(
                    "line_limit",
                    &format!("file exceeds {MAX_LINES_PER_FILE} lines"),
                    Some(path),
                )],
                raw.len(),
            );
        }
    }
    let line_ranges = line_ranges(bytes);
    let line_starts: Vec<usize> = line_ranges.iter().map(|range| range.0).collect();
    let effective_limit = MAX_MATCHES.min(match_budget.max(1));
    let record_limited = match_budget <= MAX_MATCHES;
    let probe_limit = effective_limit.saturating_add(1);
    let mut matches = Vec::<(usize, usize, usize, bool)>::new();

    if plan.multiline {
        let result = plan.matcher.find_iter(bytes, |matched| {
            let line_index = line_index_at(&line_starts, matched.start());
            matches.push((matched.start(), matched.end(), line_index, true));
            !cancellation.load(Ordering::Acquire) && matches.len() < probe_limit
        });
        if result.is_err() {
            return (
                vec![diagnostic(
                    "invalid_regex",
                    "regex search failed",
                    Some(path),
                )],
                raw.len(),
            );
        }
    } else {
        'lines: for (line_index, (start, content_end, _end)) in
            line_ranges.iter().copied().enumerate()
        {
            if cancellation.load(Ordering::Acquire) {
                return (
                    vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                    raw.len(),
                );
            }
            let line = &bytes[start..content_end];
            let result = plan.matcher.find_iter(line, |matched| {
                matches.push((
                    start + matched.start(),
                    start + matched.end(),
                    line_index,
                    false,
                ));
                matches.len() < probe_limit
            });
            if result.is_err() {
                return (
                    vec![diagnostic(
                        "invalid_regex",
                        "regex search failed",
                        Some(path),
                    )],
                    raw.len(),
                );
            }
            if matches.len() >= probe_limit {
                break 'lines;
            }
        }
    }

    let hit_limit = matches.len() > effective_limit;
    matches.truncate(effective_limit);
    let mut found = Vec::new();
    for (start, end, line_index, is_multiline) in matches {
        if cancellation.load(Ordering::Acquire) {
            return (
                vec![diagnostic("cancelled", "search was cancelled", Some(path))],
                raw.len(),
            );
        }
        let shown = if is_multiline {
            &bytes[start..end]
        } else {
            let (line_start, content_end, _) = line_ranges[line_index];
            &bytes[line_start..content_end]
        };
        let (shown, shown_truncated) = bounded_bytes(shown, MAX_FIELD_BYTES);
        let mut item = Map::new();
        item.insert("path".into(), Value::String(path.to_string()));
        item.insert("line".into(), json!(line_index + 1));
        item.insert("column".into(), json!(start - line_starts[line_index] + 1));
        item.insert("text".into(), Value::String(shown));
        item.insert("_start".into(), json!(start));
        item.insert("_end".into(), json!(end));
        if shown_truncated {
            item.insert("text_truncated".into(), Value::Bool(true));
        }
        if plan.context > 0 {
            let before_start = line_index.saturating_sub(plan.context);
            let before = line_ranges[before_start..line_index]
                .iter()
                .map(|(start, content_end, _)| {
                    bounded_bytes(&bytes[*start..*content_end], MAX_CONTEXT_LINE_BYTES)
                })
                .collect::<Vec<_>>();
            let end_line = line_index_at(&line_starts, end.saturating_sub(1).max(start)) + 1;
            let after_end = (end_line + plan.context).min(line_ranges.len());
            let after = line_ranges[end_line..after_end]
                .iter()
                .map(|(start, content_end, _)| {
                    bounded_bytes(&bytes[*start..*content_end], MAX_CONTEXT_LINE_BYTES)
                })
                .collect::<Vec<_>>();
            let context_truncated = before.iter().chain(&after).any(|(_, truncated)| *truncated);
            item.insert(
                "before".into(),
                Value::Array(
                    before
                        .into_iter()
                        .map(|(line, _)| Value::String(line))
                        .collect(),
                ),
            );
            item.insert(
                "after".into(),
                Value::Array(
                    after
                        .into_iter()
                        .map(|(line, _)| Value::String(line))
                        .collect(),
                ),
            );
            if context_truncated {
                item.insert("context_truncated".into(), Value::Bool(true));
            }
        }
        let value = Value::Object(item);
        let encoded = serde_json::to_vec(&value).map_or(usize::MAX, |bytes| bytes.len());
        if encoded > MAX_MATERIALIZED_BYTES.saturating_sub(*materialized_bytes) {
            found.push(diagnostic(
                "materialized_limit",
                &format!("search exceeded {MAX_MATERIALIZED_BYTES} materialized bytes"),
                Some(path),
            ));
            return (found, raw.len());
        }
        *materialized_bytes += encoded;
        found.push(Record::Match(value));
    }
    if hit_limit {
        let (code, message) = if record_limited {
            (
                "record_limit",
                format!("search exceeded {MAX_RECORDS} structured records"),
            )
        } else {
            (
                "match_limit",
                format!("search exceeded {effective_limit} matches in this bounded unit"),
            )
        };
        found.push(diagnostic(code, &message, Some(path)));
    }
    (found, raw.len())
}

pub(super) fn compile_grep(object: &Map<String, Value>) -> SearchResult<GrepPlan> {
    let pattern = required_string(
        object,
        "pattern",
        "invalid_regex",
        "pattern must be a non-empty string",
    )?;
    if pattern.is_empty() {
        return Err(SearchError::new(
            "invalid_regex",
            "pattern must be a non-empty string",
        ));
    }
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(SearchError::new("invalid_regex", "pattern is too large"));
    }
    let regex = optional_bool(object, "regex", true)?;
    let multiline = optional_bool(object, "multiline", false)?;
    let case = object
        .get("case")
        .and_then(Value::as_str)
        .unwrap_or("smart");
    if !matches!(case, "smart" | "sensitive" | "insensitive") {
        return Err(SearchError::new(
            "invalid_arguments",
            "case must be smart, sensitive, or insensitive",
        ));
    }
    if object.get("case").is_some_and(|value| !value.is_string()) {
        return Err(SearchError::new(
            "invalid_arguments",
            "case must be smart, sensitive, or insensitive",
        ));
    }
    let context = optional_usize(object, "context", 0, 0, 100)?;
    let mut builder = RegexMatcherBuilder::new();
    builder
        .fixed_strings(!regex)
        .multi_line(true)
        .dot_matches_new_line(multiline)
        .size_limit(MAX_REGEX_AUTOMATON_BYTES)
        .dfa_size_limit(MAX_REGEX_AUTOMATON_BYTES)
        .nest_limit(MAX_REGEX_NESTING);
    match case {
        "smart" => {
            builder.case_smart(true);
        }
        "insensitive" => {
            builder.case_insensitive(true);
        }
        "sensitive" => {}
        _ => unreachable!(),
    }
    let matcher = builder
        .build(pattern)
        .map_err(|error| SearchError::new("invalid_regex", error.to_string()))?;
    Ok(GrepPlan {
        matcher,
        multiline,
        context,
    })
}

pub(super) fn compile_glob(pattern: &str) -> SearchResult<GlobMatcher> {
    if pattern.is_empty() {
        return Err(SearchError::new(
            "invalid_glob",
            "glob pattern must be a non-empty string",
        ));
    }
    if pattern.len() > MAX_PATTERN_BYTES {
        return Err(SearchError::new(
            "invalid_glob",
            "glob pattern is too large",
        ));
    }
    GlobBuilder::new(pattern)
        .literal_separator(true)
        .backslash_escape(true)
        .build()
        .map(|glob| glob.compile_matcher())
        .map_err(|error| SearchError::new("invalid_glob", error.to_string()))
}

pub(super) fn parse_common(object: &Map<String, Value>) -> SearchResult<CommonArgs> {
    Ok(CommonArgs {
        gitignore: optional_bool(object, "gitignore", true)?,
        hidden: optional_bool(object, "hidden", false)?,
        limit: optional_usize(object, "limit", 200, 1, MAX_LIMIT)?,
    })
}
