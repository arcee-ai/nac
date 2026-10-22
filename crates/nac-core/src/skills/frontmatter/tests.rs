use super::parse_frontmatter;

#[test]
fn quoted_multiline_and_ignored_metadata_remain_compatible() {
    let parsed = parse_frontmatter(
        "# header\nname: 'sample'\ndescription: |\n  first line\n  second line\ncompatibility: >-\n  Linux and\n  macOS\nlicense: MIT\nmetadata: {nested: [one, two]}\n",
    )
    .unwrap();
    assert_eq!(parsed.name, "sample");
    assert_eq!(
        parsed.description.as_deref(),
        Some("first line\nsecond line\n")
    );
    assert_eq!(parsed.compatibility.as_deref(), Some("Linux and macOS"));
}

#[test]
fn aliases_and_explicit_string_tags_preserve_strings() {
    let parsed =
        parse_frontmatter("name: &name sample\ndescription: *name\ncompatibility: !!str true\n")
            .unwrap();
    assert_eq!(parsed.name, "sample");
    assert_eq!(parsed.description.as_deref(), Some("sample"));
    assert_eq!(parsed.compatibility.as_deref(), Some("true"));
}

#[test]
fn scalar_strings_and_colon_repair_preserve_existing_input() {
    for value in ["true", "false", "123", "yes", "2026-10-21", "*undefined"] {
        let parsed = parse_frontmatter(&format!("name: sample\ndescription: {value}\n")).unwrap();
        assert_eq!(parsed.description.as_deref(), Some(value));
    }
    let parsed = parse_frontmatter("name: sample\ndescription: Use foo: bar\n").unwrap();
    assert_eq!(parsed.description.as_deref(), Some("Use foo: bar"));
    let parsed = parse_frontmatter("name: sample\ndescription: null\n").unwrap();
    assert_eq!(parsed.description, None);
}

#[test]
fn missing_and_invalid_fields_keep_existing_rejection() {
    for raw in [
        "description: sample\n",
        "name: [one, two]\ndescription: sample\n",
        "name: sample\ndescription: [one, two]\n",
        "name: sample\ndescription: \"unterminated\n",
        "name: sample\nname: duplicate\ndescription: sample\n",
    ] {
        assert!(parse_frontmatter(raw).is_err(), "accepted {raw:?}");
    }
    let parsed = parse_frontmatter("name: sample\n").unwrap();
    assert_eq!(parsed.description, None);
}

#[test]
fn excessive_nesting_is_rejected_without_panicking() {
    let raw = format!(
        "name: sample\ndescription: sample\nmetadata: {}0{}\n",
        "[".repeat(1024),
        "]".repeat(1024)
    );
    assert!(parse_frontmatter(&raw).is_err());
}
