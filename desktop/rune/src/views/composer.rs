//! The foot of a session: its subagents, the messages still waiting for the run, and the
//! composer with the session's model, effort and approval mode.

use std::f32::consts::FRAC_PI_2;

use rune::{Color, El, Icon, ScrollSpec, TextStyle, Tx, auto_grow, col, icon, row, spacer, text, text_input};

use super::{Pill, Status, icon_button, pill, status_dot};
use crate::controls::mode_label;
use crate::icons;
use crate::state::{App, OpenSession};
use crate::theme::Look;

pub fn composer(s: &App, o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let placeholder = match (o.running, o.direct()) {
        (false, _) => "Message the agent",
        (true, true) => "Steer the agent, or queue a message for the next run",
        (true, false) => "Steer the agent",
    };
    let field = text_input(&s.composer, l.k.ty.body)
        .key("composer-input")
        .label("Message")
        .w_full()
        .color(c.text_base)
        .placeholder(placeholder, c.text_faint)
        .caret(c.text_base, l.k.selection())
        .on_edit(rune::edit_access(|s: &mut App| &mut s.composer))
        .on_submit(|s: &mut App, _| s.send(false));
    let round = |fill: Color, ink: Color, glyph: &'static Icon, label: &str| {
        l.k.interactive_with(row().role("button").label(label.to_owned()).help(label.to_owned()).size(30.0, 30.0).radius(15.0).center().fill(fill).focusable(true), ink.alpha(0.12), ink.alpha(0.2))
            .child(icon(glyph, 16.0).color(ink).a11y_hidden())
    };
    let sendable = !s.composer.text.trim().is_empty() && !o.loading;
    let dim = if sendable { 1.0 } else { 0.4 };

    let mut foot = row().w_full().px(8.0).pb(10.0).gap(2.0).center_y();
    if !o.model.is_empty() {
        // The server refuses a configuration change during a run.
        let model = o.model.rsplit('/').next().unwrap_or_default().to_owned();
        foot = foot.child(chip("model", "Model", model, None, !o.running, l).on_press_tx(|s: &mut App, tx: &mut Tx| s.model_menu(tx)));
        let effort = o.effort.clone().unwrap_or_else(|| "default".to_owned());
        foot = foot.child(chip("effort", "Effort", format!("Effort: {effort}"), None, !o.running, l).on_press_tx(|s: &mut App, tx: &mut Tx| s.effort_menu(tx)));
    }
    if o.direct() && !o.approval_mode.is_empty() {
        let full = (o.approval_mode == "auto_approve").then_some(l.attention);
        foot = foot.child(chip("mode", "Approvals", mode_label(&o.approval_mode).to_owned(), full, true, l).on_press_tx(|s: &mut App, tx: &mut Tx| s.mode_menu(tx)));
    }
    foot = foot.child(spacer());
    let mut actions = row().gap(8.0).center_y();
    if o.running {
        if o.direct() {
            actions = actions.child(pill("Queue next", None, Pill::Outline, 30.0, l).opacity(dim).disabled(!sendable).on_press(|s: &mut App| s.send(true)).key("queue"));
        }
        actions = actions.child(round(l.muted, c.text_base, &icons::STOP, "Stop").on_press(|s: &mut App| s.stop_run()).key("stop"));
    }
    let send = round(l.primary, l.primary_fg, &icons::ARROW_UP, if o.running { "Steer" } else { "Send" });
    foot = foot.child(actions.child(send.opacity(dim).disabled(!sendable).on_press(|s: &mut App| s.send(false)).key("send")));

    let shell = col()
        .key("composer")
        .w_full()
        .radius(20.0)
        .border(1.0, l.input)
        .fill(l.card)
        .shadow(1.0, 4.0, c.text_base.alpha(if l.dark { 0.0 } else { 0.05 }))
        .focus_within_ring(2.0, 0.0, c.text_faint.alpha(0.45))
        .child(col().w_full().px(16.0).pt(12.0).pb(4.0).child(auto_grow(field, 1, 8)))
        .child(foot);
    let mut out = col().w_full().px(24.0).pt(4.0).pb(20.0).gap(8.0);
    if !o.children.is_empty() {
        out = out.child(subagents(o, l));
    }
    if !o.inbox.is_empty() {
        out = out.child(waiting(o, l));
    }
    out.child(shell)
}

/// A quiet button in the composer's foot that opens a menu. `ink` marks a value worth noticing.
fn chip(key: &str, what: &str, value: String, ink: Option<Color>, enabled: bool, l: &Look) -> El {
    let c = &l.k.c;
    // The effort chip already names itself in its text.
    let label = if value.starts_with(what) { value.clone() } else { format!("{what}: {value}") };
    let mut b = l.k.interactive(row().role("button").label(label).help(what.to_owned()).focusable(true)).key(key.to_owned()).h(26.0).px(8.0).gap(4.0).center_y().radius(13.0).min_w(0.0).shrink();
    if ink.is_some() {
        b = b.child(icon(&icons::SHIELD, 13.0).color(l.attention).a11y_hidden());
    }
    b.opacity(if enabled { 1.0 } else { 0.5 })
        .disabled(!enabled)
        .child(text(value).font(TextStyle::new(11.5, 400.0).lh(16.0)).color(ink.unwrap_or(c.text_muted)).truncate().shrink().a11y_hidden())
        .child(icon(&icons::CHEVRON, 11.0).color(c.text_faint).icon_rotation(FRAC_PI_2).a11y_hidden())
}

fn panel(key: &str, label: &str, l: &Look) -> El {
    col().key(key.to_owned()).role("group").label(label.to_owned()).w_full().radius(l.k.radius.md).border(1.0, l.border).fill(l.card).clip_rounded(l.k.radius.md)
}

/// The subagents this session started: a count, and when open one row each that opens it.
fn subagents(o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let open = o.expanded.contains("subagents");
    let running = o.children.iter().filter(|k| k.status == "running").count();
    let count = if running > 0 { format!("{} · {running} running", o.children.len()) } else { o.children.len().to_string() };
    let head = l
        .k
        .interactive(row().role("button").label("Subagents").expanded(open).focusable(true))
        .key("subagents-head")
        .w_full()
        .h(34.0)
        .px(12.0)
        .gap(8.0)
        .center_y()
        .on_press(|s: &mut App| s.toggle_expanded("subagents"))
        .child(text("Subagents").font(l.k.ty.small_medium).color(c.text_base))
        .child(text(count).font(l.k.ty.small).color(c.text_muted))
        .child(spacer())
        .child(icon(&icons::CHEVRON, 14.0).color(c.text_faint).icon_rotation(if open { FRAC_PI_2 } else { 0.0 }));
    let mut e = panel("subagents", "Subagents", l).child(head);
    if open {
        let one = |k: &crate::api::Child| {
            let id = k.child_session_id.clone();
            let status = if k.status == "running" { Status::Running } else { Status::Idle };
            let title = if k.description.trim().is_empty() { k.profile.clone() } else { k.description.clone() };
            l.k.interactive(row().role("button").label(format!("Open subagent: {title}")).focusable(true))
                .key(format!("child-{id}"))
                .w_full()
                .h(34.0)
                .px(12.0)
                .gap(8.0)
                .center_y()
                .border_sides([1.0, 0.0, 0.0, 0.0], l.border)
                .on_press(move |s: &mut App| s.open_session(&id))
                .child(status_dot(status, l))
                .child(text(title).font(l.k.ty.ui).color(c.text_base).truncate().grow(1.0).shrink())
                .child(text(k.profile.clone()).font(l.k.ty.small).color(c.text_faint))
                .child(text(k.status.clone()).font(l.k.ty.small).color(if k.status == "failed" { l.destructive } else { c.text_muted }))
        };
        // Six rows show; a longer list scrolls.
        e = e.child(col().key("subagents-list").w_full().max_h(204.0).scroll(ScrollSpec { stick_bottom: false }).children(o.children.iter().map(one)));
    }
    e
}

/// The messages sent during the run and not delivered yet: each can change between steering
/// this run and waiting for the next, or be withdrawn.
fn waiting(o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let one = |(i, item): (usize, &crate::api::InboxItem)| {
        let id = item.id;
        let (when, other) = if item.delivery == "queue" { ("Next run", "Steer this run with it instead") } else { ("This run", "Hold it for the next run instead") };
        let delivery = l
            .k
            .interactive(row().role("button").label(format!("{when}. {other}")).help(other).focusable(true))
            .key("delivery")
            .h(22.0)
            .px(8.0)
            .center_y()
            .radius(11.0)
            .fill(l.muted)
            .on_press(move |s: &mut App| s.toggle_inbox(id))
            .child(text(when).font(l.k.ty.small_medium).color(c.text_base).a11y_hidden());
        let line = item.prompt.trim().lines().next().unwrap_or_default().to_owned();
        row()
            .key(format!("waiting-{id}"))
            .w_full()
            .h(36.0)
            .pl(8.0)
            .pr(6.0)
            .gap(8.0)
            .center_y()
            .border_sides([if i > 0 { 1.0 } else { 0.0 }, 0.0, 0.0, 0.0], l.border)
            .child(delivery)
            .child(text(line).font(l.k.ty.ui).color(c.text_base).truncate().grow(1.0).shrink())
            .child(icon_button(&icons::CLOSE, "Withdraw this message", l).size(24.0, 24.0).on_press(move |s: &mut App| s.cancel_inbox(id)).key("withdraw"))
    };
    panel("waiting", "Messages waiting for the run", l).children(o.inbox.iter().enumerate().map(one))
}
