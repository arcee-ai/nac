//! Open a URL in the user's default browser (device-login and CLI helpers).

use std::io::IsTerminal;
use std::process::Command;

/// Whether an interactive CLI should open a browser by default.
///
/// Skips when stdin is not a TTY or `BROWSER=none` (same convention as
/// create-react-app / Vite).
pub fn should_open_browser() -> bool {
    if std::env::var_os("BROWSER").is_some_and(|value| value == "none") {
        return false;
    }
    std::io::stdin().is_terminal()
}

/// Best-effort open of `url` in the platform default browser.
pub fn open_url(url: &str) {
    let result = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(url).spawn()
        }
        #[cfg(target_os = "windows")]
        {
            // `start` needs an empty window-title argument before the URL.
            // Pass the whole line as one `/c` string so `&` in query strings is
            // not treated as a cmd separator — `Command` only quotes args that
            // contain whitespace, so a bare URL arg gets truncated.
            let command = format!("start \"\" \"{}\"", url.replace('"', ""));
            Command::new("cmd").args(["/c", &command]).spawn()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("xdg-open").arg(url).spawn()
        }
    };
    if let Err(error) = result {
        eprintln!("could not open the browser ({error}); visit {url} manually");
    }
}
