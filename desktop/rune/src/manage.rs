//! Projects and sessions as things to add, rename and delete, and what the app remembers
//! between launches: the theme, Full access, the collapsed projects and the last model.

use std::path::Path;

use rune::prefs::Prefs;
use rune::{FileDialogOptions, PointerPress, PopupItem, PopupMenu, TextEdit, Tx};
use serde::Serialize;

use crate::state::{self, App, menus};

/// The bundle identifier of the README's macOS bundle; the settings file sits in its folder.
const APP_ID: &str = "ai.arcee.nac.rune";

/// A rename or delete waiting in a dialog for its confirmation, with the id it applies to.
#[derive(Clone, Debug, PartialEq)]
pub enum Prompt {
    RenameSession(String),
    DeleteSession(String),
    RenameProject(String),
    DeleteProject(String),
}

/// The saved settings. A headless run (snapshots, scripts) reads and writes none unless it
/// names a directory for them, so a fixture never draws someone's own theme.
pub fn open_prefs() -> Prefs {
    let named = ["RUNE_PREFS_DIR", "RUNE_DIRS_ROOT"].iter().any(|key| std::env::var_os(key).is_some());
    if rune::is_headless() && !named { Prefs::memory() } else { Prefs::open(APP_ID) }
}

fn save<T: Serialize + ?Sized>(prefs: &mut Prefs, notice: &mut Option<String>, key: &str, value: &T) {
    if let Err(e) = prefs.set(key, value) {
        *notice = Some(format!("The setting was not saved. {e}"));
    }
}

impl App {
    pub fn set_theme(&mut self, theme: Option<bool>) {
        self.theme = theme;
        save(&mut self.prefs, &mut self.notice, "theme", &theme);
    }

    /// Whether new sessions start in Full access. Open sessions keep their mode.
    pub fn set_full_access(&mut self, on: bool) {
        self.full_access = on;
        save(&mut self.prefs, &mut self.notice, "full_access", &on);
    }

    /// The model the next New session menu checks.
    pub fn set_model(&mut self, backend: &str, model: &str) {
        self.model = Some((backend.to_owned(), model.to_owned()));
        save(&mut self.prefs, &mut self.notice, "model", &self.model);
    }

    pub fn toggle_project(&mut self, id: &str) {
        if !self.collapsed.remove(id) {
            self.collapsed.insert(id.to_owned());
        }
        save(&mut self.prefs, &mut self.notice, "collapsed", &self.collapsed);
    }

    /// `POST /projects` from the first-project form; a blank name is the directory's.
    pub fn create_project(&mut self) {
        let (name, cwd) = (self.project_name.text.trim().to_owned(), self.project_dir.text.trim().to_owned());
        if !cwd.is_empty() {
            self.create_project_at(name, cwd);
        }
    }

    fn create_project_at(&mut self, mut name: String, cwd: String) {
        if self.busy {
            return;
        }
        if name.is_empty() {
            name = Path::new(&cwd).file_name().map_or_else(|| "project".to_owned(), |n| n.to_string_lossy().into_owned());
        }
        self.busy = true;
        self.spawn(move |c| c.create_project(&name, &cwd), |s, created| {
            s.busy = false;
            match created {
                Ok(_) => {
                    s.project_name.clear();
                    s.project_dir.clear();
                    s.refresh();
                }
                Err(e) => s.notice = Some(format!("The project was not created. {e}")),
            }
        });
    }

    /// The native folder sheet; `chosen` gets the folder picked there.
    fn choose_folder(tx: &mut Tx, title: &str, chosen: fn(&mut App, String)) {
        tx.open_folder(FileDialogOptions { title: title.to_owned(), ..Default::default() }, move |s: &mut App, picked, _| match picked {
            Ok(Some(dir)) => chosen(s, dir.to_string_lossy().into_owned()),
            Ok(None) => {}
            Err(e) => s.notice = Some(format!("The folder sheet did not open. {e}")),
        });
    }

    /// Adds the folder chosen in the folder sheet as a project named after it.
    pub fn add_project(&mut self, tx: &mut Tx) {
        Self::choose_folder(tx, "Add project", |s, dir| s.create_project_at(String::new(), dir));
    }

    /// Fills the first-project form's directory from the folder sheet.
    pub fn choose_dir(&mut self, tx: &mut Tx) {
        Self::choose_folder(tx, "Project directory", |s, dir| s.project_dir.replace_text(dir));
    }

    /// The context menu of a session or project row: Rename and Delete, each confirmed in a dialog.
    pub fn row_menu(&mut self, rename: Prompt, delete: Prompt, at: PointerPress, tx: &mut Tx) {
        if !menus() {
            return self.notice = Some("Menus need macOS or Windows.".to_owned());
        }
        let menu = PopupMenu::new().item(PopupItem::new("rename", "Rename…")).item(PopupItem::new("delete", "Delete…"));
        tx.popup_menu(menu, at, move |s: &mut App, picked, _| match picked {
            Some("rename") => s.ask(rename),
            Some("delete") => s.ask(delete),
            _ => {}
        });
    }

    /// Opens the dialog for `prompt`; a rename starts from the current name.
    pub fn ask(&mut self, prompt: Prompt) {
        let current = match &prompt {
            Prompt::RenameSession(id) => self.sessions.iter().find(|m| m.summary.session_id == *id).map(state::title),
            Prompt::RenameProject(id) => self.projects.iter().find(|p| p.project_id == *id).map(|p| p.name.clone()),
            Prompt::DeleteSession(_) | Prompt::DeleteProject(_) => None,
        };
        self.rename = TextEdit::new(current.unwrap_or_default());
        self.rename.focused = true;
        self.prompt = Some(prompt);
    }

    /// Does what the open dialog asks. A rename to nothing keeps the dialog open.
    pub fn confirm_prompt(&mut self) {
        let Some(prompt) = self.prompt.clone() else { return };
        let name = self.rename.text.trim().to_owned();
        if name.is_empty() && matches!(prompt, Prompt::RenameSession(_) | Prompt::RenameProject(_)) {
            return;
        }
        self.prompt = None;
        match prompt {
            Prompt::RenameSession(id) => {
                // The summary carries the revision the server checks the rename against.
                let Some(summary) = self.sessions.iter().find(|m| m.summary.session_id == id).map(|m| m.summary.clone()) else { return };
                self.spawn(move |c| c.rename_session(&summary, &name), |s, r| s.managed(r, "The session was not renamed."));
            }
            Prompt::DeleteSession(id) => {
                let deleted = id.clone();
                self.spawn(move |c| c.delete_session(&id), move |s, r| {
                    if r.is_ok() && s.open.as_ref().is_some_and(|o| o.id == deleted) {
                        s.go_overview();
                    }
                    s.managed(r, "The session was not deleted.");
                });
            }
            Prompt::RenameProject(id) => self.spawn(move |c| c.rename_project(&id, &name), |s, r| s.managed(r, "The project was not renamed.")),
            Prompt::DeleteProject(id) => self.spawn(move |c| c.delete_project(&id), |s, r| s.managed(r, "The project was not deleted.")),
        }
    }

    fn managed(&mut self, done: Result<(), String>, failure: &str) {
        if let Err(e) = done {
            self.notice = Some(format!("{failure} {e}"));
        }
        self.refresh();
    }
}
