//! The sidebar: New session, Search, Overview, the projects with their sessions, and the
//! footer with Settings and the light/dark toggle.

use rune::{El, PointerPress, TextCase, TextStyle, Tx, col, row, spacer, text};
use rune_kit::shell::{Sidebar, SidebarRow};

use super::{Pill, field, icon_button, pill, status_dot, status_of};
use crate::api::ManagedSession;
use crate::icons;
use crate::manage::Prompt;
use crate::state::{self, App, Route};
use crate::theme::{Look, ROW};

/// The shortcut chip on the Search row.
const SEARCH_KEYS: &str = if cfg!(target_os = "macos") { "⌘K" } else { "Ctrl K" };

fn session_row(s: &App, m: &ManagedSession, l: &Look) -> El {
    let id = m.summary.session_id.clone();
    let selected = matches!(&s.route, Route::Session(open) if *open == id);
    SidebarRow::new(state::title(m))
        .depth(1)
        .height(32.0)
        .title_style(TextStyle::new(13.5, 400.0).lh(20.0))
        .avatar(status_dot(status_of(s, m), l))
        .detail(state::relative(s.now_ms, &m.summary.updated_at))
        .selected(selected)
        .on_select({
            let id = id.clone();
            move |s: &mut App, _| s.open_session(&id)
        })
        .build(&l.rows)
        .on_secondary_press({
            let id = id.clone();
            move |s: &mut App, at: PointerPress, tx: &mut Tx| s.row_menu(Prompt::RenameSession(id.clone()), Prompt::DeleteSession(id.clone()), at, tx)
        })
        .key(format!("session-{id}"))
}

pub fn sidebar(s: &App, l: &Look) -> El {
    let c = &l.k.c;
    let new = pill("New session", Some(&icons::PLUS), Pill::Outline, ROW, l).w_full().on_press_tx(|s: &mut App, tx: &mut Tx| s.new_session(None, "new-session", tx)).key("new-session");
    let search = SidebarRow::new("Search")
        .icon(&icons::SEARCH)
        .detail(SEARCH_KEYS)
        .height(ROW)
        .selected(s.search_open)
        .on_select(|s: &mut App, _| s.toggle_search())
        .build(&l.rows)
        .key("search");
    let overview = SidebarRow::new("Overview")
        .icon(&icons::GRID)
        .height(ROW)
        .selected(s.route == Route::Overview)
        .on_select(|s: &mut App, _| s.go_overview())
        .build(&l.rows)
        .key("overview");
    let mut sb = Sidebar::new().label("Navigation").inset(0.0).header_gap(2.0).header_padding(0.0, 14.0).row_gap(2.0).header(new.mb(6.0)).header(search);
    if s.search_open {
        sb = sb.header(field("search-field", &s.search, "Search sessions", |s| &mut s.search, l).my(4.0));
    }
    sb = sb.header(overview);

    let label = |title: &str| row().w_full().h(28.0).px(12.0).center_y().child(text(title.to_owned()).font(l.eyebrow()).text_case(TextCase::Uppercase).color(c.text_muted));
    let note = |words: &str| row().w_full().px(12.0).py(6.0).child(text(words.to_owned()).font(l.k.ty.small).color(c.text_muted).wrap());
    let add_project = icon_button(&icons::PLUS, "Add project", l).size(24.0, 24.0).on_press_tx(|s: &mut App, tx: &mut Tx| s.add_project(tx)).key("add-project");
    sb = sb.child(label("Projects").pr(4.0).child(spacer()).child(add_project).key("projects-label"));
    let sessions = s.visible_sessions();
    let searching = s.search_open && !s.search.text.trim().is_empty();
    if s.projects.is_empty() {
        sb = sb.child(note(if s.loaded || s.client.is_none() { "No projects yet." } else { "Loading…" }).key("projects-empty"));
    }
    for p in &s.projects {
        let mine: Vec<&&ManagedSession> = sessions.iter().filter(|m| m.summary.project_id.as_deref() == Some(p.project_id.as_str())).collect();
        if searching && mine.is_empty() {
            continue;
        }
        let closed = s.collapsed.contains(&p.project_id);
        let id = p.project_id.clone();
        let add = icon_button(&icons::PLUS, "New session in this project", l).size(24.0, 24.0).on_press_tx({
            let id = id.clone();
            move |s: &mut App, tx: &mut Tx| s.new_session(Some(&id), format!("add-{id}"), tx)
        });
        sb = sb.child(
            SidebarRow::new(p.name.clone())
                .icon(&icons::FOLDER)
                .height(ROW)
                .title_style(l.k.ty.ui_medium)
                .trailing(add.key(format!("add-{id}")))
                .on_select({
                    let id = id.clone();
                    move |s: &mut App, _| s.toggle_project(&id)
                })
                .build(&l.rows)
                .expanded(!closed)
                .on_secondary_press({
                    let id = id.clone();
                    move |s: &mut App, at: PointerPress, tx: &mut Tx| s.row_menu(Prompt::RenameProject(id.clone()), Prompt::DeleteProject(id.clone()), at, tx)
                })
                .key(format!("project-{id}")),
        );
        if closed {
            continue;
        }
        if mine.is_empty() {
            sb = sb.child(note("No sessions yet.").pl(38.0).key(format!("project-{id}-empty")));
        }
        for m in mine {
            sb = sb.child(session_row(s, m, l));
        }
    }
    // Sessions whose project is gone, or that never had one.
    let loose: Vec<&&ManagedSession> = sessions.iter().filter(|m| !m.summary.project_id.as_ref().is_some_and(|id| s.projects.iter().any(|p| p.project_id == *id))).collect();
    if !loose.is_empty() {
        sb = sb.child(label("Other sessions").mt(8.0).key("loose-label"));
        for m in loose {
            sb = sb.child(session_row(s, m, l));
        }
    }

    let dark = l.dark;
    let footer = row()
        .key("footer")
        .w_full()
        .h(36.0)
        .pl(10.0)
        .gap(2.0)
        .center_y()
        .child(col().child(text("nac").font(TextStyle { tracking: -0.3, ..TextStyle::new(16.0, 600.0).lh(20.0) }).color(c.text_base)))
        .child(spacer())
        .child(icon_button(&icons::GEAR, "Settings", l).on_press(|s: &mut App| s.route = Route::Settings).key("settings"))
        .child(
            icon_button(if dark { &icons::SUN } else { &icons::MOON }, if dark { "Use the light theme" } else { "Use the dark theme" }, l)
                .on_press(move |s: &mut App| s.set_theme(Some(!dark)))
                .key("theme-toggle"),
        );
    sb.footer(footer).build(&l.rows)
}
