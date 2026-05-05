use super::*;

pub(super) fn classify_tool_status(is_error: bool, preview: &str) -> ToolStatus {
    if is_error {
        return ToolStatus::Error;
    }
    if preview.starts_with("Command timed out after") {
        return ToolStatus::TimedOut;
    }
    if preview.starts_with("Exit code:") {
        return ToolStatus::Failed;
    }
    ToolStatus::Ok
}

pub(super) fn panel_is_selectable(panel: PanelId) -> bool {
    matches!(
        panel,
        PanelId::Prompt
            | PanelId::Response
            | PanelId::PreviousResponse
            | PanelId::Workspace
            | PanelId::CompactStream
    )
}

pub(super) fn line_to_plain_text(line: &Line<'_>) -> String {
    line.spans
        .iter()
        .map(|span| span.content.as_ref())
        .collect::<Vec<_>>()
        .join("")
}

pub(super) fn status_span(label: &str, tone: Tone) -> Span<'static> {
    Span::styled(
        label.to_string(),
        Style::default()
            .fg(tone.color())
            .add_modifier(Modifier::BOLD),
    )
}

pub(super) fn tool_label(thread_name: Option<&str>, tool_name: &str) -> String {
    match thread_name {
        Some(thread_name) => format!("{thread_name}/{tool_name}"),
        None => tool_name.to_string(),
    }
}

pub(super) fn format_duration(duration: Duration) -> String {
    if duration.as_secs() >= 60 {
        let minutes = duration.as_secs() / 60;
        let seconds = duration.as_secs() % 60;
        format!("{minutes}m{seconds:02}s")
    } else if duration.as_secs() > 0 {
        format!("{:.1}s", duration.as_secs_f64())
    } else {
        format!("{}ms", duration.as_millis())
    }
}

pub(super) fn format_runtime(duration: Duration) -> String {
    let total_seconds = duration.as_secs();
    let hours = total_seconds / 3_600;
    let minutes = (total_seconds % 3_600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours:02}h{minutes:02}m{seconds:02}s")
}

pub(super) fn compact_path(path: &str, max_width: usize) -> String {
    if path.chars().count() <= max_width {
        return path.to_string();
    }
    if max_width <= 1 {
        return "…".to_string();
    }
    let suffix_len = max_width.saturating_sub(1);
    let suffix: String = path
        .chars()
        .rev()
        .take(suffix_len)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("…{suffix}")
}

pub(super) fn fit_text(text: &str, max_width: usize) -> String {
    if text.chars().count() <= max_width {
        return text.to_string();
    }
    if max_width == 0 {
        return String::new();
    }
    if max_width == 1 {
        return "…".to_string();
    }
    let mut out = take_chars(text, max_width - 1);
    out.push('…');
    out
}

pub(super) fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn pad_cell(text: &str, width: usize) -> String {
    format!("{:<width$}", fit_text(text, width), width = width)
}

pub(super) fn pad_to(text: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    format!("{text:<width$}")
}

pub(super) fn inner_width(area: Rect) -> usize {
    area.width.saturating_sub(2) as usize
}

pub(super) fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let overlay_width = width.min(area.width);
    let overlay_height = height.min(area.height);
    let x = area.x + area.width.saturating_sub(overlay_width) / 2;
    let y = area.y + area.height.saturating_sub(overlay_height) / 2;
    Rect::new(x, y, overlay_width, overlay_height)
}
