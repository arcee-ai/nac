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
            Command::new("cmd").args(["/c", "start", "", url]).spawn()
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
