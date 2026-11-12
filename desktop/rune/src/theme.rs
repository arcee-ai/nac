//! dogfood's look as a rune-kit theme. The tokens are the light and dark sets of dogfood's web
//! client (`index.css`): neutral grays in oklch, amber for "needs attention", red for
//! destructive, a 14 point radius, Geist and Geist Mono.

use rune::{Color, TextStyle, oklch, oklcha};
use rune_kit::{Kit, MarkdownStyle, PaletteSeed};

/// The header band's height (`h-14`).
pub const HEADER: f32 = 56.0;
/// The widest the transcript and composer get (`--chat-width: 60rem`).
pub const CHAT_WIDTH: f32 = 960.0;
/// Sidebar rows and the buttons beside them.
pub const ROW: f32 = 34.0;

pub struct Look {
    pub dark: bool,
    /// The general kit: dogfood's colours, type and radii.
    pub k: Kit,
    /// The same with fully rounded rows, for `SidebarRow`.
    pub rows: Kit,
    /// The same with a square, unbordered main pane, for `SplitView`.
    pub shell: Kit,
    pub page: Color,
    pub card: Color,
    /// `--muted`: user bubbles and quiet fills.
    pub muted: Color,
    /// `--subtle`: an open tool row.
    pub subtle: Color,
    pub border: Color,
    pub input: Color,
    pub primary: Color,
    pub primary_fg: Color,
    pub attention: Color,
    pub destructive: Color,
}

fn gray(l: f32) -> Color {
    oklch(l, 0.0, 0.0)
}

impl Look {
    pub fn new(dark: bool) -> Look {
        let (page, fg) = if dark { (gray(0.135), gray(0.955)) } else { (gray(1.0), gray(0.145)) };
        let (card, muted, subtle) = if dark { (gray(0.16), gray(0.225), gray(0.17)) } else { (gray(1.0), gray(0.965), gray(0.98)) };
        let (muted_fg, faint_fg) = if dark { (gray(0.66), gray(0.52)) } else { (gray(0.54), gray(0.66)) };
        let (border, input) = if dark { (oklcha(1.0, 0.0, 0.0, 0.08), oklcha(1.0, 0.0, 0.0, 0.12)) } else { (gray(0.915), gray(0.9)) };
        let (sidebar, sidebar_accent) = if dark { (gray(0.15), gray(0.205)) } else { (gray(0.982), gray(0.94)) };
        let (primary, primary_fg) = if dark { (gray(0.93), gray(0.18)) } else { (gray(0.2), gray(0.985)) };
        let attention = if dark { oklch(0.8, 0.12, 75.0) } else { oklch(0.67, 0.14, 65.0) };
        let destructive = if dark { oklch(0.68, 0.17, 24.0) } else { oklch(0.58, 0.2, 27.0) };

        let mut k = Kit::from_palette(PaletteSeed { bg: page, fg, accent: primary });
        let c = &mut k.c;
        (c.page, c.bg_base, c.bg_deep) = (page, page, sidebar);
        (c.text_base, c.text_strong, c.text_muted, c.text_weak, c.text_faint) = (fg, fg, muted_fg, muted_fg, faint_fg);
        (c.icon_base, c.icon_muted, c.icon_faint, c.std_text) = (fg, muted_fg, faint_fg, muted_fg);
        (c.border_muted, c.border_base, c.border_weak, c.border_strong) = (border, border, border, input);
        // A selected sidebar row is `--sidebar-accent`; hover is a lighter wash of the ink.
        c.hover = fg.alpha(if dark { 0.06 } else { 0.045 });
        c.pressed = sidebar_accent;
        c.layer_01 = subtle;
        (c.warning.icon, c.warning.fg) = (attention, attention);
        (c.danger.icon, c.danger.fg) = (destructive, destructive);
        k.radius.xs = 6.0;
        k.radius.sm = 10.0;
        k.radius.md = 12.0;
        k.radius.lg = 14.0;
        k.radius.xl = 18.0;
        let ui = TextStyle::new(14.0, 400.0).lh(20.0);
        k.ty.ui = ui;
        k.ty.ui_medium = TextStyle { weight: 500.0, ..ui };
        k.ty.ui_compact = ui.lh(18.0);
        k.ty.small = TextStyle::new(12.0, 400.0).lh(16.0);
        k.ty.small_medium = TextStyle::new(12.0, 500.0).lh(16.0);
        k.ty.body = TextStyle::new(14.0, 400.0).lh(22.4);
        k.ty.body_medium = TextStyle::new(14.0, 500.0).lh(22.4);
        k.ty.mono = TextStyle::new(12.5, 400.0).mono().lh(20.0);

        let mut rows = k.clone();
        rows.radius.md = ROW / 2.0;
        let mut shell = k.clone();
        shell.radius.lg = 0.0;
        shell.c.border_muted = Color::WHITE.alpha(0.0);
        Look { dark, k, rows, shell, page, card, muted, subtle, border, input, primary, primary_fg, attention, destructive }
    }

    /// The assistant's Markdown: `--chat-text` 14 on a 1.6 line, code at 12.5.
    pub fn markdown(&self) -> MarkdownStyle {
        let k = &self.k;
        MarkdownStyle::from_kit(k)
            .body_font(k.ty.body)
            .code_block_font(k.ty.mono)
            .code_block(self.subtle, self.border)
            .inline_code_bg(self.muted)
            .rule(self.border)
    }

    pub fn title(&self) -> TextStyle {
        TextStyle::new(26.0, 600.0).lh(32.0)
    }

    /// Section labels in the sidebar: small capitals, tracked out.
    pub fn eyebrow(&self) -> TextStyle {
        TextStyle { tracking: 0.4, ..TextStyle::new(11.0, 500.0).lh(16.0) }
    }
}
