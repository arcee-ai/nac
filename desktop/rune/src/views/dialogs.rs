//! The dialog that confirms a rename or a delete (`App::prompt`), over the whole window.

use rune::{El, col, row, spacer, text};
use rune_kit::Dialog;

use super::{Pill, field, pill};
use crate::manage::Prompt;
use crate::state::{self, App};
use crate::theme::Look;

pub fn overlays(s: &App, l: &Look) -> Vec<El> {
    let mut layer = Vec::new();
    let Some(prompt) = &s.prompt else { return layer };
    let session = |id: &String| s.sessions.iter().find(|m| m.summary.session_id == *id).map(state::title).unwrap_or_default();
    let (title, description, action) = match prompt {
        Prompt::RenameSession(_) => ("Rename session", None, "Rename"),
        Prompt::RenameProject(_) => ("Rename project", None, "Rename"),
        Prompt::DeleteSession(id) => ("Delete session?", Some(format!("“{}”, its transcript and its subagents are deleted. This cannot be undone.", session(id))), "Delete"),
        Prompt::DeleteProject(id) => {
            let name = s.project_name_of(Some(id));
            ("Delete project?", Some(format!("“{name}” is removed from NAC. Its sessions stay, under Other sessions, and its folder is not touched.")), "Delete")
        }
    };
    let rename = description.is_none();
    let ready = !rename || !s.rename.text.trim().is_empty();
    let mut confirm = pill(action, None, Pill::Primary, 32.0, l).opacity(if ready { 1.0 } else { 0.4 }).disabled(!ready).on_press(|s: &mut App| s.confirm_prompt()).key("confirm");
    // Return renames; a delete takes a click.
    confirm = if rename { confirm.default_button() } else { confirm.fill(l.destructive) };
    let mut body = col().w_full().px(16.0).pb(16.0).gap(16.0);
    // The kit's own dialog description is one line, so what a delete removes wraps here.
    body = match description {
        Some(description) => body.child(text(description).key("consequence").font(l.k.ty.ui.lh(20.0)).color(l.k.c.text_muted).wrap()),
        None => body.child(field("rename", &s.rename, "Name", |s| &mut s.rename, l)),
    };
    body = body.child(row().w_full().gap(8.0).child(spacer()).child(pill("Cancel", None, Pill::Outline, 32.0, l).on_press(|s: &mut App| s.prompt = None).key("cancel")).child(confirm));
    Dialog::new("prompt", title).width(420.0).fit().open(true).on_close(|s: &mut App| s.prompt = None).child(body).build(&l.k, &mut layer);
    layer
}
