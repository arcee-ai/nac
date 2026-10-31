use super::*;

#[test]
fn fresh_and_hidden_registries_ship_official_help() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = tests::temp_dir("bundled");
    let _env = tests::isolate_user_skill_env(&root);
    for visibility in [SkillPathVisibility::Visible, SkillPathVisibility::Hidden] {
        let registry = SkillRegistry::load(None, visibility, &PathContext::new(&root))
            .unwrap()
            .unwrap();
        let entry = registry
            .catalog_entries()
            .into_iter()
            .find(|entry| entry.name == "nac-help")
            .unwrap();
        assert!(entry.description.contains("NAC Guide"));
        let content = registry.activate("nac-help").content;
        assert!(content.contains("Source: first-party bundled NAC Guide"));
        assert!(content.contains("nac_guide"));
        assert!(!content.contains("Skill directory:"));
        let expanded =
            crate::commands::expand_user_prompt("$nac-help How do I add MCP?", Some(&registry));
        assert!(expanded.contains("first-party bundled NAC Guide"));
        assert_eq!(
            crate::commands::display_prompt_from_message(&expanded),
            "$nac-help How do I add MCP?"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn project_skill_cannot_replace_official_help_and_other_precedence_is_preserved() {
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let root = tests::temp_dir("bundled_collision");
    let _env = tests::isolate_user_skill_env(&root);
    let repo = root.join("repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    tests::write_skill(
        &repo.join(".nac/skills"),
        "nac-help",
        "spoof official",
        "spoofed guide",
    );
    tests::write_skill(
        &repo.join(".nac/skills"),
        "nac-help How",
        "spoof prefix",
        "spoofed prefix",
    );
    tests::write_skill(
        &repo.join(".nac/skills"),
        "nac-help?",
        "spoof punctuation",
        "spoofed punctuation",
    );
    tests::write_skill(
        &repo.join(".nac/skills"),
        "lint",
        "project lint",
        "project body",
    );
    tests::write_skill(
        &root.join("home/.config/nac/skills"),
        "lint",
        "user lint",
        "user body",
    );
    let registry = SkillRegistry::load(
        Some(&repo),
        SkillPathVisibility::Visible,
        &PathContext::new(&repo),
    )
    .unwrap()
    .unwrap();
    assert!(!registry.activate("nac-help").content.contains("spoof"));
    let expanded =
        crate::commands::expand_user_prompt("$nac-help How do I add MCP?", Some(&registry));
    assert!(!expanded.contains("spoofed"));
    assert!(expanded.contains("first-party bundled NAC Guide"));
    assert!(registry.activate("lint").content.contains("project body"));
    assert_eq!(
        registry
            .catalog_entries()
            .iter()
            .filter(|entry| entry.name == "nac-help")
            .count(),
        1
    );
    fs::remove_dir_all(root).unwrap();
}
