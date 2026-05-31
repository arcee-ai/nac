use super::*;

pub(super) fn render_markdown_lines(text: &str, max_width: Option<usize>) -> Vec<Line<'static>> {
    if text.is_empty() {
        return vec![Line::from("")];
    }

    let raw_lines: Vec<&str> = text.split('\n').collect();
    let mut rendered = Vec::new();
    let mut index = 0usize;

    while index < raw_lines.len() {
        let raw_line = raw_lines[index];
        let trimmed = raw_line.trim();

        if let Some(info) = trimmed.strip_prefix("```") {
            let (next_index, code_lines) =
                render_markdown_code_block(&raw_lines, index, info.trim().to_string());
            rendered.extend(code_lines);
            index = next_index;
            continue;
        }

        if let Some((next_index, table_lines)) =
            render_markdown_table_block(&raw_lines, index, max_width)
        {
            rendered.extend(table_lines);
            index = next_index;
            continue;
        }

        if trimmed.is_empty() {
            rendered.push(Line::from(""));
            index += 1;
            continue;
        }

        if is_markdown_rule(trimmed) {
            rendered.push(Line::from(Span::styled(
                "─".repeat(24),
                Style::default().fg(Color::DarkGray),
            )));
            index += 1;
            continue;
        }

        if let Some((level, content)) = parse_markdown_heading(trimmed) {
            rendered.push(render_markdown_heading_line(level, content));
            index += 1;
            continue;
        }

        if let Some((quote_level, content)) = parse_markdown_quote(trimmed) {
            rendered.push(render_markdown_quote_line(quote_level, content));
            index += 1;
            continue;
        }

        if let Some(line) = render_markdown_list_item(raw_line) {
            rendered.push(line);
            index += 1;
            continue;
        }

        rendered.push(Line::from(render_inline_markdown(
            raw_line.trim_end(),
            Style::default().fg(Color::White),
        )));
        index += 1;
    }

    if rendered.is_empty() {
        vec![Line::from("")]
    } else {
        rendered
    }
}

pub(super) fn is_markdown_rule(line: &str) -> bool {
    let compact: String = line.chars().filter(|char| !char.is_whitespace()).collect();
    matches!(compact.as_str(), "---" | "***" | "___")
}

pub(super) fn parse_markdown_heading(line: &str) -> Option<(usize, &str)> {
    let level = line.chars().take_while(|char| *char == '#').count();
    if !(1..=6).contains(&level) || line.chars().nth(level) != Some(' ') {
        return None;
    }
    Some((level, line[level + 1..].trim()))
}

pub(super) fn parse_markdown_quote(line: &str) -> Option<(usize, &str)> {
    let mut level = 0usize;
    let mut rest = line;
    while let Some(stripped) = rest.strip_prefix('>') {
        level = level.saturating_add(1);
        rest = stripped.trim_start();
    }
    (level > 0).then_some((level, rest))
}

pub(super) fn render_markdown_list_item(line: &str) -> Option<Line<'static>> {
    let indent = line.chars().take_while(|char| char.is_whitespace()).count() / 2;
    let trimmed = line.trim_start();

    if let Some(content) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
        .or_else(|| trimmed.strip_prefix("+ "))
    {
        let mut spans = vec![
            Span::raw("  ".repeat(indent)),
            Span::styled("• ", Style::default().fg(Color::DarkGray)),
        ];
        spans.extend(render_inline_markdown(
            content.trim_end(),
            Style::default().fg(Color::White),
        ));
        return Some(Line::from(spans));
    }

    let digits = trimmed
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .count();
    if digits == 0 {
        return None;
    }

    let marker = trimmed.chars().nth(digits)?;
    if !matches!(marker, '.' | ')') || trimmed.chars().nth(digits + 1) != Some(' ') {
        return None;
    }

    let number = &trimmed[..digits];
    let content = trimmed[digits + 2..].trim_end();
    let mut spans = vec![
        Span::raw("  ".repeat(indent)),
        Span::styled(format!("{number}. "), Style::default().fg(Color::DarkGray)),
    ];
    spans.extend(render_inline_markdown(
        content,
        Style::default().fg(Color::White),
    ));
    Some(Line::from(spans))
}

pub(super) fn render_inline_markdown(text: &str, base_style: Style) -> Vec<Span<'static>> {
    let chars: Vec<char> = text.chars().collect();
    let mut spans = Vec::new();
    let mut buffer = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        if chars[index] == '\\' && index + 1 < chars.len() {
            buffer.push(chars[index + 1]);
            index += 2;
            continue;
        }

        if chars[index] == '!' && index + 1 < chars.len() && chars[index + 1] == '[' {
            if let Some((next_index, rendered)) =
                parse_markdown_link(&chars, index + 1, true, base_style)
            {
                push_styled_text(&mut spans, &mut buffer, base_style);
                spans.extend(rendered);
                index = next_index;
                continue;
            }
        }

        if chars[index] == '[' {
            if let Some((next_index, rendered)) =
                parse_markdown_link(&chars, index, false, base_style)
            {
                push_styled_text(&mut spans, &mut buffer, base_style);
                spans.extend(rendered);
                index = next_index;
                continue;
            }
        }

        if chars[index] == '`' {
            if let Some(close_offset) = chars[index + 1..].iter().position(|char| *char == '`') {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let code: String = chars[index + 1..index + 1 + close_offset].iter().collect();
                spans.push(Span::styled(code, markdown_code_style()));
                index += close_offset + 2;
                continue;
            }
            buffer.push(chars[index]);
            index += 1;
            continue;
        }

        // Three-char delimiter: ___text___ or ***text*** → bold+italic
        // Must be exactly 3 of the same char (not 4+, which falls through to two-char bold).
        if index + 2 < chars.len()
            && chars[index] == chars[index + 1]
            && chars[index + 1] == chars[index + 2]
            && matches!(chars[index], '*' | '_')
            && (index + 3 >= chars.len() || chars[index + 3] != chars[index])
        {
            let can_open = is_left_flanking(&chars, index, 3)
                && (chars[index] != '_' || !is_right_flanking(&chars, index, 3));
            if can_open {
                if let Some(close_index) =
                    find_closing_marker(&chars, index + 3, &[chars[index]; 3], true)
                {
                    push_styled_text(&mut spans, &mut buffer, base_style);
                    let inner: String = chars[index + 3..close_index].iter().collect();
                    spans.extend(render_inline_markdown(
                        &inner,
                        base_style
                            .add_modifier(Modifier::BOLD)
                            .add_modifier(Modifier::ITALIC),
                    ));
                    index = close_index + 3;
                    continue;
                }
            }
        }

        if index + 1 < chars.len()
            && matches!((chars[index], chars[index + 1]), ('*', '*') | ('_', '_'))
        {
            let can_open = is_left_flanking(&chars, index, 2)
                && (chars[index] != '_' || !is_right_flanking(&chars, index, 2));
            if can_open {
                if let Some(close_index) =
                    find_closing_marker(&chars, index + 2, &[chars[index], chars[index + 1]], true)
                {
                    push_styled_text(&mut spans, &mut buffer, base_style);
                    let inner: String = chars[index + 2..close_index].iter().collect();
                    spans.extend(render_inline_markdown(
                        &inner,
                        base_style.add_modifier(Modifier::BOLD),
                    ));
                    index = close_index + 2;
                    continue;
                }
            }
        }

        if index + 1 < chars.len() && chars[index] == '~' && chars[index + 1] == '~' {
            if let Some(close_index) = find_closing_marker(&chars, index + 2, &['~', '~'], false) {
                push_styled_text(&mut spans, &mut buffer, base_style);
                let inner: String = chars[index + 2..close_index].iter().collect();
                spans.extend(render_inline_markdown(
                    &inner,
                    base_style.add_modifier(Modifier::CROSSED_OUT),
                ));
                index = close_index + 2;
                continue;
            }
        }

        if matches!(chars[index], '*' | '_') {
            // Don't treat as a single-char delimiter if part of a multi-char run
            // (e.g. the second '_' in '__'). The multi-char checks above handle those.
            if index > 0 && chars[index - 1] == chars[index] {
                buffer.push(chars[index]);
                index += 1;
                continue;
            }
            let can_open = is_left_flanking(&chars, index, 1)
                && (chars[index] != '_' || !is_right_flanking(&chars, index, 1));
            if can_open {
                if let Some(close_index) =
                    find_closing_marker(&chars, index + 1, &[chars[index]], true)
                {
                    push_styled_text(&mut spans, &mut buffer, base_style);
                    let inner: String = chars[index + 1..close_index].iter().collect();
                    spans.extend(render_inline_markdown(
                        &inner,
                        base_style.add_modifier(Modifier::ITALIC),
                    ));
                    index = close_index + 1;
                    continue;
                }
            }
        }

        buffer.push(chars[index]);
        index += 1;
    }

    push_styled_text(&mut spans, &mut buffer, base_style);
    spans
}

pub(super) fn parse_markdown_link(
    chars: &[char],
    start: usize,
    is_image: bool,
    base_style: Style,
) -> Option<(usize, Vec<Span<'static>>)> {
    let bracket_start = start;
    if chars.get(bracket_start)? != &'[' {
        return None;
    }

    let label_end = chars[bracket_start + 1..]
        .iter()
        .position(|char| *char == ']')?
        + bracket_start
        + 1;
    if chars.get(label_end + 1)? != &'(' {
        return None;
    }
    let target_end = chars[label_end + 2..]
        .iter()
        .position(|char| *char == ')')?
        + label_end
        + 2;

    let label: String = chars[bracket_start + 1..label_end].iter().collect();
    let target: String = chars[label_end + 2..target_end].iter().collect();
    let mut spans = Vec::new();
    if is_image {
        spans.push(Span::styled(
            "image: ".to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }

    if label.trim().is_empty() {
        spans.push(Span::styled(target.clone(), markdown_link_style()));
    } else {
        spans.extend(render_inline_markdown(
            &label,
            base_style
                .fg(Color::Cyan)
                .add_modifier(Modifier::UNDERLINED),
        ));
        spans.push(Span::styled(
            format!(" <{target}>"),
            Style::default().fg(Color::DarkGray),
        ));
    }

    Some((target_end + 1, spans))
}

pub(super) fn render_markdown_heading_line(level: usize, content: &str) -> Line<'static> {
    let mut spans = vec![Span::styled(
        "#".repeat(level),
        markdown_heading_hash_style(level),
    )];
    spans.push(Span::raw(" "));
    spans.push(Span::styled(
        content.to_string(),
        markdown_heading_text_style(level),
    ));
    Line::from(spans)
}

pub(super) fn render_markdown_quote_line(level: usize, content: &str) -> Line<'static> {
    let mut spans = vec![Span::styled(
        format!("{} ", ">".repeat(level)),
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    )];
    spans.extend(render_inline_markdown(
        content,
        Style::default().fg(Color::Rgb(200, 200, 200)),
    ));
    Line::from(spans)
}

pub(super) fn render_markdown_code_block(
    raw_lines: &[&str],
    start: usize,
    info: String,
) -> (usize, Vec<Line<'static>>) {
    let mut lines = Vec::new();
    let mut index = start + 1;

    let mut fence = vec![Span::styled(
        "```".to_string(),
        Style::default().fg(Color::DarkGray),
    )];
    if !info.is_empty() {
        fence.push(Span::styled(
            info,
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ));
    }
    lines.push(Line::from(fence));

    while index < raw_lines.len() {
        let trimmed = raw_lines[index].trim();
        if trimmed.starts_with("```") {
            lines.push(Line::from(Span::styled(
                "```".to_string(),
                Style::default().fg(Color::DarkGray),
            )));
            return (index + 1, lines);
        }

        lines.push(Line::from(Span::styled(
            raw_lines[index].to_string(),
            markdown_code_style(),
        )));
        index += 1;
    }

    (index, lines)
}

pub(super) fn render_markdown_table_block(
    raw_lines: &[&str],
    start: usize,
    max_width: Option<usize>,
) -> Option<(usize, Vec<Line<'static>>)> {
    if start + 1 >= raw_lines.len() {
        return None;
    }

    let header = parse_markdown_table_row(raw_lines[start])?;

    let (n_cols, mut rows, mut index) =
        if let Some(delimiter) = parse_markdown_table_delimiter(raw_lines[start + 1]) {
            if header.len() != delimiter {
                return None;
            }
            (delimiter, Vec::new(), start + 2)
        } else if header.len() >= 2 {
            let second = parse_markdown_table_row_smart(raw_lines[start + 1], header.len())?;
            (header.len(), vec![second], start + 2)
        } else {
            return None;
        };

    while index < raw_lines.len() {
        let Some(row) = parse_markdown_table_row_smart(raw_lines[index], n_cols) else {
            break;
        };
        rows.push(row);
        index += 1;
    }

    let header_style = Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD);
    let body_style = Style::default().fg(Color::White);

    let header_spans: Vec<Vec<Span<'static>>> = header
        .iter()
        .map(|cell| render_inline_markdown(cell, header_style))
        .collect();
    let body_spans: Vec<Vec<Vec<Span<'static>>>> = rows
        .iter()
        .map(|row| {
            row.iter()
                .map(|cell| render_inline_markdown(cell, body_style))
                .collect()
        })
        .collect();
    let header_cells: Vec<String> = header_spans
        .iter()
        .map(|spans| inline_plain_text(spans))
        .collect();
    let body_cells: Vec<Vec<String>> = body_spans
        .iter()
        .map(|row| row.iter().map(|spans| inline_plain_text(spans)).collect())
        .collect();

    let mut natural_widths = vec![0usize; n_cols];
    for (idx, cell) in header_cells.iter().enumerate() {
        natural_widths[idx] = natural_widths[idx].max(display_width(cell));
    }
    for row in &body_cells {
        for (idx, cell) in row.iter().enumerate() {
            natural_widths[idx] = natural_widths[idx].max(display_width(cell));
        }
    }

    let final_widths: Vec<usize> = if let Some(mw) = max_width {
        let overhead = 3 * n_cols + 1;
        if mw <= overhead {
            natural_widths.clone()
        } else {
            let available = mw - overhead;
            let sum_natural: usize = natural_widths.iter().sum();
            if sum_natural <= available {
                natural_widths.clone()
            } else {
                constrain_widths(&natural_widths, available)
            }
        }
    } else {
        natural_widths.clone()
    };

    let mut lines = Vec::new();
    lines.push(render_table_border(&final_widths, '┌', '┬', '┐'));

    if final_widths == natural_widths {
        lines.push(render_table_row_styled(
            &header_spans,
            &final_widths,
            header_style,
        ));
    } else {
        let header_wrapped: Vec<Vec<String>> = header_cells
            .iter()
            .zip(final_widths.iter())
            .map(|(cell, &w)| wrap_soft_line(cell, w.max(3)))
            .collect();
        lines.extend(render_table_row_multiline(
            &header_wrapped,
            &final_widths,
            header_style,
        ));
    }
    lines.push(render_table_border(&final_widths, '├', '┼', '┤'));

    if final_widths == natural_widths {
        for row in &body_spans {
            lines.push(render_table_row_styled(row, &final_widths, body_style));
        }
    } else {
        for row in &body_cells {
            let cells_wrapped: Vec<Vec<String>> = row
                .iter()
                .zip(final_widths.iter())
                .map(|(cell, &col_width)| wrap_soft_line(cell, col_width.max(3)))
                .collect();
            lines.extend(render_table_row_multiline(
                &cells_wrapped,
                &final_widths,
                body_style,
            ));
        }
    }
    lines.push(render_table_border(&final_widths, '└', '┴', '┘'));

    Some((index, lines))
}

/// Distribute `available` content width across `n` columns proportionally
/// to their natural widths, with a minimum of 3 chars per column.
pub(super) fn constrain_widths(natural: &[usize], available: usize) -> Vec<usize> {
    let n = natural.len();
    let min_width = 3usize;
    let baseline: usize = n * min_width;
    if available <= baseline {
        return vec![min_width; n];
    }
    let remaining = available - baseline;
    let sum_natural: usize = natural.iter().sum();
    // Allocate proportional shares
    let mut widths: Vec<usize> = natural
        .iter()
        .map(|&nat| {
            if nat <= min_width {
                min_width
            } else {
                // Proportional allocation of remaining beyond baseline
                let extra = ((nat - min_width) as f64 / sum_natural.max(1) as f64
                    * remaining as f64)
                    .round() as usize;
                (min_width + extra).min(nat) // cap at natural width
            }
        })
        .collect();
    // Redistribute any remaining pixels one-by-one to columns that haven't reached their natural width
    let mut used: usize = widths.iter().sum();
    while used < available {
        let mut assigned = false;
        for i in 0..n {
            if widths[i] < natural[i] {
                widths[i] += 1;
                used += 1;
                assigned = true;
                if used >= available {
                    break;
                }
            }
        }
        if !assigned {
            break;
        }
    }
    widths
}

pub(super) fn render_table_row_multiline(
    cells_wrapped: &[Vec<String>],
    widths: &[usize],
    cell_style: Style,
) -> Vec<Line<'static>> {
    let max_lines = cells_wrapped.iter().map(|c| c.len()).max().unwrap_or(1);
    let mut result = Vec::new();
    for line_idx in 0..max_lines {
        let cells_for_line: Vec<String> = cells_wrapped
            .iter()
            .map(|cw| {
                if line_idx < cw.len() {
                    cw[line_idx].clone()
                } else {
                    String::new()
                }
            })
            .collect();
        result.push(render_table_row(&cells_for_line, widths, cell_style));
    }
    result
}

pub(super) fn parse_markdown_table_row(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return None;
    }

    let mut cells = Vec::new();
    let mut current = String::new();
    let mut found_separator = false;
    let mut escaped = false;
    let mut in_code = false;

    for char in trimmed.chars() {
        if escaped {
            current.push('\\');
            current.push(char);
            escaped = false;
            continue;
        }

        if char == '\\' {
            escaped = true;
            continue;
        }

        if char == '`' {
            in_code = !in_code;
            current.push(char);
            continue;
        }

        if char == '|' && !in_code {
            found_separator = true;
            cells.push(current.trim().to_string());
            current.clear();
            continue;
        }

        current.push(char);
    }

    if escaped {
        current.push('\\');
    }

    if !found_separator {
        return None;
    }

    cells.push(current.trim().to_string());

    if trimmed.starts_with('|') {
        cells.remove(0);
    }
    if has_unescaped_trailing_pipe(trimmed) {
        cells.pop();
    }

    (!cells.is_empty()).then_some(cells)
}

pub(super) fn has_unescaped_trailing_pipe(text: &str) -> bool {
    if !text.ends_with('|') {
        return false;
    }

    let backslashes = text[..text.len() - 1]
        .chars()
        .rev()
        .take_while(|char| *char == '\\')
        .count();
    backslashes % 2 == 0
}

/// Smart table row parser that handles pipe characters (`|`) in cell content.
///
/// When a row has *more* columns than `expected`, it looks for "delimiter-like"
/// cells (whose non-whitespace characters are only `-` and `:`, e.g. `---`,
/// `:---:`) and merges each run of them with their immediate left and right
/// non-delimiter neighbours, joining with `|` to reconstruct the original cell
/// text that was split apart by the naive parser.
///
/// Returns `Some(cells)` if the row can be parsed to exactly `expected` columns,
/// either directly or after merging; returns `None` otherwise.
pub(super) fn parse_markdown_table_row_smart(line: &str, expected: usize) -> Option<Vec<String>> {
    let cells = parse_markdown_table_row(line)?;

    if cells.len() == expected {
        return Some(cells);
    }

    // Fewer columns than expected: cannot recover.
    if cells.len() < expected {
        return None;
    }

    // Helper: is a cell delimiter-like?
    let is_delim_like = |cell: &str| -> bool {
        let compact: String = cell.chars().filter(|c| !c.is_whitespace()).collect();
        !compact.is_empty() && compact.chars().all(|c| c == '-' || c == ':')
    };

    // Merge delimiter runs with their neighbours.
    // Strategy: walk left-to-right. When we encounter a delimiter-like cell,
    // consume the entire contiguous run. Pop the preceding cell from `result`
    // (the left neighbour, if any) and check the cell after the run (the right
    // neighbour, if it exists and is non-delimiter). Join these three segments
    // with `|` into one cell.
    let mut result: Vec<String> = Vec::new();
    let mut i = 0;

    while i < cells.len() {
        if is_delim_like(&cells[i]) {
            let run_start = i;
            while i < cells.len() && is_delim_like(&cells[i]) {
                i += 1;
            }
            let run_end = i; // exclusive

            // Left neighbour: the cell immediately before the run.
            let left = result.pop();

            // Right neighbour: the first non-delimiter cell after the run.
            let right = if run_end < cells.len() && !is_delim_like(&cells[run_end]) {
                let right_cell = cells[run_end].clone();
                i = run_end + 1; // consume the right neighbour
                Some(right_cell)
            } else {
                None
            };

            // Reconstruct the original cell by joining with `|`
            let mut parts: Vec<&str> = Vec::new();
            if let Some(ref l) = left {
                parts.push(l.as_str());
            }
            for j in run_start..run_end {
                parts.push(&cells[j]);
            }
            if let Some(ref r) = right {
                parts.push(r.as_str());
            }

            result.push(parts.join("|"));
        } else {
            result.push(cells[i].clone());
            i += 1;
        }
    }

    if result.len() == expected {
        Some(result)
    } else {
        None
    }
}

pub(super) fn parse_markdown_table_delimiter(line: &str) -> Option<usize> {
    let cells = parse_markdown_table_row(line)?;
    let valid = cells.iter().all(|cell| {
        let compact: String = cell.chars().filter(|char| !char.is_whitespace()).collect();
        compact.len() >= 3 && compact.trim_matches(':').chars().all(|char| char == '-')
    });
    valid.then_some(cells.len())
}

pub(super) fn render_table_border(
    widths: &[usize],
    left: char,
    middle: char,
    right: char,
) -> Line<'static> {
    let mut text = String::new();
    text.push(left);
    for (index, width) in widths.iter().enumerate() {
        text.push_str(&"─".repeat(width.saturating_add(2)));
        if index + 1 < widths.len() {
            text.push(middle);
        }
    }
    text.push(right);
    Line::from(Span::styled(text, Style::default().fg(Color::DarkGray)))
}

/// Render a table row where each cell is a collection of pre-styled spans
/// (preserving inline markdown formatting like bold, italic, links, code).
pub(super) fn render_table_row_styled(
    cells: &[Vec<Span<'static>>],
    widths: &[usize],
    cell_base_style: Style,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        "│".to_string(),
        Style::default().fg(Color::DarkGray),
    )];
    for (cell_spans, &width) in cells.iter().zip(widths.iter()) {
        spans.push(Span::raw(" "));
        let plain_len: usize = cell_spans
            .iter()
            .map(|span| display_width(span.content.as_ref()))
            .sum();
        let padding = width.saturating_sub(plain_len);
        // Push each styled span, preserving its original formatting
        for s in cell_spans {
            spans.push(s.clone());
        }
        // Pad the remaining column width with spaces in the base cell style
        if padding > 0 {
            spans.push(Span::styled(" ".repeat(padding), cell_base_style));
        }
        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            "│".to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    Line::from(spans)
}

pub(super) fn render_table_row(
    cells: &[String],
    widths: &[usize],
    cell_style: Style,
) -> Line<'static> {
    let styled_cells: Vec<Vec<Span<'static>>> = cells
        .iter()
        .map(|cell| vec![Span::styled(cell.clone(), cell_style)])
        .collect();
    render_table_row_styled(&styled_cells, widths, cell_style)
}

pub(super) fn push_styled_text(spans: &mut Vec<Span<'static>>, buffer: &mut String, style: Style) {
    if !buffer.is_empty() {
        spans.push(Span::styled(std::mem::take(buffer), style));
    }
}

pub(super) fn find_closing_marker(
    chars: &[char],
    start: usize,
    marker: &[char],
    require_right_flanking: bool,
) -> Option<usize> {
    let width = marker.len();
    let mut index = start;
    while index + width <= chars.len() {
        if chars[index..index + width] == *marker
            && (!require_right_flanking || is_right_flanking(chars, index, width))
        {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Check if a delimiter run at `idx` is left-flanking per CommonMark §6.2.
pub(super) fn is_left_flanking(chars: &[char], idx: usize, run_len: usize) -> bool {
    let after_idx = idx + run_len;
    if after_idx >= chars.len() {
        return false;
    }
    let after = chars[after_idx];
    if after.is_whitespace() {
        return false;
    }
    if !after.is_ascii_punctuation() {
        return true;
    }
    if idx == 0 {
        return true;
    }
    let before = chars[idx - 1];
    before.is_whitespace() || before.is_ascii_punctuation()
}

/// Check if a delimiter run at `idx` is right-flanking per CommonMark §6.2.
pub(super) fn is_right_flanking(chars: &[char], idx: usize, run_len: usize) -> bool {
    if idx == 0 {
        return false;
    }
    let before = chars[idx - 1];
    if before.is_whitespace() {
        return false;
    }
    if !before.is_ascii_punctuation() {
        return true;
    }
    let after_idx = idx + run_len;
    if after_idx >= chars.len() {
        return true;
    }
    let after = chars[after_idx];
    after.is_whitespace() || after.is_ascii_punctuation()
}

pub(super) fn inline_plain_text(spans: &[Span<'static>]) -> String {
    spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<Vec<_>>()
        .join("")
}

pub(super) fn display_width(text: &str) -> usize {
    Span::raw(text.to_string()).width()
}

pub(super) fn markdown_heading_hash_style(level: usize) -> Style {
    let color = match level {
        1 | 2 => Color::Blue,
        3 | 4 => Color::DarkGray,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

pub(super) fn markdown_heading_text_style(level: usize) -> Style {
    match level {
        1 => Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        2 => Style::default()
            .fg(Color::LightBlue)
            .add_modifier(Modifier::BOLD),
        3 => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(Color::White)
            .add_modifier(Modifier::BOLD),
    }
}

pub(super) fn markdown_code_style() -> Style {
    Style::default().fg(Color::Yellow)
}

pub(super) fn markdown_link_style() -> Style {
    Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::UNDERLINED)
}

pub(super) fn split_preserving_empty(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    text.split('\n').map(|line| line.to_string()).collect()
}
