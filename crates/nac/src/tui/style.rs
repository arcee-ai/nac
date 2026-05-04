use super::*;

pub(super) fn tone_glyph(tone: Tone) -> &'static str {
    match tone {
        Tone::Info => "•",
        Tone::Success => "+",
        Tone::Warning => "!",
        Tone::Error => "×",
        Tone::Muted => "·",
    }
}

pub(super) fn actor_color(actor: &str, tone: Tone) -> Color {
    if actor == "user" {
        Color::Yellow
    } else if actor == "assistant" {
        Color::Green
    } else if actor == "orchestrator" || actor.starts_with("coder") {
        Color::Cyan
    } else if actor == "model" || actor == "docs" {
        Color::Magenta
    } else if actor == "system" {
        Color::Blue
    } else if actor == "git" {
        Color::Green
    } else if actor.starts_with("tester") {
        Color::Yellow
    } else {
        tone.color()
    }
}

pub(super) fn file_status_style(status: &str) -> Style {
    let color = match status {
        "A" => Color::Green,
        "D" => Color::Red,
        "R" => Color::Magenta,
        "?" => Color::Cyan,
        "M" => Color::Yellow,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}

pub(super) fn workset_status_style(status: &str) -> Style {
    let color = match status {
        "done" | "complete" | "completed" => Color::Green,
        "failed" | "error" => Color::Red,
        "cancelled" | "skipped" => Color::DarkGray,
        "running" | "active" => Color::Green,
        "planned" | "planning" | "awaiting_approval" => Color::Yellow,
        _ => Color::Gray,
    };
    Style::default().fg(color).add_modifier(Modifier::BOLD)
}
