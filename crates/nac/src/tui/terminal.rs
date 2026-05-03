use super::*;

pub(super) fn enable_keyboard_enhancements(terminal: &mut UiTerminal) -> bool {
    let supports = supports_keyboard_enhancement().unwrap_or(false);
    if !supports {
        return false;
    }

    crossterm::execute!(
        terminal.backend_mut(),
        PushKeyboardEnhancementFlags(
            KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
        )
    )
    .is_ok()
}

pub(super) fn enable_bracketed_paste(terminal: &mut UiTerminal) -> bool {
    crossterm::execute!(terminal.backend_mut(), EnableBracketedPaste).is_ok()
}

pub(super) fn enable_mouse_capture(terminal: &mut UiTerminal) -> bool {
    crossterm::execute!(terminal.backend_mut(), EnableMouseCapture).is_ok()
}

pub(super) fn spawn_input_thread(
    running: Arc<AtomicBool>,
    input_tx: mpsc::UnboundedSender<CrosstermEvent>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while running.load(AtomicOrdering::SeqCst) {
            match event::poll(Duration::from_millis(100)) {
                Ok(true) => match event::read() {
                    Ok(event) => {
                        if input_tx.send(event).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                },
                Ok(false) => {}
                Err(_) => break,
            }
        }
    })
}

pub(super) async fn persist_session_snapshot(
    snapshot: &mut SessionSnapshot,
    agent: &Agent,
) -> Result<()> {
    let refreshed = sessions::refresh_snapshot(snapshot, agent.messages.clone());
    let snapshot_for_blocking = refreshed.clone();
    tokio::task::spawn_blocking(move || sessions::save_session(&snapshot_for_blocking)).await??;
    *snapshot = refreshed;
    Ok(())
}

pub(super) fn contains_point(area: Rect, column: u16, row: u16) -> bool {
    column >= area.x && column < area.right() && row >= area.y && row < area.bottom()
}

pub(super) fn copy_text_to_clipboard(
    clipboard: &mut arboard::Clipboard,
    text: &str,
) -> io::Result<()> {
    clipboard
        .set_text(text)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))
}
