//! A session: the header with its project and title, the transcript with what the agent is
//! asking at its end, and the composer.

use rune::{El, ScrollSpec, TextStyle, col, icon, row, text};
use rune_kit::{Markdown, Spinner};

use super::{Screen, asks, composer, mono};
use crate::icons;
use crate::state::{self, App, OpenSession};
use crate::stream::Link;
use crate::theme::{CHAT_WIDTH, Look};
use crate::transcript::{Item, Tool, ToolStatus};

/// Lines of a tool's arguments or output shown before the rest is cut.
const DETAIL_LINES: usize = 40;

pub fn screen(s: &App, l: &Look) -> Screen {
    let c = &l.k.c;
    let Some(o) = &s.open else {
        return Screen { lead: text("Session").font(l.k.ty.ui_medium).color(c.text_base), actions: Vec::new(), body: col().w_full() };
    };
    let listed = s.sessions.iter().find(|m| m.summary.session_id == o.id);
    let title = listed.map(state::title).unwrap_or_else(|| "Session".to_owned());
    let project = s.project_name_of(o.project_id.as_deref().or(listed.and_then(|m| m.summary.project_id.as_deref())));
    let lead = row()
        .key("session-title")
        .gap(10.0)
        .center_y()
        .shrink()
        .child(row().gap(6.0).center_y().child(icon(&icons::FOLDER, 14.0).color(c.text_muted)).child(text(project.to_owned()).font(l.k.ty.ui).color(c.text_muted)))
        .child(text("/").font(l.k.ty.ui).color(c.text_faint).a11y_hidden())
        .child(text(title).role("heading").level(1).font(l.k.ty.ui_medium).color(c.text_base).truncate().shrink());
    let mut actions = Vec::new();
    // A subagent's way back to the session that started it.
    if let Some(parent) = listed.and_then(|m| m.lineage.as_ref()).map(|x| x.parent_session_id.clone()).filter(|id| !id.is_empty()) {
        let name = s.sessions.iter().find(|m| m.summary.session_id == parent).map(state::title).unwrap_or_else(|| "Parent session".to_owned());
        actions.push(
            l.k.interactive(row().role("button").label(format!("Open parent session: {name}")).focusable(true))
                .key("parent")
                .h(26.0)
                .px(10.0)
                .gap(6.0)
                .center_y()
                .radius(13.0)
                .max_w(260.0)
                .border(1.0, l.border)
                .on_press(move |s: &mut App| s.open_session(&parent))
                .child(icon(&icons::CHEVRON, 12.0).color(c.text_muted).icon_rotation(std::f32::consts::PI).a11y_hidden())
                .child(text(name).font(l.k.ty.small_medium).color(c.text_base).truncate().shrink().a11y_hidden()),
        );
    }
    if o.link == Link::Reconnecting {
        actions.push(text("Reconnecting…").key("link").font(l.k.ty.small).color(l.attention));
    }
    if o.running {
        let since = o.run_started_ms.map(|ms| state::elapsed(s.now_ms, ms)).unwrap_or_default();
        actions.push(
            row()
                .key("run-state")
                .h(26.0)
                .px(10.0)
                .gap(8.0)
                .center_y()
                .radius(13.0)
                .fill(l.muted)
                .child(Spinner::new().size(12.0).color(c.text_muted).build(&l.k))
                .child(text(format!("Running {since}").trim().to_owned()).font(l.k.ty.small_medium).color(c.text_base)),
        );
    }

    let column = |child: El| col().w_full().items_center().child(child.w_full().max_w(CHAT_WIDTH));
    let transcript = col()
        .key("transcript-scroll")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .scroll(ScrollSpec { stick_bottom: true })
        // Rows land at once: a default fade would overlap a live row with the stored row that replaces it.
        .child(column(col().key("transcript").px(24.0).pt(32.0).pb(40.0).gap(16.0).instant_changes().children(rows(s, o, l))));
    let body = col().key("session").w_full().child(transcript).child(column(composer::composer(s, o, l)));
    Screen { lead, actions, body }
}

/// The transcript's rows, top to bottom: stored items, then what the running turn has shown.
fn rows(s: &App, o: &OpenSession, l: &Look) -> Vec<El> {
    let c = &l.k.c;
    let mut out: Vec<El> = Vec::new();
    let mut steps: Vec<El> = Vec::new();
    // Consecutive tool calls and reasoning share one bordered list.
    fn flush(steps: &mut Vec<El>, out: &mut Vec<El>, l: &Look) {
        if steps.is_empty() {
            return;
        }
        let last = steps.len() - 1;
        let list = col().key(format!("steps-{}", out.len())).w_full().radius(l.k.radius.md).border(1.0, l.border).clip_rounded(l.k.radius.md);
        out.push(list.children(steps.drain(..).enumerate().map(|(i, e)| if i < last { e.border_sides([0.0, 0.0, 1.0, 0.0], l.border) } else { e })));
    }
    for (i, item) in o.items.iter().enumerate() {
        match item {
            Item::User(words) => {
                flush(&mut steps, &mut out, l);
                out.push(bubble(words, i > 0, l).key(format!("user-{i}")));
            }
            Item::Text(words) => {
                flush(&mut steps, &mut out, l);
                out.push(Markdown::new(words.clone()).style(l.markdown()).selectable(true).build(&l.k).key(format!("text-{i}")));
            }
            Item::Reasoning(words) => steps.push(reasoning(&format!("reasoning-{i}"), words, false, o, l)),
            Item::Tool(tool) => steps.push(step(tool, o, l)),
        }
    }
    let waiting = o.pending_user.as_deref().filter(|sent| !matches!(o.items.iter().rev().find(|i| matches!(i, Item::User(_))), Some(Item::User(last)) if last == sent.trim()));
    if let Some(sent) = waiting {
        flush(&mut steps, &mut out, l);
        out.push(bubble(sent, !o.items.is_empty(), l).key("user-pending"));
    }
    if !o.stream_reasoning.trim().is_empty() {
        steps.push(reasoning("reasoning-live", o.stream_reasoning.trim(), o.running, o, l));
    }
    for tool in &o.live_tools {
        steps.push(step(tool, o, l));
    }
    flush(&mut steps, &mut out, l);
    if !o.stream_text.trim().is_empty() {
        out.push(Markdown::new(o.stream_text.clone()).style(l.markdown()).streaming(o.running).build(&l.k).key("text-live"));
    }
    for request in &o.permissions {
        out.push(asks::permission(request, o, l));
    }
    let question = asks::question(s, o, l);
    let asking = !o.permissions.is_empty() || question.is_some();
    out.extend(question);
    if o.running && !asking {
        let since = o.run_started_ms.map(|ms| state::elapsed(s.now_ms, ms)).unwrap_or_default();
        out.push(
            row()
                .key("working")
                .role("status")
                .gap(10.0)
                .center_y()
                .h(24.0)
                .child(Spinner::new().size(14.0).color(c.text_muted).build(&l.k))
                .child(text("Working").font(l.k.ty.ui).color(c.text_muted))
                .child(text(since).font(l.k.ty.small).color(c.text_faint)),
        );
    }
    if let Some((summary, diagnostic)) = &o.failure {
        let mut words = col().grow(1.0).shrink().gap(4.0).child(text(summary.clone()).font(l.k.ty.ui).color(c.text_base).wrap().selectable(true));
        if !diagnostic.is_empty() && diagnostic != summary {
            words = words.child(text(diagnostic.clone()).font(mono(11.5)).color(c.text_muted).wrap().selectable(true));
        }
        out.push(
            row()
                .key("failure")
                .role("alert")
                .w_full()
                .px(14.0)
                .py(10.0)
                .gap(10.0)
                .items_start()
                .radius(l.k.radius.md)
                .border(1.0, l.border)
                .fill(l.subtle)
                .child(icon(&icons::ALERT, 16.0).color(l.destructive).mt(2.0))
                .child(words),
        );
    }
    if let Some(error) = &o.error {
        out.push(text(format!("This session could not be loaded. {error}")).key("load-error").font(l.k.ty.ui).color(l.destructive).wrap());
    }
    if out.is_empty() {
        let state = if o.loading { Spinner::new().size(18.0).color(c.text_muted).build(&l.k) } else { text("No messages yet.").font(l.k.ty.ui).color(c.text_muted) };
        out.push(col().key("transcript-empty").w_full().py(96.0).items_center().child(state));
    }
    out
}

/// A user message: right-aligned, on the muted fill, at most four fifths of the column.
fn bubble(words: &str, turn_gap: bool, l: &Look) -> El {
    let b = col().max_w(CHAT_WIDTH * 0.8).shrink().px(16.0).py(10.0).corners([20.0, 20.0, 6.0, 20.0]).fill(l.muted).child(text(words.to_owned()).font(l.k.ty.body).color(l.k.c.text_base).wrap().selectable(true));
    // `--turn-gap` is 36 where `--item-gap` is 16.
    row().w_full().justify_end().mt(if turn_gap { 20.0 } else { 0.0 }).child(b)
}

/// The head of a collapsed row: an icon, a title, quieter detail, and the chevron.
fn step_head(key: &str, lead: El, title: &str, detail: El, open: bool, l: &Look) -> El {
    let c = &l.k.c;
    let toggled = key.to_owned();
    l.k.interactive(row().role("button").label(title.to_owned()).expanded(open).focusable(true))
        .key("head")
        .w_full()
        .h(36.0)
        .px(14.0)
        .gap(8.0)
        .center_y()
        .on_press(move |s: &mut App| s.toggle_expanded(&toggled))
        .child(lead)
        .child(text(title.to_owned()).font(TextStyle::new(13.0, 400.0).lh(18.0)).color(c.text_base.alpha(0.85)))
        .child(detail.grow(1.0).shrink())
        .child(icon(&icons::CHEVRON, 14.0).color(c.text_faint).icon_rotation(if open { std::f32::consts::FRAC_PI_2 } else { 0.0 }))
}

fn detail_text(words: &str, l: &Look) -> El {
    let mut lines = words.lines();
    let mut shown: Vec<&str> = lines.by_ref().take(DETAIL_LINES).collect();
    let more = lines.count();
    let note = format!("… {more} more lines");
    if more > 0 {
        shown.push(&note);
    }
    text(shown.join("\n")).font(mono(11.5)).color(l.k.c.text_muted).wrap_anywhere().selectable(true)
}

fn step(tool: &Tool, o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let key = format!("tool-{}", tool.call_id);
    let open = o.expanded.contains(&key);
    let lead = match tool.status {
        ToolStatus::Running => row().size(14.0, 14.0).center().child(Spinner::new().size(12.0).color(c.text_muted).build(&l.k)),
        ToolStatus::Failed => icon(&icons::ALERT, 14.0).color(l.destructive),
        ToolStatus::Done => icon(&icons::TOOL, 14.0).color(c.text_muted),
    };
    let target = text(tool.target.clone()).font(mono(12.0)).color(if tool.status == ToolStatus::Failed { l.destructive } else { c.text_muted }).truncate();
    let mut e = col().key(key.clone()).w_full().child(step_head(&key, lead, &tool.name, target, open, l));
    if open {
        let label = |words: &str| text(words.to_owned()).font(l.k.ty.small_medium).color(c.text_faint);
        let mut detail = col().key("detail").w_full().pl(36.0).pr(14.0).pb(12.0).gap(6.0);
        if !tool.args.is_empty() {
            detail = detail.child(label("Arguments")).child(detail_text(&tool.args, l));
        }
        detail = match tool.output.as_deref().filter(|out| !out.is_empty()) {
            Some(out) => detail.child(label("Result")).child(detail_text(out, l)),
            None if tool.status == ToolStatus::Running => detail.child(label("Running…")),
            None => detail.child(label("No output")),
        };
        e = e.fill(l.subtle).child(detail);
    }
    e
}

fn reasoning(key: &str, words: &str, live: bool, o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let open = o.expanded.contains(key);
    let first = words.lines().next().unwrap_or_default().to_owned();
    let preview = text(if open { String::new() } else { first }).font(TextStyle::new(13.0, 400.0).lh(18.0)).color(c.text_muted).truncate();
    let lead = icon(&icons::THOUGHT, 14.0).color(c.text_muted);
    let mut e = col().key(key.to_owned()).w_full().child(step_head(key, lead, if live { "Thinking" } else { "Thought" }, preview, open, l));
    if open {
        e = e.fill(l.subtle).child(col().key("detail").w_full().pl(36.0).pr(14.0).pb(12.0).child(text(words.to_owned()).font(TextStyle::new(13.0, 400.0).lh(21.0)).color(c.text_muted).wrap().selectable(true)));
    }
    e
}
