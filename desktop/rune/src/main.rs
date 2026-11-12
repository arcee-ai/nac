//! NAC's native desktop client, drawn with Rune. It has no webview: the window is laid out and
//! painted in Rust, and everything it shows comes from a `nac-web` server over HTTP and
//! server-sent events.
//!
//! `nac-desktop --server URL` attaches to a running server. Without it the app starts its own
//! `nac-web` (`--nac-web PATH`, `--directory DIR`, `--store-path PATH`) and stops it on quit.
//! Rune's own flags (`--snap`, `--tree`, `--scene`, `--list-scenes`, `--script`) render headless.

mod api;
mod controls;
mod engine;
mod fixtures;
mod icons;
mod manage;
mod state;
mod stream;
mod theme;
mod transcript;
mod views;

use std::path::PathBuf;
use std::time::Duration;

use rune::{AppSpec, Chrome, KeyEvent, PopupAnchor, Tx};
use rune_kit::shell;

use crate::api::Client;
use crate::state::{App, Conn};

/// Geist and Geist Mono (SIL Open Font License 1.1, `assets/fonts/OFL.txt`).
static FONTS: &[&[u8]] = &[include_bytes!("../assets/fonts/Geist[wght].ttf"), include_bytes!("../assets/fonts/GeistMono[wght].ttf")];

struct Args {
    engine: engine::Options,
    /// Headless only: the session to open, so a snapshot can show a real transcript.
    session: Option<String>,
}

/// The app's own flags, which Rune leaves in `extra_args`: `--flag VALUE` or `--flag=VALUE`.
fn args() -> Args {
    let mut out = Args { engine: engine::Options::default(), session: None };
    let mut rest = rune::extra_args().iter();
    while let Some(arg) = rest.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) => (flag, Some(value.to_owned())),
            None => (arg.as_str(), None),
        };
        let mut value = || inline.clone().or_else(|| rest.next().cloned());
        match flag {
            "--server" => out.engine.server = value(),
            "--nac-web" => out.engine.nac_web = value().map(PathBuf::from),
            "--directory" => out.engine.directory = value().map(PathBuf::from),
            "--store-path" => out.engine.store_path = value().map(PathBuf::from),
            "--session" => out.session = value(),
            _ => {}
        }
    }
    out
}

/// A headless run against `--server` (or a child named by `--nac-web`): there is no event loop to
/// deliver answers to, so every request runs before it returns (`App::spawn`) and the lists (and
/// `--session`'s transcript) are in place before the first frame.
fn load_now(s: &mut App, args: &Args) {
    let started = engine::start(&args.engine).and_then(|url| Client::new(&url).ready().map(|ready| (url, ready.version)));
    let (url, version) = match started {
        Ok(found) => found,
        Err(why) => return s.conn = Conn::Failed(why),
    };
    s.connected(&url, version);
    if let Some(id) = &args.session {
        s.open_session(id);
    }
    // `on_quit` does not run headless, so a child started here is stopped here and asked nothing
    // more. An attached server is not touched and stays reachable for a `--script`.
    engine::stop();
    if args.engine.server.is_none() {
        s.client = None;
    }
}

fn on_key(s: &mut App, ev: &KeyEvent, tx: &mut Tx) -> bool {
    if shell::is_sidebar_toggle(ev) {
        s.sidebar.toggle();
    } else if ev.is_command('k') {
        s.toggle_search();
    } else if ev.is_command('n') {
        // With the sidebar closed its button is gone, so the menu opens under the title bar.
        let anchor: PopupAnchor = if s.sidebar.is_open() { "new-session".into() } else { (16.0, 52.0).into() };
        s.new_session(None, anchor, tx);
    } else {
        return false;
    }
    true
}

fn main() {
    let args = args();
    let spec = AppSpec {
        min_size: Some((760.0, 480.0)),
        scenes: fixtures::SCENES,
        fonts: FONTS,
        families: ("Geist", "Geist Mono"),
        on_key: Some(on_key),
        ..AppSpec::new("NAC", (1280.0, 800.0), || App::new(None), views::root)
    };
    // The traffic lights centred on the sidebar's 48 point title band.
    let chrome = Chrome { full_size_content: true, traffic_lights: Some((16.0, 17.0)), drag_regions: true };
    let app = rune::App::new(spec).chrome(chrome);
    let handle = app.handle();
    app.init(move || {
        if rune::is_headless() {
            // Fixture scenes and snapshots: no threads, and no requests or child unless
            // `--server` or `--nac-web` asks for a server.
            let mut s = App::new(None);
            if args.engine.server.is_some() || args.engine.nac_web.is_some() {
                load_now(&mut s, &args);
            }
            return s;
        }
        let mut s = App::new(Some(handle.clone()));
        s.conn = Conn::Starting;
        let (connect, options) = (handle.clone(), args.engine);
        std::thread::spawn(move || {
            let started = engine::start(&options).and_then(|url| Client::new(&url).ready().map(|ready| (url, ready.version)));
            connect.update(move |s, _| match started {
                Ok((url, version)) => s.connected(&url, version),
                Err(why) => s.conn = Conn::Failed(why),
            });
        });
        // Relative times, elapsed timers and the lists' refresh.
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                handle.update_if(|s, _| s.tick());
            }
        });
        s
    })
    .on_quit(|_, _| engine::stop())
    .run();
}
