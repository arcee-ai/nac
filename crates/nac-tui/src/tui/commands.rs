use super::*;

pub(super) fn composer_prefix_width() -> usize {
    PROMPT_SEPARATOR.chars().count()
}

pub(super) fn prompt_line(is_first: bool, content: &str, slash_mode: bool) -> Line<'static> {
    let mut spans = Vec::new();
    if is_first {
        let (prefix, color) = if slash_mode {
            (COMMAND_SEPARATOR, Color::Yellow)
        } else {
            (PROMPT_SEPARATOR, Color::Cyan)
        };
        spans.push(Span::styled(
            prefix,
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ));
    } else {
        spans.push(Span::styled(
            CONTINUATION_PREFIX.to_string(),
            Style::default().fg(Color::DarkGray),
        ));
    }
    spans.push(Span::styled(
        content.to_string(),
        Style::default().fg(if slash_mode {
            Color::Yellow
        } else {
            Color::White
        }),
    ));
    Line::from(spans)
}

pub(super) fn normalize_paste(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub(super) fn truncate_episode_preview(content: &str) -> String {
    let mut lines = Vec::new();
    let mut char_count = 0usize;
    let mut truncated = false;

    for (index, line) in content.split('\n').enumerate() {
        if index >= 8 {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let remaining_chars = 700usize.saturating_sub(char_count);
        if line_chars > remaining_chars {
            lines.push(take_chars(line, remaining_chars));
            truncated = true;
            break;
        }

        lines.push(line.to_string());
        char_count = char_count.saturating_add(line_chars);
        if char_count >= 700 {
            truncated = true;
            break;
        }
    }

    if lines.is_empty() && !content.is_empty() {
        lines.push(take_chars(content, 700));
        truncated = content.chars().count() > 700;
    }

    if truncated {
        lines.push("… [truncated retained episode preview]".to_string());
    }

    lines.join("\n")
}

pub(super) fn take_chars(text: &str, count: usize) -> String {
    text.chars().take(count).collect()
}
