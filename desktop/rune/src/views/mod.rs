//! The window: `rune_kit::shell`'s `SplitView` with the sidebar and one screen in its main pane,
//! and the small pieces the screens share.

mod overview;
mod session;
mod settings;
mod sidebar;

use rune::{Color, Cx, El, Icon, TextEdit, TextStyle, col, el, icon, row, text, text_input};
use rune_kit::shell::{SidebarToggle, SplitView, TOOLBAR_HEIGHT, Toolbar};
use rune_kit::{ControlSize, Spinner};

use crate::api::ManagedSession;
use crate::icons;
use crate::state::{App, Route};
use crate::theme::{HEADER, Look};

/// One screen of the main pane: what its header band shows, and its body.
pub struct Screen {
    pub lead: El,
    pub actions: Vec<El>,
    pub body: El,
}

pub fn root(s: &App, cx: &mut Cx<App>) -> El {
    let look = Look::new(s.theme.unwrap_or(cx.system_dark()));
    let screen = match &s.route {
        Route::Overview => overview::screen(s, &look),
        Route::Session(_) => session::screen(s, &look),
        Route::Settings => settings::screen(s, &look),
    };
    // The shell's toolbar is 48 points and the header band 56: the band's last 8 points and its
    // hairline are the body's first row, and the toolbar's contents sit 4 points lower to
    // centre in the whole band.
    let drop = HEADER - TOOLBAR_HEIGHT;
    let toolbar = screen.actions.into_iter().fold(Toolbar::new().leading(screen.lead.ml(12.0).mt(drop)), |t, a| t.trailing(a.mt(drop)));
    let mut main = col()
        .key("screen")
        .w_full()
        .h_full()
        .min_h(0.0)
        .child(el().key("header-rule").w_full().h(drop).border_sides([0.0, 0.0, 1.0, 0.0], look.border).window_drag());
    if let Some(notice) = &s.notice {
        main = main.child(banner(notice, &look));
    }
    main = main.child(screen.body.grow(1.0).min_h(0.0));
    // The main pane's leading hairline, over the toolbar too.
    main = main.child(el().key("pane-rule").pin(Some(0.0), Some(-TOOLBAR_HEIGHT), None, Some(0.0)).w(1.0).fill(look.border).a11y_hidden());
    SplitView::new(main)
        .sidebar(&s.sidebar, |s: &mut App| &mut s.sidebar, sidebar::sidebar(s, &look))
        .toolbar(toolbar)
        .titlebar_inset(cx.titlebar_inset())
        .frame_inset(0.0)
        .toolbar_in_panel()
        .sidebar_padding(8.0, 8.0)
        .sidebar_toggle(SidebarToggle::new().size(ControlSize::Large).past_lights(12.0).edge(12.0).gap(4.0).in_header())
        .reduced_motion(cx.is_reduced_motion())
        .build(&look.shell)
}

/// The last failed request, across the top of the body until dismissed.
fn banner(message: &str, l: &Look) -> El {
    let c = &l.k.c;
    row()
        .key("notice")
        .role("alert")
        .w_full()
        .px(24.0)
        .py(10.0)
        .gap(10.0)
        .center_y()
        .fill(l.destructive.alpha(0.07))
        .border_sides([0.0, 0.0, 1.0, 0.0], l.border)
        .child(icon(&icons::ALERT, 16.0).color(l.destructive))
        .child(text(message.to_owned()).font(l.k.ty.ui).color(c.text_base).wrap().grow(1.0).shrink())
        .child(icon_button(&icons::CLOSE, "Dismiss", l).on_press(|s: &mut App| s.notice = None).key("notice-dismiss"))
}

#[derive(Clone, Copy, PartialEq)]
pub enum Status {
    Running,
    Attention,
    Idle,
}

pub fn status_of(s: &App, m: &ManagedSession) -> Status {
    let open = s.open.as_ref().filter(|o| o.id == m.summary.session_id);
    if open.is_some_and(|o| !o.permissions.is_empty()) {
        Status::Attention
    } else if m.active_run.is_some() || open.is_some_and(|o| o.running) {
        Status::Running
    } else {
        Status::Idle
    }
}

/// The mark before a session's title, in a 16 point box.
pub fn status_dot(status: Status, l: &Look) -> El {
    let c = &l.k.c;
    let dot = |size: f32, color: Color| el().size(size, size).radius(size / 2.0).fill(color);
    let mark = match status {
        Status::Running => Spinner::new().size(12.0).color(c.text_muted).build(&l.k),
        Status::Attention => dot(8.0, l.attention).label("Needs attention"),
        Status::Idle => dot(6.0, c.text_faint.alpha(0.55)),
    };
    row().size(16.0, 16.0).center().child(mark)
}

#[derive(Clone, Copy, PartialEq)]
pub enum Pill {
    /// Filled with the ink colour.
    Primary,
    /// A hairline ring on the page colour.
    Outline,
}

/// A fully rounded button. The caller attaches `on_press` and a key.
pub fn pill(label: &str, lead: Option<&'static Icon>, kind: Pill, height: f32, l: &Look) -> El {
    let c = &l.k.c;
    let (fill, ink) = match kind {
        Pill::Primary => (l.primary, l.primary_fg),
        Pill::Outline => (l.page, c.text_base),
    };
    let mut b = row().role("button").label(label.to_owned()).h(height).px(if lead.is_some() { 12.0 } else { 14.0 }).pr(14.0).gap(8.0).center_y().radius(height / 2.0).fill(fill).focusable(true);
    if kind == Pill::Outline {
        b = b.border(1.0, l.input);
    }
    b = if kind == Pill::Primary { l.k.interactive_with(b, l.primary_fg.alpha(0.12), l.primary_fg.alpha(0.2)) } else { l.k.interactive(b) };
    if let Some(i) = lead {
        b = b.child(icon(i, 16.0).color(ink).a11y_hidden());
    }
    b.child(text(label.to_owned()).font(l.k.ty.ui_medium).color(ink).a11y_hidden())
}

/// A round, icon-only ghost button. The caller attaches `on_press` and a key.
pub fn icon_button(i: &'static Icon, label: &str, l: &Look) -> El {
    l.k.interactive(row().role("button").label(label.to_owned()).help(label.to_owned()).size(30.0, 30.0).radius(15.0).center().focusable(true))
        .child(icon(i, 16.0).color(l.k.c.text_muted).a11y_hidden())
}

/// A one-line field in a pill-shaped ring. `access` finds the edit in the app's state.
pub fn field(key: &str, edit: &TextEdit, placeholder: &str, access: fn(&mut App) -> &mut TextEdit, l: &Look) -> El {
    let c = &l.k.c;
    let input = text_input(edit, l.k.ty.ui)
        .single_line()
        .key(format!("{key}-input"))
        .label(placeholder.to_owned())
        .grow(1.0)
        .shrink()
        .color(c.text_base)
        .placeholder(placeholder.to_owned(), c.text_faint)
        .caret(c.text_base, l.k.selection())
        .on_edit(rune::edit_access(access));
    row().key(key.to_owned()).w_full().h(36.0).px(14.0).center_y().radius(18.0).fill(l.page).border(1.0, l.input).focus_within_ring(2.0, 0.0, c.text_faint.alpha(0.5)).child(input)
}

/// A section's heading on a page, with a count beside it.
pub fn heading(title: &str, count: Option<usize>, l: &Look) -> El {
    let c = &l.k.c;
    let mut h = row().w_full().min_h(28.0).gap(8.0).center_y().child(text(title.to_owned()).role("heading").level(2).font(l.k.ty.ui_medium).color(c.text_base));
    if let Some(n) = count {
        h = h.child(text(n.to_string()).font(l.k.ty.small).color(c.text_muted));
    }
    h
}

pub fn mono(size: f32) -> TextStyle {
    TextStyle::new(size, 400.0).mono().lh((size * 1.55).round())
}
