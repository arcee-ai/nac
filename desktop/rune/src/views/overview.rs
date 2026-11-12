//! Overview: project tiles, the sessions that are running, and the recent ones. With no project
//! yet, the form that creates the first one.

use rune::{El, ScrollSpec, col, icon, row, spacer, text};
use rune_kit::Spinner;

use super::{Pill, Screen, Status, field, heading, pill, status_dot, status_of};
use crate::api::{ManagedSession, Project};
use crate::icons;
use crate::state::{self, App, Conn};
use crate::theme::Look;

pub fn screen(s: &App, l: &Look) -> Screen {
    let c = &l.k.c;
    let lead = text("Overview").role("heading").level(1).font(l.k.ty.ui_medium).color(c.text_base);
    let mut actions = Vec::new();
    if !s.projects.is_empty() {
        actions.push(pill("New session", Some(&icons::PLUS), Pill::Primary, 32.0, l).on_press(|s: &mut App| s.new_session(None, "header-new-session")).key("header-new-session"));
    }
    let content = match &s.conn {
        Conn::Starting => centred(
            col().items_center().gap(12.0).child(Spinner::new().size(18.0).color(c.text_muted).build(&l.k)).child(text("Starting nac-web…").font(l.k.ty.ui).color(c.text_muted)),
        ),
        Conn::Failed(why) => centred(
            col()
                .max_w(560.0)
                .gap(8.0)
                .padding(20.0)
                .radius(l.k.radius.xl)
                .border(1.0, l.border)
                .fill(l.card)
                .child(row().gap(8.0).center_y().child(icon(&icons::ALERT, 16.0).color(l.destructive)).child(text("The server did not start").font(l.k.ty.ui_medium).color(c.text_base)))
                .child(text(why.clone()).font(l.k.ty.ui).color(c.text_muted).wrap().selectable(true)),
        ),
        _ if s.projects.is_empty() && (s.loaded || s.client.is_none()) => centred(start_project(s, l)),
        _ if !s.loaded => centred(Spinner::new().size(18.0).color(c.text_muted).build(&l.k)),
        _ => dashboard(s, l),
    };
    Screen { lead, actions, body: col().key("overview").w_full().scroll(ScrollSpec { stick_bottom: false }).child(content) }
}

fn centred(child: El) -> El {
    col().w_full().min_h(520.0).h_full().center().px(24.0).py(40.0).child(child)
}

/// "Start a project": the name and directory of the first project.
fn start_project(s: &App, l: &Look) -> El {
    let c = &l.k.c;
    let label = |words: &str| text(words.to_owned()).font(l.k.ty.ui_medium).color(c.text_base);
    let ready = !s.project_dir.text.trim().is_empty() && !s.busy && s.client.is_some();
    let create = pill("Create project", Some(&icons::PLUS), Pill::Primary, 36.0, l).opacity(if ready { 1.0 } else { 0.55 }).disabled(!ready).on_press(|s: &mut App| s.create_project()).key("create-project");
    let card = col()
        .key("new-project")
        .w_full()
        .padding(20.0)
        .gap(8.0)
        .radius(20.0)
        .border(1.0, l.border)
        .fill(l.card)
        .shadow(1.0, 3.0, c.text_base.alpha(if l.dark { 0.0 } else { 0.06 }))
        .child(text("New project").font(rune::TextStyle::new(16.0, 600.0).lh(22.0)).color(c.text_base))
        .child(text("A project is a directory on this machine where the agent reads, writes and runs everything.").font(l.k.ty.ui).color(c.text_muted).wrap())
        .child(label("Name").mt(8.0))
        .child(field("project-name", &s.project_name, "my-project", |s| &mut s.project_name, l))
        .child(label("Directory").mt(8.0))
        .child(field("project-dir", &s.project_dir, "/path/to/the/project", |s| &mut s.project_dir, l))
        .child(row().w_full().mt(12.0).child(spacer()).child(create));
    col().w_full().max_w(576.0).gap(24.0).items_center().child(text("Start a project").role("heading").level(1).font(l.title()).color(c.text_base)).child(card)
}

fn dashboard(s: &App, l: &Look) -> El {
    let sessions = s.visible_sessions();
    let running: Vec<&&ManagedSession> = sessions.iter().filter(|m| status_of(s, m) != Status::Idle).collect();
    let recent: Vec<&&ManagedSession> = sessions.iter().filter(|m| status_of(s, m) == Status::Idle).take(30).collect();
    let mut page = col().key("dashboard").w_full().max_w(1152.0).px(32.0).pt(32.0).pb(40.0).gap(36.0);

    let tiles = row().w_full().equal_columns(4).gap(10.0).children(s.projects.iter().map(|p| project_tile(s, p, l)));
    page = page.child(col().key("projects").w_full().gap(12.0).child(heading("Projects", Some(s.projects.len()), l)).child(tiles));
    if !running.is_empty() {
        let cards = row().w_full().equal_columns(3).gap(12.0).children(running.iter().map(|m| running_card(s, m, l)));
        page = page.child(col().key("running").w_full().gap(12.0).child(heading("Running", Some(running.len()), l)).child(cards));
    }
    let list = if recent.is_empty() {
        row().w_full().px(24.0).py(40.0).center().radius(l.k.radius.xl).border(1.0, l.border).border_dash(4.0, 4.0).child(text("No sessions yet").font(l.k.ty.ui).color(l.k.c.text_muted))
    } else {
        let last = recent.len() - 1;
        col().w_full().radius(l.k.radius.xl).border(1.0, l.border).fill(l.card).clip_rounded(l.k.radius.xl).children(recent.iter().enumerate().map(|(i, m)| recent_row(s, m, i < last, l)))
    };
    page = page.child(col().key("recent").w_full().gap(12.0).child(heading("Recent", None, l)).child(list));
    col().w_full().items_center().child(page)
}

fn project_tile(s: &App, p: &Project, l: &Look) -> El {
    let c = &l.k.c;
    let mine: Vec<&ManagedSession> = s.sessions.iter().filter(|m| m.summary.project_id.as_deref() == Some(p.project_id.as_str())).collect();
    let running = mine.iter().filter(|m| m.active_run.is_some()).count();
    let count = match mine.len() {
        0 => "No sessions".to_owned(),
        1 => "1 session".to_owned(),
        n => format!("{n} sessions"),
    };
    let mut top = row().w_full().gap(8.0).center_y().child(icon(&icons::FOLDER, 16.0).color(c.text_muted)).child(text(p.name.clone()).font(l.k.ty.ui_medium).color(c.text_base).truncate().grow(1.0).shrink());
    if running > 0 {
        top = top.child(status_dot(Status::Running, l));
    }
    let id = p.project_id.clone();
    l.k.interactive(col().role("button").label(format!("New session in {}", p.name)).focusable(true))
        .key(format!("tile-{id}"))
        .h(72.0)
        .min_w(0.0)
        .px(14.0)
        .py(12.0)
        .radius(l.k.radius.xl)
        .border(1.0, l.border)
        .fill(l.card)
        .justify_between()
        .on_press(move |s: &mut App| s.new_session(Some(&id), format!("tile-{id}")))
        .child(top)
        .child(
            row()
                .w_full()
                .gap(8.0)
                .child(text(count).font(l.k.ty.small).color(c.text_muted))
                .child(text(p.cwd.clone()).font(l.k.ty.small).color(c.text_faint).truncate_head().grow(1.0).shrink().align(rune::Align::End)),
        )
}

fn place(s: &App, m: &ManagedSession) -> String {
    let model = m.summary.model.rsplit('/').next().unwrap_or_default();
    let project = s.project_name_of(m.summary.project_id.as_deref());
    if model.is_empty() { project.to_owned() } else { format!("{project}  ·  {model}") }
}

fn running_card(s: &App, m: &ManagedSession, l: &Look) -> El {
    let c = &l.k.c;
    let id = m.summary.session_id.clone();
    let status = status_of(s, m);
    let mut state_line = row().w_full().gap(8.0).center_y().child(status_dot(status, l));
    state_line = match status {
        Status::Attention => state_line.child(text("Asking you").font(l.k.ty.small_medium).color(l.attention)),
        _ => {
            let line = state_line.child(text("Running").font(l.k.ty.small_medium).color(c.text_base));
            match m.active_run.as_ref().map(|r| r.started_at_epoch_ms).filter(|ms| *ms > 0) {
                Some(started) => line.child(text(state::elapsed(s.now_ms, started)).font(l.k.ty.small).color(c.text_muted)),
                None => line,
            }
        }
    };
    l.k.interactive(col().role("button").label(state::title(m)).focusable(true))
        .key(format!("running-{id}"))
        .min_w(0.0)
        .min_h(116.0)
        .padding(14.0)
        .gap(8.0)
        .radius(l.k.radius.xl)
        .border(1.0, if status == Status::Attention { l.attention.alpha(0.5) } else { l.border })
        .fill(l.card)
        .on_press(move |s: &mut App| s.open_session(&id))
        .child(state_line)
        .child(text(state::title(m)).font(l.k.ty.ui_medium).color(c.text_base).wrap().max_lines(2))
        .child(spacer())
        .child(text(place(s, m)).font(l.k.ty.small).color(c.text_muted).truncate())
}

fn recent_row(s: &App, m: &ManagedSession, rule: bool, l: &Look) -> El {
    let c = &l.k.c;
    let id = m.summary.session_id.clone();
    let mut r = l
        .k
        .interactive(row().role("button").label(state::title(m)).focusable(true))
        .key(format!("recent-{id}"))
        .w_full()
        .h(52.0)
        .px(16.0)
        .gap(12.0)
        .center_y()
        .on_press(move |s: &mut App| s.open_session(&id))
        .child(status_dot(Status::Idle, l))
        .child(
            col()
                .grow(1.0)
                .shrink()
                .child(text(state::title(m)).font(l.k.ty.ui_medium).color(c.text_base).truncate())
                .child(text(place(s, m)).font(l.k.ty.small).color(c.text_muted).truncate()),
        )
        .child(text(state::relative(s.now_ms, &m.summary.updated_at)).font(l.k.ty.small).color(c.text_muted));
    if rule {
        r = r.border_sides([0.0, 0.0, 1.0, 0.0], l.border);
    }
    r
}
