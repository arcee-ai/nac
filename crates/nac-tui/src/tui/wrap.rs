use super::*;

pub(super) struct WrappedComposerView {
    pub(super) lines: Vec<Line<'static>>,
    pub(super) cursor_row: u16,
    pub(super) cursor_col: u16,
}

pub(super) fn wrapped_composer_view(
    lines: &[String],
    cursor: (usize, usize),
    width: u16,
    height: u16,
) -> WrappedComposerView {
    let prefix_width = composer_prefix_width();
    let content_width = width.max(1) as usize;
    let effective_width = content_width.saturating_sub(prefix_width).max(1);
    let slash_mode = nac_core::commands::composer_is_slash_mode(lines);

    if lines.len() == 1 && lines.first().is_some_and(|line| line.is_empty()) {
        return WrappedComposerView {
            lines: vec![prompt_line(true, "", false)],
            cursor_row: 0,
            cursor_col: prefix_width as u16,
        };
    }

    let mut visual_lines = Vec::new();
    let mut cursor_row = 0usize;
    let mut cursor_col = 0usize;
    let mut cursor_set = false;

    for (row, line) in lines.iter().enumerate() {
        let display_line = if slash_mode && row == 0 {
            line.strip_prefix('/').unwrap_or(line)
        } else {
            line.as_str()
        };
        let display_cursor = if slash_mode && row == 0 {
            cursor.1.saturating_sub(1)
        } else {
            cursor.1
        };
        let segments = wrap_soft_line(display_line, effective_width);
        let mut start = 0usize;
        for (segment_index, segment) in segments.iter().enumerate() {
            let segment_len = segment.chars().count();
            let end = start + segment_len;
            if !cursor_set && row == cursor.0 {
                let is_last_segment = segment_index + 1 == segments.len();
                if display_cursor <= end || is_last_segment {
                    cursor_row = visual_lines.len();
                    cursor_col =
                        prefix_width + display_cursor.saturating_sub(start).min(segment_len);
                    cursor_set = true;
                }
            }
            let is_first_visual = visual_lines.is_empty();
            visual_lines.push((is_first_visual, segment.clone()));
            start = end;
        }

        if !cursor_set && row == cursor.0 && line.is_empty() {
            cursor_row = visual_lines.len().saturating_sub(1);
            cursor_col = prefix_width;
            cursor_set = true;
        }
    }

    if !cursor_set {
        cursor_row = visual_lines.len().saturating_sub(1);
        cursor_col = visual_lines
            .last()
            .map(|(_, line)| prefix_width + line.chars().count())
            .unwrap_or(prefix_width);
    }

    let height = height.max(1) as usize;
    let scroll_top = cursor_row.saturating_sub(height.saturating_sub(1));
    let visible = visual_lines
        .into_iter()
        .skip(scroll_top)
        .take(height)
        .map(|(is_first, line)| prompt_line(is_first, &line, slash_mode))
        .collect();

    WrappedComposerView {
        lines: visible,
        cursor_row: cursor_row.saturating_sub(scroll_top) as u16,
        cursor_col: cursor_col as u16,
    }
}

pub(super) fn wrap_logical_lines(lines: &[String], width: usize) -> Vec<WrappedRow> {
    let mut rows = Vec::new();
    for (logical_line, line) in lines.iter().enumerate() {
        let wrapped = wrap_soft_line_with_ranges(line, width);
        if wrapped.is_empty() {
            rows.push(WrappedRow {
                logical_line,
                start_char: 0,
                end_char: 0,
                text: String::new(),
                spans: Vec::new(),
            });
            continue;
        }
        for (start_char, end_char, text) in wrapped {
            rows.push(WrappedRow {
                logical_line,
                start_char,
                end_char,
                spans: vec![StyledSegment {
                    text: text.clone(),
                    style: Style::default().fg(Color::Gray),
                }],
                text,
            });
        }
    }
    if rows.is_empty() {
        rows.push(WrappedRow {
            logical_line: 0,
            start_char: 0,
            end_char: 0,
            text: String::new(),
            spans: Vec::new(),
        });
    }
    rows
}

pub(super) fn wrap_styled_lines(lines: &[Line<'static>], width: usize) -> Vec<WrappedRow> {
    let mut rows = Vec::new();
    for (logical_line, line) in lines.iter().enumerate() {
        let plain = line_to_plain_text(line);
        if plain.is_empty() {
            rows.push(WrappedRow {
                logical_line,
                start_char: 0,
                end_char: 0,
                text: String::new(),
                spans: Vec::new(),
            });
            continue;
        }

        let wrapped_ranges = wrap_soft_line_with_ranges(&plain, width);
        let chars = flatten_line_chars(line);
        for (start_char, end_char, text) in wrapped_ranges {
            rows.push(WrappedRow {
                logical_line,
                start_char,
                end_char,
                spans: group_styled_chars(&chars[start_char..end_char]),
                text,
            });
        }
    }

    if rows.is_empty() {
        rows.push(WrappedRow {
            logical_line: 0,
            start_char: 0,
            end_char: 0,
            text: String::new(),
            spans: Vec::new(),
        });
    }

    rows
}

pub(super) fn flatten_line_chars(line: &Line<'static>) -> Vec<(char, Style)> {
    let mut chars = Vec::new();
    for span in &line.spans {
        for ch in span.content.chars() {
            chars.push((ch, span.style));
        }
    }
    chars
}

pub(super) fn group_styled_chars(chars: &[(char, Style)]) -> Vec<StyledSegment> {
    let mut segments = Vec::new();
    let mut current_style = None;
    let mut current_text = String::new();

    for (ch, style) in chars {
        match current_style {
            Some(existing) if existing == *style => current_text.push(*ch),
            Some(existing) => {
                segments.push(StyledSegment {
                    text: std::mem::take(&mut current_text),
                    style: existing,
                });
                current_style = Some(*style);
                current_text.push(*ch);
            }
            None => {
                current_style = Some(*style);
                current_text.push(*ch);
            }
        }
    }

    if let Some(style) = current_style {
        segments.push(StyledSegment {
            text: current_text,
            style,
        });
    }

    segments
}

pub(super) fn wrap_soft_line_with_ranges(line: &str, width: usize) -> Vec<(usize, usize, String)> {
    if width == 0 {
        return vec![(0, 0, String::new())];
    }
    if line.is_empty() {
        return vec![(0, 0, String::new())];
    }

    let chars: Vec<char> = line.chars().collect();
    let mut segments = Vec::new();
    let mut start = 0usize;

    while start < chars.len() {
        let remaining = chars.len() - start;
        if remaining <= width {
            segments.push((start, chars.len(), chars[start..].iter().collect()));
            break;
        }

        let slice_end = start + width;
        let mut split = None;
        for idx in (start..slice_end).rev() {
            if chars[idx].is_whitespace() {
                split = Some(idx + 1);
                break;
            }
        }

        let end = split.unwrap_or(slice_end);
        if end == start {
            let forced_end = (start + width).min(chars.len());
            segments.push((start, forced_end, chars[start..forced_end].iter().collect()));
            start = forced_end;
        } else {
            segments.push((start, end, chars[start..end].iter().collect()));
            start = end;
        }
    }

    if segments.is_empty() {
        segments.push((0, 0, String::new()));
    }
    segments
}

pub(super) fn wrap_soft_line(line: &str, width: usize) -> Vec<String> {
    wrap_soft_line_with_ranges(line, width)
        .into_iter()
        .map(|(_, _, text)| text)
        .collect()
}
