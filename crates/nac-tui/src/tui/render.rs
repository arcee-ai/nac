use super::*;

pub(super) fn render_lines_panel(
    frame: &mut ratatui::Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
) {
    render_lines_panel_with_title(frame, area, panel_title(title), lines);
}

pub(super) fn render_lines_panel_with_title(
    frame: &mut ratatui::Frame,
    area: Rect,
    title: Line<'static>,
    lines: Vec<Line<'static>>,
) {
    let block = panel_block_with_title(title);
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.width == 0 || inner.height == 0 {
        return;
    }
    frame.render_widget(Clear, inner);
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}
pub(super) fn render_event_line(entry: &TimelineEntry, width: usize) -> Line<'static> {
    let (action, detail) = entry
        .detail
        .split_once(" • ")
        .map(|(action, detail)| (action.to_string(), detail.to_string()))
        .unwrap_or_else(|| (entry.detail.clone(), String::new()));

    let timestamp = fit_text(&entry.timestamp, 8);
    let actor = fit_text(&entry.actor, (width / 5).clamp(8, 16));
    let action = fit_text(&action, (width / 4).clamp(10, 20));

    let action_style = match entry.tone {
        Tone::Muted => Style::default()
            .fg(Color::Gray)
            .add_modifier(Modifier::BOLD),
        _ => Style::default()
            .fg(entry.tone.color())
            .add_modifier(Modifier::BOLD),
    };

    let prefix_width = timestamp.chars().count()
        + tone_glyph(entry.tone).chars().count()
        + actor.chars().count()
        + action.chars().count()
        + 10;
    let detail_width = width.saturating_sub(prefix_width);

    let mut spans = vec![
        Span::styled(timestamp, Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled(
            tone_glyph(entry.tone),
            Style::default().fg(entry.tone.color()),
        ),
        Span::raw(" "),
        Span::styled(
            actor,
            Style::default()
                .fg(actor_color(&entry.actor, entry.tone))
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" • ", Style::default().fg(Color::DarkGray)),
        Span::styled(action, action_style),
    ];

    if detail_width > 0 && !detail.is_empty() {
        spans.push(Span::styled(" • ", Style::default().fg(Color::DarkGray)));
        spans.push(Span::styled(
            fit_text(&detail, detail_width),
            Style::default().fg(Color::DarkGray),
        ));
    }

    Line::from(spans)
}

pub(super) fn render_file_change_line(file: &ChangedFileStat, width: usize) -> Line<'static> {
    let status_width = 1usize;
    let delta_width = 5usize;
    let path_width = width.saturating_sub(status_width + delta_width * 2 + 3);
    let additions = file
        .additions
        .map(|value| format!("+{value}"))
        .unwrap_or_else(|| "+-".to_string());
    let deletions = file
        .deletions
        .map(|value| format!("-{value}"))
        .unwrap_or_else(|| "--".to_string());

    Line::from(vec![
        Span::styled(file.status.clone(), file_status_style(&file.status)),
        Span::raw(" "),
        Span::styled(
            format!("{additions:>width$}", width = delta_width),
            Style::default().fg(Color::Green),
        ),
        Span::raw(" "),
        Span::styled(
            format!("{deletions:>width$}", width = delta_width),
            Style::default().fg(Color::Red),
        ),
        Span::raw(" "),
        Span::styled(
            compact_path(&file.path, path_width),
            Style::default().fg(Color::Gray),
        ),
    ])
}

pub(super) fn render_workset_header_line(workset: &WorksetSnapshot, width: usize) -> Line<'static> {
    let marker = "▣ ";
    let status_width = 10usize;
    let unit_count = format!("{:02}", workset.items.len());
    let fixed_width = marker.chars().count() + status_width + 1 + unit_count.chars().count() + 2;
    let id_width = width.saturating_sub(fixed_width).max(1);
    Line::from(vec![
        Span::styled(marker, Style::default().fg(Color::DarkGray)),
        Span::styled(
            pad_cell(&workset.status.to_ascii_uppercase(), status_width),
            workset_status_style(&workset.status),
        ),
        Span::raw(" "),
        Span::styled(unit_count, Style::default().fg(Color::Magenta)),
        Span::styled("u", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled(
            fit_text(&workset.id, id_width),
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
    ])
}

pub(super) fn workset_separator_line(width: usize) -> Line<'static> {
    Line::from(Span::styled(
        "─".repeat(width.min(72)),
        Style::default().fg(Color::DarkGray),
    ))
}

pub(super) fn render_workset_item_lines(
    item: &WorksetItemSnapshot,
    width: usize,
) -> Vec<Line<'static>> {
    let position_label = if item.position < 100 {
        format!("{:02}", item.position)
    } else {
        item.position.to_string()
    };
    let position_width = position_label.chars().count();
    let role_width = 12usize;
    let prefix_width = 2 + position_width + 1 + role_width + 1;
    let title_width = width.saturating_sub(prefix_width).max(1);
    let title_style = Style::default()
        .fg(Color::White)
        .add_modifier(Modifier::BOLD);
    let title_parts = wrapped_text_segments(&item.title, title_width);
    let mut lines = Vec::with_capacity(title_parts.len().max(1));
    for (index, part) in title_parts.into_iter().enumerate() {
        if index == 0 {
            lines.push(Line::from(vec![
                Span::styled("  ", Style::default().fg(Color::DarkGray)),
                Span::styled(position_label.clone(), Style::default().fg(Color::DarkGray)),
                Span::raw(" "),
                Span::styled(
                    pad_cell(
                        &fit_text(&item.role.to_ascii_uppercase(), role_width),
                        role_width,
                    ),
                    Style::default().fg(Color::Cyan),
                ),
                Span::raw(" "),
                Span::styled(part, title_style),
            ]));
        } else {
            lines.push(Line::from(vec![
                Span::styled(
                    " ".repeat(prefix_width),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(part, title_style),
            ]));
        }
    }

    if !item.scope.is_empty() {
        push_workset_labeled_lines(
            &mut lines,
            "      ",
            "SCOPE",
            &item.scope,
            width,
            Style::default().fg(Color::DarkGray),
            Style::default().fg(Color::DarkGray),
        );
    }

    if !item.depends_on.is_empty() {
        push_workset_labeled_lines(
            &mut lines,
            "      ",
            "DEPS",
            &item.depends_on.join(", "),
            width,
            Style::default().fg(Color::Yellow),
            Style::default().fg(Color::DarkGray),
        );
    }

    if !item.acceptance.is_empty() {
        push_workset_labeled_lines(
            &mut lines,
            "      ",
            "PASS",
            &item.acceptance,
            width,
            Style::default().fg(Color::Green),
            Style::default().fg(Color::DarkGray),
        );
    }

    if let Some(notes) = item.notes.as_deref().filter(|notes| !notes.is_empty()) {
        push_workset_labeled_lines(
            &mut lines,
            "      ",
            "NOTE",
            notes,
            width,
            Style::default().fg(Color::DarkGray),
            Style::default().fg(Color::DarkGray),
        );
    }

    lines
}

pub(super) fn push_workset_labeled_lines(
    lines: &mut Vec<Line<'static>>,
    indent: &str,
    label: &str,
    text: &str,
    width: usize,
    label_style: Style,
    text_style: Style,
) {
    push_wrapped_prefixed_lines(
        lines,
        &format!("{}{:<6} ", indent, fit_text(label, 6)),
        text,
        width,
        label_style,
        text_style,
    );
}

pub(super) fn push_wrapped_prefixed_lines(
    lines: &mut Vec<Line<'static>>,
    prefix: &str,
    text: &str,
    width: usize,
    prefix_style: Style,
    text_style: Style,
) {
    let prefix_width = prefix.chars().count();
    let text_width = width.saturating_sub(prefix_width);
    if text_width == 0 {
        lines.push(Line::from(Span::styled(
            fit_text(prefix, width),
            prefix_style,
        )));
        return;
    }

    for (index, part) in wrapped_text_segments(text, text_width)
        .into_iter()
        .enumerate()
    {
        let line_prefix = if index == 0 {
            prefix.to_string()
        } else {
            " ".repeat(prefix_width)
        };
        lines.push(Line::from(vec![
            Span::styled(line_prefix, prefix_style),
            Span::styled(part, text_style),
        ]));
    }
}

pub(super) fn wrapped_text_segments(text: &str, width: usize) -> Vec<String> {
    wrap_soft_line(&one_line(text), width)
        .into_iter()
        .map(|part| part.trim_end().to_string())
        .collect()
}

pub(super) fn panel_block(title: &str) -> Block<'static> {
    panel_block_with_title(panel_title(title))
}

pub(super) fn panel_block_with_title(title: Line<'static>) -> Block<'static> {
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::DarkGray))
}

pub(super) fn panel_title(title: &str) -> Line<'static> {
    panel_title_segments(vec![Span::styled(
        title.to_string(),
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )])
}

pub(super) fn panel_title_segments(segments: Vec<Span<'static>>) -> Line<'static> {
    let mut spans = Vec::with_capacity(segments.len() + 2);
    let border_style = Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD);
    spans.push(Span::styled(" [ ", border_style));
    spans.extend(segments);
    spans.push(Span::styled(" ] ", border_style));
    Line::from(spans)
}

pub(super) fn header_line(columns: &[(&str, usize)], width: usize) -> Line<'static> {
    let mut content = String::new();
    for (index, (label, column_width)) in columns.iter().enumerate() {
        if index > 0 {
            content.push_str(" ");
        }
        content.push_str(&pad_cell(label, *column_width));
    }
    Line::from(Span::styled(
        fit_text(&content, width),
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    ))
}

pub(super) fn render_wrapped_row(
    row: &WrappedRow,
    selection: Option<(SelectionPoint, SelectionPoint)>,
) -> Line<'static> {
    let selected_style = Style::default()
        .fg(Color::Black)
        .bg(Color::Cyan)
        .add_modifier(Modifier::BOLD);

    let Some((start, end)) = selection else {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    };
    let Some((selection_start, selection_end)) = selection_overlap_for_row(row, &start, &end)
    else {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    };

    if row.text.is_empty() || selection_start == selection_end {
        if row.spans.is_empty() {
            return Line::from("");
        }
        return Line::from(
            row.spans
                .iter()
                .map(|segment| Span::styled(segment.text.clone(), segment.style))
                .collect::<Vec<_>>(),
        );
    }

    let mut spans = Vec::new();
    let mut offset = 0usize;
    for segment in &row.spans {
        let segment_len = segment.text.chars().count();
        let segment_start = offset;
        let segment_end = offset + segment_len;
        let overlap_start = selection_start.max(segment_start);
        let overlap_end = selection_end.min(segment_end);

        if overlap_start >= overlap_end {
            if !segment.text.is_empty() {
                spans.push(Span::styled(segment.text.clone(), segment.style));
            }
            offset = segment_end;
            continue;
        }

        let before_len = overlap_start.saturating_sub(segment_start);
        let selected_len = overlap_end.saturating_sub(overlap_start);
        let after_len = segment_end.saturating_sub(overlap_end);

        if before_len > 0 {
            spans.push(Span::styled(
                take_chars(&segment.text, before_len),
                segment.style,
            ));
        }
        if selected_len > 0 {
            let selected_text: String = segment
                .text
                .chars()
                .skip(before_len)
                .take(selected_len)
                .collect();
            spans.push(Span::styled(selected_text, selected_style));
        }
        if after_len > 0 {
            let after_text: String = segment
                .text
                .chars()
                .skip(before_len + selected_len)
                .take(after_len)
                .collect();
            spans.push(Span::styled(after_text, segment.style));
        }
        offset = segment_end;
    }
    if spans.is_empty() {
        Line::from("")
    } else {
        Line::from(spans)
    }
}
