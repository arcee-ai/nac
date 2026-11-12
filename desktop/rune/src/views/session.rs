//! A session: the header with its project and title, the transcript, pending permission
//! requests, and the composer.

use rune::{El, ScrollSpec, TextStyle, auto_grow, col, icon, row, spacer, text, text_input};
use rune_kit::{Markdown, Spinner};

use super::{Pill, Screen, mono, pill};
use crate::api::PermissionRequest;
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
    let body = col().key("session").w_full().child(transcript).child(column(composer(s, o, l)));
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
        out.push(permission(request, l));
    }
    if o.running && o.permissions.is_empty() {
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

/// A pending permission request: what the agent wants to do, with Deny and Approve.
fn permission(request: &PermissionRequest, l: &Look) -> El {
    let c = &l.k.c;
    let (approve, deny) = (request.id.clone(), request.id.clone());
    let mut what = col().grow(1.0).shrink().gap(4.0).child(
        row()
            .gap(6.0)
            .child(text("Permission needed").font(l.k.ty.ui_medium).color(c.text_base))
            .child(text(request.tool.clone()).font(mono(12.5)).color(c.text_muted)),
    );
    // One write outside the project carries the same path as two resources; show it once.
    let unique = request.resources.iter().enumerate().filter(|(i, r)| !r.display.is_empty() && !request.resources[..*i].iter().any(|e| e.display == r.display));
    for (_, resource) in unique.take(6) {
        what = what.child(text(resource.display.clone()).font(mono(12.0)).color(c.text_muted).wrap_anywhere().selectable(true));
    }
    col()
        .key(format!("permission-{}", request.id))
        .role("group")
        .label("Permission request")
        .w_full()
        .padding(14.0)
        .gap(12.0)
        .radius(l.k.radius.xl)
        .border(1.0, l.attention.alpha(0.55))
        .fill(l.attention.alpha(0.06))
        .child(row().w_full().gap(10.0).items_start().child(icon(&icons::SHIELD, 16.0).color(l.attention).mt(2.0)).child(what))
        .child(
            row()
                .w_full()
                .gap(8.0)
                .justify_end()
                .child(pill("Deny", None, Pill::Outline, 32.0, l).on_press(move |s: &mut App| s.reply_permission(&deny, false)).key("deny"))
                .child(pill("Approve", None, Pill::Primary, 32.0, l).on_press(move |s: &mut App| s.reply_permission(&approve, true)).key("approve")),
        )
}

fn composer(s: &App, o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let field = text_input(&s.composer, l.k.ty.body)
        .key("composer-input")
        .label("Message")
        .w_full()
        .color(c.text_base)
        .placeholder(if o.running { "Working… Stop the run to send another message" } else { "Message the agent" }, c.text_faint)
        .caret(c.text_base, l.k.selection())
        .on_edit(rune::edit_access(|s: &mut App| &mut s.composer))
        .on_submit(|s: &mut App, _| s.send());
    let round = |fill, ink, glyph, label: &str| {
        l.k.interactive_with(row().role("button").label(label.to_owned()).size(30.0, 30.0).radius(15.0).center().fill(fill).focusable(true), l.primary_fg.alpha(0.12), l.primary_fg.alpha(0.2))
            .child(icon(glyph, 16.0).color(ink).a11y_hidden())
    };
    let action = if o.running {
        round(l.primary, l.primary_fg, &icons::STOP, "Stop").on_press(|s: &mut App| s.stop_run()).key("stop")
    } else {
        let sendable = !s.composer.text.trim().is_empty() && !o.loading;
        round(l.primary, l.primary_fg, &icons::ARROW_UP, "Send").opacity(if sendable { 1.0 } else { 0.4 }).disabled(!sendable).on_press(|s: &mut App| s.send()).key("send")
    };
    let hint = if o.model.is_empty() { String::new() } else { o.model.rsplit('/').next().unwrap_or_default().to_owned() };
    let shell = col()
        .key("composer")
        .w_full()
        .radius(20.0)
        .border(1.0, l.input)
        .fill(l.card)
        .shadow(1.0, 4.0, c.text_base.alpha(if l.dark { 0.0 } else { 0.05 }))
        .focus_within_ring(2.0, 0.0, c.text_faint.alpha(0.45))
        .child(col().w_full().px(16.0).pt(12.0).pb(4.0).child(auto_grow(field, 1, 8)))
        .child(row().w_full().px(10.0).pb(10.0).pl(16.0).gap(8.0).center_y().child(text(hint).font(TextStyle::new(11.5, 400.0).lh(16.0)).color(c.text_muted).truncate().shrink()).child(spacer()).child(action));
    col().w_full().px(24.0).pt(4.0).pb(20.0).child(shell)
}
