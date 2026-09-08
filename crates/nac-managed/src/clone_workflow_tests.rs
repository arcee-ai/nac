use std::ffi::OsStr;
use std::process::Command as StdCommand;
use std::time::Duration;

use super::*;

#[derive(Default)]
struct TestProjectRegistrar {
    projects: StdMutex<Vec<ProjectRecord>>,
}

impl ProjectRegistrar for TestProjectRegistrar {
    fn list_projects(&self) -> Result<Vec<ProjectRecord>> {
        Ok(self
            .projects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone())
    }

    fn register_project(&self, project: NewProject) -> Result<ProjectRecord> {
        let mut projects = self
            .projects
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if projects.iter().any(|existing| {
            existing.project_id == project.project_id || existing.cwd == project.cwd
        }) {
            bail!("a project already uses this identity or location");
        }
        let now = "2026-01-01T00:00:00Z".to_string();
        let record = ProjectRecord {
            project_id: project.project_id,
            name: project.name.unwrap_or_else(|| "Project".to_string()),
            description: project.description,
            cwd: project.cwd,
            ssh_host: project.ssh_host,
            ssh_port: project.ssh_port,
            ssh_identity_file: project.ssh_identity_file,
            default_model_config_id: project.default_model_config_id,
            created_at: now.clone(),
            updated_at: now,
            pinned: false,
            sort_order: projects.len() as i64,
            presentation_version: 0,
        };
        projects.push(record.clone());
        Ok(record)
    }
}

struct Fixture {
    root: PathBuf,
    repository_root: PathBuf,
    state_root: PathBuf,
    home_root: PathBuf,
    registrar: Arc<TestProjectRegistrar>,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "nac-managed-clone-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let repository_root = root.join("repositories");
        let state_root = root.join("state");
        let home_root = root.join("home");
        for path in [&repository_root, &state_root, &home_root] {
            std::fs::create_dir_all(path).unwrap();
        }
        Self {
            root,
            repository_root,
            state_root,
            home_root,
            registrar: Arc::new(TestProjectRegistrar::default()),
        }
    }

    fn service(&self) -> ManagedCloneService {
        ManagedCloneService::new(
            &self.repository_root,
            &self.state_root,
            &self.home_root,
            self.registrar.clone(),
            None,
        )
        .unwrap()
    }

    fn service_with_git(&self, git_executable: PathBuf) -> ManagedCloneService {
        ManagedCloneService::new_with_git_executable(
            &self.repository_root,
            &self.state_root,
            &self.home_root,
            self.registrar.clone(),
            None,
            git_executable,
        )
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn run(command: &mut StdCommand) {
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git<I, S>(cwd: Option<&Path>, args: I)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = StdCommand::new("git");
    if let Some(cwd) = cwd {
        command.arg("-C").arg(cwd);
    }
    command.args(args);
    run(&mut command);
}

fn local_remote(root: &Path, name: &str) -> PathBuf {
    let source = root.join(format!("{name}-source"));
    let bare = root.join(format!("{name}.git"));
    std::fs::create_dir_all(&source).unwrap();
    git(Some(&source), ["init", "-b", "main"]);
    git(Some(&source), ["config", "user.name", "NAC Test"]);
    git(Some(&source), ["config", "user.email", "nac@example.test"]);
    std::fs::write(source.join("README.md"), "main\n").unwrap();
    git(Some(&source), ["add", "README.md"]);
    git(Some(&source), ["commit", "-m", "main"]);
    git(Some(&source), ["checkout", "-b", "feature"]);
    std::fs::write(source.join("FEATURE.md"), "feature\n").unwrap();
    git(Some(&source), ["add", "FEATURE.md"]);
    git(Some(&source), ["commit", "-m", "feature"]);
    git(Some(&source), ["checkout", "main"]);
    let mut clone = StdCommand::new("git");
    clone.arg("clone").arg("--bare").arg(&source).arg(&bare);
    run(&mut clone);
    bare
}

fn request(remote: &Path, destination: &str, branch: &str) -> ManagedCloneRequest {
    ManagedCloneRequest {
        repository_id: 42,
        repository: "arcee-ai/example".to_string(),
        clone_url: remote.display().to_string(),
        branch: branch.to_string(),
        destination: PathBuf::from(destination),
        project_id: uuid::Uuid::new_v4().to_string(),
        project_name: "Example".to_string(),
        project_description: Some("Managed test clone".to_string()),
    }
}

async fn wait_for_terminal(
    service: &ManagedCloneService,
    operation_id: &str,
) -> ManagedCloneOperation {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let operation = service.operation(operation_id).unwrap().unwrap();
            if operation.status.is_terminal() {
                return operation;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("managed clone did not settle")
}

#[tokio::test]
async fn selected_non_default_branch_is_published_before_project_creation() {
    let fixture = Fixture::new("branch");
    let remote = local_remote(&fixture.root, "origin");
    let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
    let service = fixture.service();
    let started = service
        .start_validated(request(&remote, "example", "feature"), identity)
        .unwrap();
    assert!(fixture.registrar.list_projects().unwrap().is_empty());

    let completed = wait_for_terminal(&service, &started.operation_id).await;
    assert_eq!(completed.status, ManagedCloneStatus::Completed);
    let destination = service.repository_root().join("example");
    assert!(destination.join("FEATURE.md").is_file());
    let output = StdCommand::new("git")
        .arg("-C")
        .arg(&destination)
        .args(["branch", "--show-current"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "feature");
    let projects = fixture.registrar.list_projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].cwd, destination);
    assert!(!fixture
        .repository_root
        .join(format!(".nac-clone-{}", started.operation_id))
        .exists());
}

#[tokio::test]
async fn every_existing_checkout_is_preserved_and_rejected() {
    let fixture = Fixture::new("existing");
    let remote = local_remote(&fixture.root, "origin");
    let other = local_remote(&fixture.root, "other");
    let destination = fixture.repository_root.join("existing");
    let mut clone = StdCommand::new("git");
    clone.arg("clone").arg(&remote).arg(&destination);
    run(&mut clone);
    std::fs::write(destination.join("LOCAL.md"), "preserve me\n").unwrap();
    let service = fixture.service();
    let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
    let error = service
        .start_validated(request(&remote, "existing", "main"), identity)
        .unwrap_err();
    assert!(error.to_string().contains("choose another destination"));
    assert!(error.to_string().contains("ordinary Project"));
    assert_eq!(
        std::fs::read_to_string(destination.join("LOCAL.md")).unwrap(),
        "preserve me\n"
    );
    assert!(fixture.registrar.list_projects().unwrap().is_empty());

    let mismatch_destination = fixture.repository_root.join("mismatch");
    let mut clone = StdCommand::new("git");
    clone.arg("clone").arg(&other).arg(&mismatch_destination);
    run(&mut clone);
    let identity = canonical_remote_identity(&remote.display().to_string()).unwrap();
    let error = service
        .start_validated(request(&remote, "mismatch", "main"), identity)
        .unwrap_err();
    assert!(error.to_string().contains("choose another destination"));
    assert!(mismatch_destination.join("README.md").is_file());
    assert!(fixture.registrar.list_projects().unwrap().is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_and_destination_race_are_bounded_and_project_last() {
    use std::os::unix::fs::PermissionsExt;

    let fixture = Fixture::new("cancel-race");
    let fake_git = fixture.root.join("slow-git");
    std::fs::write(
        &fake_git,
        "#!/bin/sh\nprintf 'waiting for cancellation\\n' >&2\nwhile :; do sleep 1; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake_git, std::fs::Permissions::from_mode(0o700)).unwrap();
    let source = fixture.root.join("source");
    std::fs::create_dir(&source).unwrap();
    let identity = canonical_remote_identity(&source.display().to_string()).unwrap();
    let first = fixture.service_with_git(fake_git.clone());
    let started = first
        .start_validated(request(&source, "reserved", "main"), identity.clone())
        .unwrap();

    let second = fixture.service_with_git(fake_git);
    let error = second
        .start_validated(request(&source, "reserved", "main"), identity)
        .unwrap_err();
    assert!(error.to_string().contains("already reserves"));
    assert!(fixture.registrar.list_projects().unwrap().is_empty());
    assert!(first.cancel(&started.operation_id).unwrap());
    let cancelled = wait_for_terminal(&first, &started.operation_id).await;
    assert_eq!(cancelled.status, ManagedCloneStatus::Cancelled);
    assert!(!fixture.repository_root.join("reserved").exists());
    assert!(!fixture
        .repository_root
        .join(format!(".nac-clone-{}", started.operation_id))
        .exists());
    assert!(fixture.registrar.list_projects().unwrap().is_empty());
}

#[test]
fn startup_reconciliation_cleans_only_owned_staging_and_marks_interrupted() {
    let fixture = Fixture::new("restart");
    let service = fixture.service();
    let operation_id = "0123456789abcdef0123456789abcdef".to_string();
    let destination = fixture.repository_root.join("protected");
    std::fs::create_dir(&destination).unwrap();
    std::fs::write(destination.join("keep"), "do not delete").unwrap();
    let staging = fixture
        .repository_root
        .join(format!(".nac-clone-{operation_id}"));
    std::fs::create_dir(&staging).unwrap();
    std::fs::write(staging.join("partial"), "partial").unwrap();
    service
        .inner
        .operation_store
        .save_staging_marker(&staging, &operation_id, &destination, "file:/source")
        .unwrap();
    let now = now_ms().unwrap();
    service
        .inner
        .operation_store
        .save(&ManagedCloneOperation {
            version: OPERATION_VERSION,
            operation_id: operation_id.clone(),
            status: ManagedCloneStatus::Running,
            repository_id: 42,
            repository: "arcee-ai/example".to_string(),
            source_identity: "file:/source".to_string(),
            branch: "main".to_string(),
            destination: destination.clone(),
            project_id: "project-restart".to_string(),
            project_name: "Restart".to_string(),
            project: None,
            progress: "Cloning".to_string(),
            error: None,
            reused_existing_checkout: false,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        })
        .unwrap();

    let restarted = fixture.service();
    let operation = restarted.operation(&operation_id).unwrap().unwrap();
    assert_eq!(operation.status, ManagedCloneStatus::Interrupted);
    assert!(!staging.exists());
    assert_eq!(
        std::fs::read_to_string(destination.join("keep")).unwrap(),
        "do not delete"
    );
}

#[test]
fn startup_reconciliation_recovers_crash_after_project_last_commit() {
    let fixture = Fixture::new("restart-project-last");
    let remote = local_remote(&fixture.root, "origin");
    let destination = fixture.repository_root.join("published");
    let mut clone = StdCommand::new("git");
    clone.arg("clone").arg(&remote).arg(&destination);
    run(&mut clone);
    let project_id = "project-published".to_string();
    let project = fixture
        .registrar
        .register_project(NewProject {
            project_id: project_id.clone(),
            name: Some("Published".to_string()),
            description: None,
            cwd: destination.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        })
        .unwrap();
    let service = fixture.service();
    let operation_id = "abcdef0123456789abcdef0123456789".to_string();
    let now = now_ms().unwrap();
    service
        .inner
        .operation_store
        .save(&ManagedCloneOperation {
            version: OPERATION_VERSION,
            operation_id: operation_id.clone(),
            status: ManagedCloneStatus::Running,
            repository_id: 42,
            repository: "arcee-ai/example".to_string(),
            source_identity: canonical_remote_identity(&remote.display().to_string()).unwrap(),
            branch: "main".to_string(),
            destination,
            project_id,
            project_name: "Published".to_string(),
            project: None,
            progress: "Publishing".to_string(),
            error: None,
            reused_existing_checkout: false,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        })
        .unwrap();

    let restarted = fixture.service();
    let operation = restarted.operation(&operation_id).unwrap().unwrap();
    assert_eq!(operation.status, ManagedCloneStatus::Completed);
    assert_eq!(operation.project, Some(project));
}

#[cfg(unix)]
#[test]
fn destination_validation_rejects_escape_symlink_and_non_git_collision() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new("paths");
    let source = fixture.root.join("source");
    std::fs::create_dir(&source).unwrap();
    let identity = canonical_remote_identity(&source.display().to_string()).unwrap();
    let service = fixture.service();
    let error = service
        .start_validated(request(&source, "../escape", "main"), identity.clone())
        .unwrap_err();
    assert!(error.to_string().contains("one directory name"));

    let outside = fixture.root.join("outside");
    std::fs::create_dir(&outside).unwrap();
    symlink(&outside, fixture.repository_root.join("link")).unwrap();
    let error = service
        .start_validated(request(&source, "link", "main"), identity.clone())
        .unwrap_err();
    assert!(error.to_string().contains("symlink"));

    let collision = fixture.repository_root.join("collision");
    std::fs::create_dir(&collision).unwrap();
    std::fs::write(collision.join("keep"), "keep").unwrap();
    let error = service
        .start_validated(request(&source, "collision", "main"), identity)
        .unwrap_err();
    assert!(error.to_string().contains("choose another destination"));
    assert!(error.to_string().contains("ordinary Project"));
    assert_eq!(
        std::fs::read_to_string(collision.join("keep")).unwrap(),
        "keep"
    );

    assert_eq!(
        canonical_remote_identity("git@github.com:Arcee-AI/Example.git").unwrap(),
        "github.com/arcee-ai/example"
    );
    assert_eq!(
        canonical_remote_identity("ssh://git@github.com/arcee-ai/example.git").unwrap(),
        "github.com/arcee-ai/example"
    );
    assert!(canonical_remote_identity("https://secret@github.com/arcee-ai/example.git").is_err());
}
