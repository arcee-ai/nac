use super::*;

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[test]
fn recognises_host_match_and_include_in_every_keyword_form() {
    let text = "\
# comment
  host alpha beta
HOST=gamma
Host = delta\t epsilon # trailing comment
Hostname ignored.example
Match exec \"touch /tmp/never\" host *
Include  config.d/*  ~/extra
";
    assert_eq!(
        parse(text),
        vec![
            Directive::Host(strings(&["alpha", "beta"])),
            Directive::Host(strings(&["gamma"])),
            Directive::Host(strings(&["delta", "epsilon"])),
            Directive::Match,
            Directive::Include(strings(&["config.d/*", "~/extra"])),
        ]
    );
}

#[test]
fn splits_arguments_like_openssh() {
    assert_eq!(
        parse("Host \"quoted name\" 'single' esc\\ aped back\\\\slash mid#hash #rest"),
        vec![Directive::Host(strings(&[
            "quoted name",
            "single",
            "esc aped",
            "back\\slash",
            "mid#hash",
        ]))]
    );
    // A broken Host still opens a block, one that matches no host.
    assert_eq!(
        parse("Host \"unterminated"),
        vec![Directive::Host(Vec::new())]
    );
    assert_eq!(parse("Host"), vec![Directive::Host(Vec::new())]);
    assert_eq!(
        parse("Include # only a comment"),
        vec![Directive::Malformed]
    );
    // A broken Match still opens a conditional block.
    assert_eq!(parse("Match \"unterminated"), vec![Directive::Match]);
}

#[test]
fn ignores_every_other_directive_including_commands() {
    let text = "\
ProxyCommand sh -c 'touch /tmp/never'
LocalCommand touch /tmp/never
KnownHostsCommand /bin/false
IdentityFile ~/.ssh/id_secret
User someone
Hosts not-a-host-line
";
    assert!(parse(text).is_empty());
}

#[test]
fn classifies_literals_separately_from_patterns_ssh_cannot_list() {
    for literal in ["build-box", "prod.example.com", "10.0.0.5", "db_1", "[::1]"] {
        assert_eq!(classify(literal), HostPattern::Literal(literal.to_string()));
    }
    for pattern in [
        "*",
        "*.example.com",
        "web-?",
        "!bastion",
        "-oProxyCommand=x",
        "user@host",
        "a,b",
        "%h",
        "",
        &"x".repeat(MAX_ALIAS_BYTES + 1),
    ] {
        assert_eq!(classify(pattern), HostPattern::Undiscoverable, "{pattern}");
    }
}

#[test]
fn only_an_unnegated_star_matches_every_host() {
    assert!(matches_every_host(&strings(&["*"])));
    assert!(matches_every_host(&strings(&["alpha", "*"])));
    assert!(!matches_every_host(&strings(&["*", "!bastion"])));
    assert!(!matches_every_host(&strings(&["*.example.com"])));
    assert!(!matches_every_host(&strings(&["alpha"])));
}

#[test]
fn final_component_globs_follow_glob3_rules() {
    assert!(glob_matches("*", "work"));
    assert!(glob_matches("*.conf", "a.conf"));
    assert!(glob_matches("host-?", "host-1"));
    assert!(glob_matches("a*b*c", "aXXbYYc"));
    assert!(!glob_matches("*.conf", "a.conf.bak"));
    assert!(!glob_matches("host-?", "host-10"));
    assert!(!glob_matches("*", ".hidden"));
    assert!(glob_matches(".*", ".hidden"));
}
