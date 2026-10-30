use super::*;
use AliasDiscoveryWarning as W;

/// A throwaway home directory with an empty `~/.ssh`.
struct Home(PathBuf);

impl Home {
    fn new(label: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_ssh_aliases_{label}_{unique}"));
        std::fs::create_dir_all(root.join(".ssh")).unwrap();
        Self(std::fs::canonicalize(root).unwrap())
    }

    fn ssh(&self, relative: &str) -> PathBuf {
        self.0.join(".ssh").join(relative)
    }

    fn write(&self, path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn config(&self, text: &str) {
        self.write(&self.ssh("config"), text);
    }

    fn discover(&self) -> AliasDiscovery {
        discover(Some(&self.0))
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn aliases(discovery: &AliasDiscovery) -> Vec<&str> {
    discovery.aliases.iter().map(String::as_str).collect()
}

#[cfg(unix)]
fn running_as_root() -> bool {
    // SAFETY: geteuid has no preconditions and cannot fail.
    unsafe { libc::geteuid() == 0 }
}

#[test]
fn lists_literal_aliases_including_several_on_one_line() {
    let home = Home::new("literals");
    home.config(
        "Host build-box\n  HostName 192.0.2.10\n  User deploy\n\
         Host staging prod.example.com\n  Port 2222\n",
    );
    let discovery = home.discover();
    assert_eq!(
        aliases(&discovery),
        ["build-box", "staging", "prod.example.com"]
    );
    assert_eq!(discovery.undiscoverable_patterns, 0);
    assert!(discovery.warnings.is_empty());
}

#[test]
fn returns_alias_names_without_any_other_directive_value() {
    let home = Home::new("names_only");
    let key = home.ssh("id_secret_key");
    home.write(&key, "-----BEGIN OPENSSH PRIVATE KEY-----\nKEYMATERIAL\n");
    home.config(&format!(
        "Host vault\n  HostName secret-host.internal\n  User secret-user\n  \
         IdentityFile {}\n  ProxyJump secret-jump\n",
        key.display()
    ));
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["vault"]);
    let rendered = format!("{discovery:?}");
    for private in [
        "secret-host",
        "secret-user",
        "id_secret_key",
        "KEYMATERIAL",
        "secret-jump",
    ] {
        assert!(!rendered.contains(private), "{private} leaked: {rendered}");
    }
}

#[test]
fn follows_relative_absolute_home_and_glob_includes_in_order() {
    let home = Home::new("includes");
    let absolute = home.0.join("elsewhere").join("absolute.conf");
    home.write(&absolute, "Host from-absolute\n");
    home.write(&home.ssh("relative.conf"), "Host from-relative\n");
    home.write(&home.0.join("tilde.conf"), "Host from-tilde\n");
    home.write(&home.ssh("config.d/20-b"), "Host from-glob-b\n");
    home.write(&home.ssh("config.d/10-a"), "Host from-glob-a\n");
    home.write(&home.ssh("config.d/.hidden"), "Host from-hidden\n");
    home.config(&format!(
        "Include relative.conf\nInclude {} ~/tilde.conf\nHost first\n\
         Host *\n  Include config.d/*\n",
        absolute.display()
    ));
    let discovery = home.discover();
    assert_eq!(
        aliases(&discovery),
        [
            "from-relative",
            "from-absolute",
            "from-tilde",
            "first",
            "from-glob-a",
            "from-glob-b",
        ]
    );
    assert_eq!(discovery.undiscoverable_patterns, 1, "the `Host *` pattern");
    assert!(discovery.warnings.is_empty(), "{:?}", discovery.warnings);
}

#[test]
fn deduplicates_aliases_keeping_first_seen_order() {
    let home = Home::new("duplicates");
    home.write(&home.ssh("more"), "Host beta alpha gamma\n");
    home.config("Include more\nHost alpha beta\nHost alpha\nHost *\n  Include more\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["beta", "alpha", "gamma"]);
    assert!(
        discovery.warnings.is_empty(),
        "a repeated include is not a cycle"
    );
}

#[test]
fn counts_wildcards_and_negations_without_listing_them() {
    let home = Home::new("patterns");
    home.config("Host *.corp web-? !bastion jump\nHost * !jump\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["jump"]);
    assert_eq!(discovery.undiscoverable_patterns, 5);
}

#[cfg(unix)]
#[test]
fn never_runs_match_exec_or_any_command_directive() {
    let home = Home::new("no_exec");
    let sentinel = home.0.join("sentinel");
    let touch = format!("touch {}", sentinel.display());
    home.write(&home.ssh("conditional.conf"), "Host from-conditional\n");
    home.config(&format!(
        "Match exec \"{touch}\"\n  Include conditional.conf\n  ProxyCommand {touch}\n\
         Host after-match\n  LocalCommand {touch}\n  PermitLocalCommand yes\n\
         Match host after-match exec \"{touch}\"\nHost %h\n",
    ));
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["after-match"]);
    assert_eq!(discovery.undiscoverable_patterns, 1, "the `%h` pattern");
    assert_eq!(discovery.warnings, [W::ConditionalIncludeSkipped]);
    assert!(
        !sentinel.exists(),
        "discovery executed a configured command"
    );
}

#[test]
fn skips_includes_that_only_apply_to_one_host() {
    let home = Home::new("conditional_host");
    home.write(&home.ssh("only-for-a"), "Host hidden\n");
    home.config("Host a\n  Include only-for-a\nHost b\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["a", "b"]);
    assert_eq!(discovery.warnings, [W::ConditionalIncludeSkipped]);
}

#[test]
fn refuses_includes_that_need_runtime_evaluation() {
    let home = Home::new("unsupported");
    home.write(&home.ssh("x"), "Host never\n");
    home.config(
        "Include %d/.ssh/x\nInclude ${HOME}/.ssh/x\nInclude ~other/x\n\
         Include */x\nInclude [x]\nHost kept\n",
    );
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["kept"]);
    assert_eq!(discovery.warnings, [W::UnsupportedInclude]);
}

#[test]
fn a_missing_config_is_quietly_empty_and_a_missing_include_is_partial() {
    let home = Home::new("missing");
    assert_eq!(home.discover(), AliasDiscovery::default());

    home.config("Include not-there\nInclude absent.d/*\nHost before after\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["before", "after"]);
    assert_eq!(discovery.warnings, [W::MissingInclude]);
}

#[test]
fn an_unavailable_home_is_reported_without_failing() {
    assert_eq!(discover(None).warnings, [W::HomeUnavailable]);
    assert_eq!(
        discover(Some(Path::new("relative"))).warnings,
        [W::HomeUnavailable]
    );
}

#[cfg(unix)]
#[test]
fn unreadable_files_degrade_to_partial_results() {
    use std::os::unix::fs::PermissionsExt;
    if running_as_root() {
        eprintln!("skipping: root can read mode 000 files");
        return;
    }
    let home = Home::new("unreadable");
    let locked = home.ssh("locked");
    home.write(&locked, "Host from-locked\n");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    home.config("Include locked\nHost open\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["open"]);
    assert_eq!(discovery.warnings, [W::UnreadableFile]);

    std::fs::set_permissions(home.ssh("config"), std::fs::Permissions::from_mode(0o000)).unwrap();
    let discovery = home.discover();
    assert!(discovery.aliases.is_empty());
    assert_eq!(discovery.warnings, [W::UnreadableFile]);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o600)).unwrap();
}

#[cfg(unix)]
#[test]
fn a_fifo_include_is_skipped_instead_of_blocking() {
    let home = Home::new("fifo");
    let fifo = std::ffi::CString::new(home.ssh("pipe").to_str().unwrap()).unwrap();
    // SAFETY: the path is a valid NUL-terminated string.
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    home.config("Include pipe\nHost after-pipe\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["after-pipe"]);
    assert_eq!(discovery.warnings, [W::UnreadableFile]);
}

#[test]
fn cyclic_includes_stop_at_the_repeat() {
    let home = Home::new("cycle");
    home.write(&home.ssh("a"), "Include b\nHost from-a\n");
    home.write(&home.ssh("b"), "Include a ~/.ssh/config\nHost from-b\n");
    home.config("Include config a\nHost root\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["from-b", "from-a", "root"]);
    assert_eq!(discovery.warnings, [W::IncludeCycle]);
}

#[cfg(unix)]
#[test]
fn a_symlinked_include_cycle_is_detected_by_canonical_path() {
    let home = Home::new("symlink_cycle");
    std::os::unix::fs::symlink(home.ssh("config"), home.ssh("alias-of-config")).unwrap();
    home.config("Include alias-of-config\nHost root\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["root"]);
    assert_eq!(discovery.warnings, [W::IncludeCycle]);
}

#[test]
fn oversized_files_are_skipped_whole() {
    let home = Home::new("oversized");
    let mut big = String::from("Host from-big\n");
    while big.len() as u64 <= MAX_FILE_BYTES {
        big.push_str("# padding padding padding padding padding padding padding\n");
    }
    home.write(&home.ssh("big"), &big);
    home.config("Host small\nHost *\n  Include big\nHost tail\n");
    let discovery = home.discover();
    assert_eq!(aliases(&discovery), ["small", "tail"]);
    assert_eq!(discovery.warnings, [W::OversizedFile]);
}

#[test]
fn include_depth_is_bounded() {
    let home = Home::new("depth");
    for level in 1..=MAX_INCLUDE_DEPTH + 3 {
        home.write(
            &home.ssh(&format!("level{level}")),
            &format!("Include level{}\nHost level{level}\n", level + 1),
        );
    }
    home.config("Host level0\nHost *\n  Include level1\n");
    let discovery = home.discover();
    assert_eq!(discovery.aliases.len(), MAX_INCLUDE_DEPTH + 1);
    // Each level includes the next before naming itself, so the deepest
    // file read contributes first after the root's own alias.
    assert_eq!(
        discovery.aliases[1],
        format!("level{MAX_INCLUDE_DEPTH}"),
        "{:?}",
        discovery.aliases
    );
    assert!(!discovery
        .aliases
        .contains(&format!("level{}", MAX_INCLUDE_DEPTH + 1)));
    assert_eq!(discovery.warnings, [W::IncludeDepthExceeded]);
}

#[test]
fn the_number_of_files_read_is_bounded() {
    let home = Home::new("files");
    for index in 0..MAX_FILES + 10 {
        home.write(
            &home.ssh(&format!("many/{index:03}")),
            &format!("Host many{index:03}\n"),
        );
    }
    home.config("Include many/*\n");
    let discovery = home.discover();
    // The root config is one of the files read.
    assert_eq!(discovery.aliases.len(), MAX_FILES - 1);
    assert_eq!(
        discovery.aliases.first().map(String::as_str),
        Some("many000")
    );
    assert_eq!(discovery.warnings, [W::FileLimitReached]);
}

#[test]
fn the_number_of_aliases_is_bounded() {
    let home = Home::new("alias_limit");
    let names: Vec<String> = (0..MAX_ALIASES + 25).map(|i| format!("h{i}")).collect();
    home.config(&format!("Host {}\n", names.join(" ")));
    let discovery = home.discover();
    assert_eq!(discovery.aliases, names[..MAX_ALIASES]);
    assert_eq!(discovery.warnings, [W::AliasLimitReached]);
}
