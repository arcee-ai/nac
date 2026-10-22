//! Disposable configured directories only. No live user HOME or target IO.
use super::*;
use crate::model::BackendKind;
use crate::runtime::{
    resolve_create_inputs_with_global_source, CreateConfigurationSource, CreateModelCatalogSource,
    ModelOptions, OptionalModelOption, RunOptions, StoreOptions,
};
use std::{os::unix::fs::symlink, time::Duration};

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    nac: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("global-source-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let home = root.join("home");
        let nac = root.join("configured-nac");
        std::fs::create_dir(&home).unwrap();
        std::fs::create_dir(&nac).unwrap();
        Self { root, home, nac }
    }
    fn paths(&self) -> PathContext {
        PathContext::with_global_dirs(
            self.root.clone(),
            Some(self.nac.clone()),
            Some(self.home.clone()),
        )
    }
    fn capture(&self) -> Arc<CreateGlobalSourceRoots> {
        Arc::new(CreateGlobalSourceRoots::capture_selected(self.paths()).unwrap())
    }
    fn cutoff(&self) -> Instant {
        Instant::now() + Duration::from_secs(30)
    }
    fn config(&self) {
        std::fs::write(
            self.nac.join("config.toml"),
            "[worker]\nthread_timeout_secs=73\n",
        )
        .unwrap();
        // Existing ordinary writer establishes its own startup fence resources;
        // the global/configuration source captures themselves never create them.
        drop(
            crate::mcp::acquire_mcp_configuration_write_lease(&self.nac.join("config.toml"))
                .unwrap(),
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn original_global_roots_and_absence_are_retained_without_creating_paths() {
    let f = Fixture::new();
    let original = f.capture();
    let source = original.for_preparation(f.cutoff()).unwrap();
    assert!(Arc::ptr_eq(&source.original, &original));
    assert_eq!(source.global_agents_root().unwrap(), Some(f.nac.as_path()));
    assert_eq!(
        source.global_skill_roots().unwrap(),
        vec![
            f.nac.join("skills").as_path(),
            f.home.join(".agents/skills").as_path()
        ]
    );
    assert!(!f.nac.join("skills").exists());
    assert!(!f.home.join(".agents").exists());
    assert!(source.nac_home_directory().unwrap().is_some());
    source.check_current().unwrap();
}
#[test]
fn nested_source_appearance_denies_only_old_preparation_and_fresh_capture_uses_same_startup_owner()
{
    let f = Fixture::new();
    let original = f.capture();
    let old = original.for_preparation(f.cutoff()).unwrap();
    std::fs::create_dir_all(f.home.join(".agents/skills")).unwrap();
    assert!(old.check_current().is_err());
    original.check_current().unwrap();
    let fresh = original.for_preparation(f.cutoff()).unwrap();
    assert!(Arc::ptr_eq(&old.original, &fresh.original));
    fresh.check_current().unwrap();
    assert!(old.check_current().is_err());
}
#[test]
fn original_home_replacement_is_sticky_and_same_bytes_or_names_cannot_rebind_it() {
    let f = Fixture::new();
    let original = f.capture();
    let source = original.for_preparation(f.cutoff()).unwrap();
    let moved = f.root.join("old-home");
    std::fs::rename(&f.home, &moved).unwrap();
    std::fs::create_dir(&f.home).unwrap();
    assert!(source.check_current().is_err());
    std::fs::remove_dir(&f.home).unwrap();
    std::fs::rename(moved, &f.home).unwrap();
    assert!(source.check_current().is_err());
    assert!(original.check_current().is_err());
}
#[test]
fn missing_configured_home_is_bound_as_absence_and_errors_never_become_empty_globals() {
    let f = Fixture::new();
    let missing = f.root.join("not-created/deeper");
    let paths =
        PathContext::with_global_dirs(f.root.clone(), Some(f.nac.clone()), Some(missing.clone()));
    let original = Arc::new(CreateGlobalSourceRoots::capture_selected(paths).unwrap());
    let source = original.for_preparation(f.cutoff()).unwrap();
    assert!(!missing.exists());
    assert_eq!(
        source.global_skill_roots().unwrap()[1],
        missing.join(".agents/skills")
    );
    std::fs::create_dir(missing.parent().unwrap()).unwrap();
    assert!(source.check_current().is_err());
    assert!(original.for_preparation(f.cutoff()).is_err());
}
#[test]
fn symlink_or_file_directory_roots_refuse_and_do_not_repair_them() {
    let f = Fixture::new();
    let alias = f.root.join("alias");
    symlink(&f.home, &alias).unwrap();
    let paths =
        PathContext::with_global_dirs(f.root.clone(), Some(f.nac.clone()), Some(alias.clone()));
    assert!(CreateGlobalSourceRoots::capture_selected(paths).is_err());
    assert!(std::fs::symlink_metadata(&alias)
        .unwrap()
        .file_type()
        .is_symlink());
    let file = f.root.join("not-directory");
    std::fs::write(&file, "PRIVATE_ROOT_SENTINEL").unwrap();
    let paths = PathContext::with_global_dirs(f.root.clone(), Some(f.nac.clone()), Some(file));
    let error = CreateGlobalSourceRoots::capture_selected(paths)
        .err()
        .unwrap();
    assert!(!format!("{error:?}").contains("PRIVATE_ROOT_SENTINEL"));
}
#[test]
fn global_nac_then_home_skill_precedence_reuses_existing_parser_and_discovery() {
    let f = Fixture::new();
    for (root, body) in [
        (f.nac.join("skills"), "NAC body"),
        (f.home.join(".agents/skills"), "HOME body"),
    ] {
        std::fs::create_dir_all(root.join("same")).unwrap();
        std::fs::write(
            root.join("same/SKILL.md"),
            format!("---\nname: same\ndescription: test\n---\n{body}\n"),
        )
        .unwrap();
    }
    std::fs::write(f.nac.join("AGENTS.md"), "less specific").unwrap();
    std::fs::write(f.nac.join("AGENTS.override.md"), "global override").unwrap();
    let original = f.capture();
    let source = original.for_preparation(f.cutoff()).unwrap();
    let paths = source.path_context().unwrap();
    // These are existing ordinary parsers applied ONLY to disposable fixture
    // data to pin precedence. The resource owner does not grant production IO.
    let skills = crate::skills::SkillRegistry::load(
        None,
        crate::skills::SkillPathVisibility::Visible,
        paths,
    )
    .unwrap()
    .unwrap();
    let rendered = skills.render_for_prompt("same").unwrap();
    assert!(rendered.contains("NAC body"));
    assert!(!rendered.contains("HOME body"));
    let docs = crate::agents_md::AgentsMdBundle::load(None, paths)
        .unwrap()
        .system_message()
        .unwrap();
    assert!(docs.contains("global override"));
    assert!(!docs.contains("less specific"));
    let workspace = f.root.join("workspace");
    std::fs::create_dir_all(workspace.join(".git")).unwrap();
    for (root, body) in [
        (workspace.join(".nac/skills"), "project NAC"),
        (workspace.join(".agents/skills"), "project agents"),
    ] {
        std::fs::create_dir_all(root.join("same")).unwrap();
        std::fs::write(
            root.join("same/SKILL.md"),
            format!("---\nname: same\ndescription: test\n---\n{body}\n"),
        )
        .unwrap();
    }
    let project = crate::skills::SkillRegistry::load(
        Some(&workspace),
        crate::skills::SkillPathVisibility::Visible,
        paths,
    )
    .unwrap()
    .unwrap();
    let rendered = project.render_for_prompt("same").unwrap();
    assert!(rendered.contains("project NAC"));
    assert!(!rendered.contains("project agents"));
    assert!(!rendered.contains("NAC body"));
    source.check_current().unwrap();
}
#[test]
fn global_source_is_consumed_by_config_and_resolved_inputs_without_late_env_resolution() {
    let f = Fixture::new();
    f.config();
    let original = f.capture();
    let cutoff = f.cutoff();
    let global = Arc::new(original.for_preparation(cutoff).unwrap());
    let config = CreateConfigurationSource::capture_from_global_source(&global).unwrap();
    let catalog = CreateModelCatalogSource::capture(&f.nac, cutoff).unwrap();
    assert_eq!(
        config.configuration().unwrap().worker.thread_timeout_secs,
        Some(73)
    );
    let options = RunOptions {
        workspace_cwd: f.root.clone(),
        config_cwd: Some(f.root.clone()),
        store: StoreOptions {
            store_path: Some(f.root.join("store.db")),
        },
        model: ModelOptions {
            backend: Some(BackendKind::ArceeApi),
            api_model: Some("trinity-large-thinking".into()),
            api_base_url: Some("https://api.arcee.ai/api/v1".into()),
            api_key_env: OptionalModelOption::Clear,
            ..Default::default()
        },
        ..Default::default()
    };
    let resolved = resolve_create_inputs_with_global_source(
        options,
        &config,
        &catalog,
        Arc::clone(&global),
        crate::sessions::SessionBehavior::Direct,
    )
    .unwrap();
    let parts = resolved.into_parts();
    assert!(Arc::ptr_eq(parts.global_source.as_ref().unwrap(), &global));
    drop(original);
    global.check_current().unwrap();
    assert_eq!(global.global_agents_root().unwrap(), Some(f.nac.as_path()));
}
#[test]
fn scoped_denial_and_expiry_never_release_or_renew_original_resources() {
    let f = Fixture::new();
    let original = f.capture();
    let source = original.for_preparation(f.cutoff()).unwrap();
    source.deny();
    assert!(source.global_agents_root().is_err());
    original.check_current().unwrap();
    assert!(original.for_preparation(Instant::now()).is_err());
    let later = original.for_preparation(f.cutoff()).unwrap();
    later.check_current().unwrap();
    original.deny();
    assert!(later.check_denial().is_err());
    assert!(CreateGlobalSourceRoots::capture(Path::new("relative")).is_err());
}

struct Environment {
    original: Vec<(&'static str, Option<std::ffi::OsString>)>,
    _lock: std::sync::MutexGuard<'static, ()>,
}
impl Environment {
    fn set(f: &Fixture) -> Self {
        let lock = crate::TEST_ENV_LOCK.lock().unwrap();
        let original = ["HOME", "NAC_HOME", "XDG_CONFIG_HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        // SAFETY: same shared environment test lock remains held through Drop.
        unsafe {
            std::env::set_var("HOME", &f.home);
            std::env::set_var("NAC_HOME", &f.nac);
            std::env::set_var("XDG_CONFIG_HOME", f.root.join("xdg"));
        }
        Self {
            original,
            _lock: lock,
        }
    }
    fn remove(&self, key: &str) {
        // SAFETY: this guard retains TEST_ENV_LOCK.
        unsafe {
            std::env::remove_var(key);
        }
    }
}
impl Drop for Environment {
    fn drop(&mut self) {
        // SAFETY: _lock is released after all original values are restored.
        unsafe {
            for (key, value) in self.original.drain(..) {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }
}
#[test]
fn startup_samples_existing_global_precedence_once_and_configuration_consumes_same_roots() {
    let f = Fixture::new();
    f.config();
    let environment = Environment::set(&f);
    let original = Arc::new(CreateGlobalSourceRoots::capture(&f.root).unwrap());
    let replacement = Fixture::new();
    // SAFETY: Environment retains TEST_ENV_LOCK and restores original values.
    unsafe {
        std::env::set_var("HOME", &replacement.home);
        std::env::set_var("NAC_HOME", &replacement.nac);
    }
    let source = original.for_preparation(f.cutoff()).unwrap();
    assert_eq!(source.global_agents_root().unwrap(), Some(f.nac.as_path()));
    let config = CreateConfigurationSource::capture_from_global_source(&source).unwrap();
    assert_eq!(
        config.configuration().unwrap().worker.thread_timeout_secs,
        Some(73)
    );
    // Restore fixture selection before checking the ordinary NAC_HOME > XDG >
    // HOME fallback. No call below ever samples the user's real HOME.
    unsafe {
        std::env::set_var("HOME", &f.home);
    }
    environment.remove("NAC_HOME");
    std::fs::create_dir_all(f.root.join("xdg/nac")).unwrap();
    let xdg = Arc::new(CreateGlobalSourceRoots::capture(&f.root).unwrap());
    assert_eq!(
        xdg.for_preparation(f.cutoff())
            .unwrap()
            .global_agents_root()
            .unwrap(),
        Some(f.root.join("xdg/nac").as_path())
    );
    environment.remove("XDG_CONFIG_HOME");
    std::fs::create_dir_all(f.home.join(".config/nac")).unwrap();
    let home = Arc::new(CreateGlobalSourceRoots::capture(&f.root).unwrap());
    assert_eq!(
        home.for_preparation(f.cutoff())
            .unwrap()
            .global_agents_root()
            .unwrap(),
        Some(f.home.join(".config/nac").as_path())
    );
}
#[test]
fn source_home_or_clock_mismatch_refuses_resolved_input_consumption() {
    let f = Fixture::new();
    f.config();
    let original = f.capture();
    let cutoff = f.cutoff();
    let source = Arc::new(original.for_preparation(cutoff).unwrap());
    let config = CreateConfigurationSource::capture_from_global_source(&source).unwrap();
    let catalog = CreateModelCatalogSource::capture(&f.nac, cutoff).unwrap();
    let other = Fixture::new();
    let wrong = other.capture();
    let wrong_source = Arc::new(wrong.for_preparation(cutoff).unwrap());
    assert!(resolve_create_inputs_with_global_source(
        RunOptions::default(),
        &config,
        &catalog,
        wrong_source,
        crate::sessions::SessionBehavior::Direct
    )
    .is_err());
    let changed = Arc::new(
        original
            .for_preparation(cutoff + Duration::from_secs(1))
            .unwrap(),
    );
    assert!(resolve_create_inputs_with_global_source(
        RunOptions::default(),
        &config,
        &catalog,
        changed,
        crate::sessions::SessionBehavior::Direct
    )
    .is_err());
}

#[test]
fn ancestor_metadata_change_denies_without_rebinding_original_home() {
    use std::os::unix::fs::PermissionsExt;
    let f = Fixture::new();
    let original = f.capture();
    let source = original.for_preparation(f.cutoff()).unwrap();
    let permissions = std::fs::metadata(&f.home).unwrap().permissions();
    let altered = if permissions.mode() & 0o100 != 0 {
        permissions.mode() & !0o100
    } else {
        permissions.mode() | 0o100
    };
    std::fs::set_permissions(&f.home, std::fs::Permissions::from_mode(altered)).unwrap();
    assert!(source.check_current().is_err());
    std::fs::set_permissions(&f.home, permissions).unwrap();
    assert!(source.check_current().is_err());
    assert!(original.check_current().is_err());
}
