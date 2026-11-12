//! What the agent is waiting on the user for: permission requests and questions, as cards at
//! the end of the transcript.

use rune::{El, auto_grow, col, icon, row, spacer, text, text_input};

use super::{Pill, mono, pill};
use crate::api::PermissionRequest;
use crate::controls::ANSWER_LIMIT;
use crate::icons;
use crate::state::{App, OpenSession};
use crate::theme::Look;

fn card(key: String, label: &str, l: &Look) -> El {
    col().key(key).role("group").label(label.to_owned()).w_full().padding(14.0).gap(12.0).radius(l.k.radius.xl).border(1.0, l.attention.alpha(0.55)).fill(l.attention.alpha(0.06))
}

/// A pending permission request: what the agent wants to do, with Deny, Approve and, when the
/// server can remember the approval, Always allow.
pub fn permission(request: &PermissionRequest, o: &OpenSession, l: &Look) -> El {
    let c = &l.k.c;
    let mut what = col().grow(1.0).shrink().gap(4.0).child(
        row()
            .gap(6.0)
            .child(text("Permission needed").font(l.k.ty.ui_medium).color(c.text_base))
            .child(text(request.tool.clone()).font(mono(12.5)).color(c.text_muted)),
    );
    // A subagent's request is answered here; say whose it is.
    if let Some(child) = o.children.iter().find(|k| k.child_session_id == request.session_id) {
        what = what.child(text(format!("Subagent: {}", child.description)).key("asker").font(l.k.ty.small).color(c.text_muted).truncate());
    }
    // One write outside the project carries the same path as two resources; show it once.
    let unique = request.resources.iter().enumerate().filter(|(i, r)| !r.display.is_empty() && !request.resources[..*i].iter().any(|e| e.display == r.display));
    for (_, resource) in unique.take(6) {
        what = what.child(text(resource.display.clone()).font(mono(12.0)).color(c.text_muted).wrap_anywhere().selectable(true));
    }
    let reply = |label: &str, kind, reply: &'static str| {
        let id = request.id.clone();
        pill(label, None, kind, 32.0, l).on_press(move |s: &mut App| s.reply_permission(&id, reply))
    };
    let mut buttons = row().w_full().gap(8.0).justify_end().child(reply("Deny", Pill::Outline, "reject").key("deny"));
    if request.resources.iter().any(|r| r.save_resource.is_some()) {
        buttons = buttons.child(reply("Always allow", Pill::Outline, "always").key("always"));
    }
    card(format!("permission-{}", request.id), "Permission request", l)
        .child(row().w_full().gap(10.0).items_start().child(icon(&icons::SHIELD, 16.0).color(l.attention).mt(2.0)).child(what))
        .child(buttons.child(reply("Approve", Pill::Primary, "once").key("approve")))
}

/// The oldest pending question, with its suggested answers and the answer field. Later ones
/// wait their turn: one answer field, one question.
pub fn question(s: &App, o: &OpenSession, l: &Look) -> Option<El> {
    let c = &l.k.c;
    let request = &o.questions.first()?.request;
    let title = if request.responder_class == "human_decision" { "Your decision is needed" } else { "Information is needed" };
    let words = col()
        .grow(1.0)
        .shrink()
        .gap(4.0)
        .child(text(title).font(l.k.ty.ui_medium).color(c.text_base))
        .child(text(request.text.clone()).key("question-text").font(l.k.ty.body).color(c.text_base).wrap().selectable(true));
    let mut e = card("question".to_owned(), "Question from the agent", l).child(row().w_full().gap(10.0).items_start().child(icon(&icons::ALERT, 16.0).color(l.attention).mt(2.0)).child(words));
    if !request.choices.is_empty() {
        let choice = |(i, words): (usize, &String)| {
            let picked = words.clone();
            l.k.interactive(row().role("button").label(words.clone()).focusable(true))
                .key(format!("choice-{i}"))
                .shrink()
                .min_h(30.0)
                .px(12.0)
                .py(5.0)
                .center_y()
                .radius(15.0)
                .fill(l.page)
                .border(1.0, l.input)
                .on_press(move |s: &mut App| s.answer.replace_text(picked.clone()))
                .child(text(words.clone()).font(l.k.ty.ui).color(c.text_base).wrap().a11y_hidden())
        };
        e = e.child(row().key("choices").label("Suggested answers").w_full().flex_wrap().gap(8.0).children(request.choices.iter().enumerate().map(choice)));
    }
    let field = text_input(&s.answer, l.k.ty.body)
        .key("answer-input")
        .label("Your answer")
        .w_full()
        .color(c.text_base)
        .placeholder("Your answer", c.text_faint)
        .caret(c.text_base, l.k.selection())
        .on_edit(rune::edit_access(|s: &mut App| &mut s.answer))
        .on_submit(|s: &mut App, _| s.answer_question());
    e = e.child(col().key("answer").w_full().px(12.0).py(8.0).radius(l.k.radius.md).fill(l.page).border(1.0, l.input).focus_within_ring(2.0, 0.0, c.text_faint.alpha(0.5)).child(auto_grow(field, 1, 6)));

    let length = s.answer.text.chars().count();
    let ready = !s.answer.text.trim().is_empty() && length <= ANSWER_LIMIT;
    let note = if length > ANSWER_LIMIT {
        text(format!("{length} of {ANSWER_LIMIT} characters")).color(l.destructive)
    } else if o.questions.len() > 1 {
        text(format!("{} more waiting", o.questions.len() - 1)).color(c.text_muted)
    } else {
        text("This answers this question only.").color(c.text_muted)
    };
    Some(
        e.child(
            row()
                .w_full()
                .gap(8.0)
                .center_y()
                .child(note.key("question-note").font(l.k.ty.small).shrink())
                .child(spacer())
                .child(pill("Cancel question", None, Pill::Outline, 32.0, l).on_press(|s: &mut App| s.cancel_question()).key("cancel-question"))
                .child(pill("Send answer", None, Pill::Primary, 32.0, l).opacity(if ready { 1.0 } else { 0.4 }).disabled(!ready).on_press(|s: &mut App| s.answer_question()).key("send-answer")),
        ),
    )
}
