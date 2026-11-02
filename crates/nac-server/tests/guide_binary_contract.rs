#![allow(
    clippy::unwrap_used,
    clippy::missing_assert_message,
    reason = "isolated packaged-binary acceptance assertions"
)]

use std::process::Command;

#[test]
fn standalone_binary_reads_the_installed_pack_without_home_checkout_or_network() {
    let root = std::env::temp_dir().join(format!("nac-guide-binary-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let binary = root.join("standalone-nac");
    std::fs::copy(env!("CARGO_BIN_EXE_nac-web"), &binary).unwrap();
    let run = |args: &[&str]| {
        Command::new(&binary)
            .args(args)
            .current_dir(&root)
            .env_clear()
            .env("HOME", root.join("missing-home"))
            .env("NAC_HOME", root.join("missing-config"))
            .env("PATH", "")
            .output()
            .unwrap()
    };
    for (document, section, expected) in [
        ("mcp", "add-a-server", "mcp_servers"),
        ("skills", "discovery", ".nac/skills"),
        ("session-behaviors", "overview", "direct-with-orchestrator"),
        ("web-retrieval", "overview", "Exa"),
    ] {
        let output = run(&["guide", document, section]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let response: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(response["provenance"], "first-party bundled NAC Guide");
        assert_eq!(
            response["build_identity"]["product_version"],
            nac_contracts::PRODUCT_VERSION
        );
        assert_eq!(
            response["build_identity"]["source_revision"],
            env!("NAC_SOURCE_REVISION")
        );
        assert!(response["result"]["text"]
            .as_str()
            .unwrap()
            .contains(expected));
    }
    let search = run(&["guide", "--query", "skills"]);
    assert!(
        search.status.success(),
        "{}",
        String::from_utf8_lossy(&search.stderr)
    );
    assert!(String::from_utf8_lossy(&search.stdout).contains("discovery"));
    let unknown = run(&["guide", "missing", "overview"]);
    assert!(!unknown.status.success());
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("unknown guide document"));
    assert!(!root.join("missing-home").exists());
    assert!(!root.join("missing-config").exists());
    std::fs::remove_dir_all(root).unwrap();
}
