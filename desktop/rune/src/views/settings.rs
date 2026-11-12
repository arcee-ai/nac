//! Settings: the appearance, how new sessions ask for permission, and which server this window
//! talks to.

use rune::{El, ScrollSpec, col, row, spacer, text};
use rune_kit::Switch;

use super::{Pill, Screen, mono, pill};
use crate::state::{App, Conn};
use crate::theme::Look;

pub fn screen(s: &App, l: &Look) -> Screen {
    let c = &l.k.c;
    let lead = text("Settings").role("heading").level(1).font(l.k.ty.ui_medium).color(c.text_base);
    let line = |title: &str, value: El, rule: bool| {
        let r = row().w_full().min_h(52.0).px(16.0).py(10.0).gap(16.0).center_y().child(text(title.to_owned()).font(l.k.ty.ui_medium).color(c.text_base)).child(spacer()).child(value);
        if rule { r.border_sides([0.0, 0.0, 1.0, 0.0], l.border) } else { r }
    };
    let value = |words: String| text(words).font(mono(12.5)).color(c.text_muted).selectable(true);
    let choice = |label: &str, theme: Option<bool>| {
        let kind = if s.theme == theme { Pill::Primary } else { Pill::Outline };
        pill(label, None, kind, 30.0, l).on_press(move |s: &mut App| s.set_theme(theme)).key(format!("theme-{label}"))
    };
    let appearance = row().gap(6.0).child(choice("System", None)).child(choice("Light", Some(false))).child(choice("Dark", Some(true)));
    let connection = match &s.conn {
        Conn::Starting => "Starting".to_owned(),
        Conn::Ready => "Connected".to_owned(),
        Conn::Failed(why) => format!("Failed: {why}"),
        Conn::Offline => "Not connected".to_owned(),
    };
    let card = |rows: Vec<El>| col().w_full().radius(l.k.radius.xl).border(1.0, l.border).fill(l.card).clip_rounded(l.k.radius.xl).children(rows);
    let server = if s.server.is_empty() { "None".to_owned() } else { s.server.clone() };
    let version = if s.version.is_empty() { "Unknown".to_owned() } else { s.version.clone() };
    let page = col()
        .key("settings")
        .w_full()
        .max_w(720.0)
        .px(32.0)
        .pt(32.0)
        .pb(40.0)
        .gap(24.0)
        .child(col().w_full().gap(10.0).child(text("Appearance").font(l.k.ty.ui_medium).color(c.text_base)).child(card(vec![line("Theme", appearance, false)])))
        .child(
            col()
                .w_full()
                .gap(10.0)
                .child(text("Permissions").font(l.k.ty.ui_medium).color(c.text_base))
                .child(card(vec![
                    row()
                        .key("full-access")
                        .w_full()
                        .px(16.0)
                        .py(12.0)
                        .gap(16.0)
                        .center_y()
                        .child(
                            col()
                                .grow(1.0)
                                .shrink()
                                .gap(2.0)
                                .child(text("Full access for new sessions").font(l.k.ty.ui_medium).color(c.text_base))
                                .child(
                                    text("The agent runs commands and edits files without asking. Rules that deny an action still apply. Each session can change this from its composer.")
                                        .font(l.k.ty.small)
                                        .color(c.text_muted)
                                        .wrap(),
                                ),
                        )
                        .child(Switch::new(s.full_access).label("Full access for new sessions").hide_label().on_toggle(|s: &mut App| s.set_full_access(!s.full_access)).build(&l.k).key("full-access-switch")),
                ])),
        )
        .child(col().w_full().gap(10.0).child(text("Server").font(l.k.ty.ui_medium).color(c.text_base)).child(card(vec![
            line("Address", value(server), true),
            line("Version", value(version), true),
            line("Connection", text(connection).font(l.k.ty.ui).color(c.text_muted).wrap().shrink(), false),
        ])));
    Screen { lead, actions: Vec::new(), body: col().w_full().items_center().scroll(ScrollSpec { stick_bottom: false }).child(page) }
}
