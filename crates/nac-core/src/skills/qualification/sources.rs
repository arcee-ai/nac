//! Opt-in read-only qualification against exact local source revisions.
use super::*;
use std::process::Command;

struct SourceGit {
    home: Option<OsString>,
    xdg: Option<OsString>,
}

impl SourceGit {
    fn capture() -> Self {
        Self {
            home: std::env::var_os("HOME"),
            xdg: std::env::var_os("XDG_CONFIG_HOME"),
        }
    }

    fn run(&self, root: &Path, args: &[&str]) -> String {
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(root)
            .args(args)
            .env("GIT_OPTIONAL_LOCKS", "0");
        for (name, value) in [("HOME", &self.home), ("XDG_CONFIG_HOME", &self.xdg)] {
            match value {
                Some(value) => {
                    command.env(name, value);
                }
                None => {
                    command.env_remove(name);
                }
            }
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }
}

fn required(name: &str) -> String {
    std::env::var(name)
        .unwrap_or_else(|_| panic!("set {name}; see docs/qualification/linked-skills.md"))
}

#[tokio::test]
#[ignore = "requires explicit read-only catalog/installed paths and immutable source revisions"]
async fn exact_catalog_links_and_repository_skills_are_discovered_expanded_and_read() {
    if run_in_subprocess(
        "sources::exact_catalog_links_and_repository_skills_are_discovered_expanded_and_read",
        true,
    ) {
        return;
    }
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let catalog = PathBuf::from(required("NAC_QUALIFY_CATALOG"));
    let installed = PathBuf::from(required("NAC_QUALIFY_INSTALLED"));
    let source = PathBuf::from(required("NAC_QUALIFY_SOURCE"));
    let catalog_rev = required("NAC_QUALIFY_CATALOG_REV");
    let source_rev = required("NAC_QUALIFY_SOURCE_REV");
    let catalog = catalog.canonicalize().unwrap();
    let git = SourceGit::capture();
    assert_eq!(
        git.run(&catalog, &["rev-parse", "HEAD"]).trim(),
        catalog_rev
    );
    assert!(
        git.run(&catalog, &["status", "--porcelain"]).is_empty(),
        "catalog must be clean"
    );
    assert_eq!(
        git.run(&source, &["rev-parse", &source_rev]).trim(),
        source_rev
    );
    let f = Fixture::new();
    // Export only immutable tracked skill bytes, never execute their workflow.
    for file in git
        .run(
            &source,
            &[
                "ls-tree",
                "-r",
                "--name-only",
                &source_rev,
                "--",
                ".agents/skills",
            ],
        )
        .lines()
    {
        let contents = git.run(&source, &["show", &format!("{source_rev}:{file}")]);
        f.write(&format!("project/{file}"), &contents);
    }
    let user_root = f.root.join("home/.agents/skills");
    fs::create_dir_all(&user_root).unwrap();
    let mut names = Vec::new();
    for entry in fs::read_dir(&installed).unwrap() {
        let entry = entry.unwrap();
        if !entry.file_type().unwrap().is_symlink() {
            continue;
        }
        let target = entry.path().canonicalize().unwrap();
        assert!(
            target.starts_with(&catalog),
            "foreign installed link: {}",
            entry.path().display()
        );
        let name = entry.file_name().into_string().unwrap();
        let metadata: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(target.join("skill.json")).unwrap()).unwrap();
        println!(
            "installed {name} -> {} clients={}",
            target.strip_prefix(&catalog).unwrap().display(),
            metadata["clients"]
        );
        symlink(target, user_root.join(&name)).unwrap();
        names.push(name);
    }
    names.sort();
    assert!(!names.is_empty());
    let registry = f.load();
    let mut requests = Vec::new();
    let mut expected = Vec::new();
    let mut rules = Vec::new();
    // Every installed package must expand, including packages excluded by the
    // installer for NAC. This does not certify those packages' workflows.
    for name in names
        .iter()
        .map(String::as_str)
        .chain(["qa", "release", "triage"])
    {
        assert!(registry.has_skill(name), "not discovered: {name}");
        let PreparedUserInput::SubmitPrompt(prepared) =
            prepare_user_input(&format!("${name}"), Some(&registry))
        else {
            panic!("expected prompt")
        };
        assert!(prepared
            .agent_prompt
            .contains(&format!("<skill_content name=\"{name}\">")));
        let skill_root = if ["qa", "release", "triage"].contains(&name) {
            f.project().join(".agents/skills").join(name)
        } else {
            user_root.join(name)
        };
        assert!(prepared
            .agent_prompt
            .contains(&format!("Skill directory: {}", skill_root.display())));
        let resources = list_skill_resources(&skill_root).unwrap();
        for relative in std::iter::once("SKILL.md").chain(resources.iter().map(String::as_str)) {
            let path = skill_root.join(relative);
            let canonical = path.canonicalize().unwrap();
            assert!(
                canonical.starts_with(&catalog) || canonical.starts_with(f.project()),
                "resource target leaves the selected roots: {}",
                path.display()
            );
            if !canonical.starts_with(f.project()) {
                // These exact read targets were selected by this opt-in test;
                // there is no global or directory-wide permission grant.
                rules.push(PermissionRule::new(
                    "external_directory",
                    canonical.display().to_string(),
                    PermissionEffect::Allow,
                ));
            }
            let id = format!("resource-{}", requests.len());
            requests.push((id.clone(), path));
            expected.push((id, fs::read_to_string(canonical).unwrap()));
        }
    }
    let call_args: Vec<_> = requests
        .iter()
        .map(|(id, path)| (id.as_str(), "read", json!({"path":path})))
        .collect();
    let server = ScriptedServer::start(vec![calls(&call_args), done()]);
    let mut run = f.direct(&server.base_url, rules).await;
    let raw = names
        .iter()
        .map(|name| format!("${name}"))
        .chain(["$qa".into(), "$release".into(), "$triage".into()])
        .collect::<Vec<_>>()
        .join(" ");
    let PreparedUserInput::SubmitPrompt(prepared) =
        prepare_user_input(&raw, run.agent.skills().as_deref())
    else {
        panic!("expected prompt")
    };
    run.agent.send(&prepared.agent_prompt).await.unwrap();
    for (id, bytes) in expected {
        let result = tool_result(&run, &id);
        let value: serde_json::Value =
            serde_json::from_str(&result).unwrap_or_else(|_| panic!("{id}: {result}"));
        assert!(value["revision"].is_string(), "{id}: {result}");
        assert_eq!(value["content"].as_str().unwrap(), bytes, "{id}");
    }
    let captured = server.finish();
    assert_eq!(captured.len(), 2);
    let sent: serde_json::Value = serde_json::from_slice(&captured[0].body).unwrap();
    for name in names
        .iter()
        .map(String::as_str)
        .chain(["qa", "release", "triage"])
    {
        assert!(sent
            .to_string()
            .contains(&format!("<skill_content name=\\\"{name}\\\">")));
    }
    assert_eq!(
        git.run(&catalog, &["rev-parse", "HEAD"]).trim(),
        catalog_rev
    );
    assert!(git.run(&catalog, &["status", "--porcelain"]).is_empty());
    println!("catalog={catalog_rev}; repository skill bytes={source_rev}; {} installed packages; {} native reads", names.len(), requests.len());
}

#[test]
fn source_git_keeps_original_global_config_across_fixture_home_change() {
    if run_in_subprocess(
        "sources::source_git_keeps_original_global_config_across_fixture_home_change",
        false,
    ) {
        return;
    }
    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    let mut owner = Fixture::new();
    // A real temporary Git home, independent of the operator's Git settings.
    for name in [
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_COUNT",
        "GIT_CONFIG_PARAMETERS",
    ] {
        owner.env.push((name, std::env::var_os(name)));
        unsafe { std::env::remove_var(name) };
    }
    owner.write("home/.config/git/ignore", "catalog-noise\n");
    owner.set_env(
        "XDG_CONFIG_HOME",
        owner.root.join("home/.config").as_os_str(),
    );
    let repo = owner.root.join("catalog");
    fs::create_dir_all(&repo).unwrap();
    let git = SourceGit::capture();
    git.run(&repo, &["init", "--quiet"]);
    owner.write(
        "catalog/catalog-noise",
        "ignored only by the original global config\n",
    );
    assert!(git.run(&repo, &["status", "--porcelain"]).is_empty());
    let _changed_home = Fixture::new();
    // Original helper behavior reproduces the finding: the same checkout now
    // appears dirty solely because HOME/XDG changed, with no source mutation.
    assert!(SourceGit::capture()
        .run(&repo, &["status", "--porcelain"])
        .contains("catalog-noise"));
    assert!(git.run(&repo, &["status", "--porcelain"]).is_empty());
    assert!(!repo.join(".git/index").exists());
}
