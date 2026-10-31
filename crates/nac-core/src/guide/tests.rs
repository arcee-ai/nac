use super::*;

#[test]
fn installed_pack_is_bounded_and_grounded_without_a_checkout() {
    let guide = bundled().unwrap();
    for (question, expected) in [
        ("How do I add MCP?", "mcp"),
        ("Where are my skills?", "skills"),
        (
            "What does direct-with-orchestrator mean?",
            "session-behaviors",
        ),
        ("Why can't this subagent search?", "web-retrieval"),
    ] {
        let hits = guide.search(question, 5).unwrap();
        assert!(
            hits.iter().any(|hit| hit.document_id == expected),
            "{question}"
        );
        assert!(hits.iter().all(|hit| hit.excerpt.len() <= 512));
    }
    let section = guide.read("skills", "discovery", 0, 1024).unwrap();
    assert!(section.text.contains(".nac/skills"));
    assert!(section.text.len() <= 1024);
    assert_eq!(section.reference.document_id, "skills");
    assert_eq!(section.reference.section_id.as_deref(), Some("discovery"));
}

#[test]
fn malformed_unknown_old_and_missing_packs_fail_deterministically() {
    assert!(GuidePack::parse("").is_err());
    let raw = include_str!("pack.json");
    assert!(
        GuidePack::parse(&raw.replacen("\"schema_version\": 1", "\"schema_version\": 0", 1))
            .is_err()
    );
    let guide = bundled().unwrap();
    assert!(guide.read("../etc/passwd", "overview", 0, 100).is_err());
    assert!(guide.read("skills", "missing", 0, 100).is_err());
    assert!(guide.search(&"x".repeat(513), 5).is_err());
    assert!(guide.search("skills", 21).is_err());
    assert!(guide.read("skills", "discovery", usize::MAX, 100).is_err());
    assert!(guide.read("skills", "discovery", 0, 6001).is_err());
    assert!(guide
        .search("quux_unpublished_feature", 5)
        .unwrap()
        .is_empty());
}

#[test]
fn immutable_pack_survives_reload_and_detects_tampering_and_duplicate_refs() {
    let raw = include_str!("pack.json");
    let one = GuidePack::parse(raw).unwrap();
    let two = GuidePack::parse(raw).unwrap();
    assert_eq!(one.fingerprint, two.fingerprint);
    assert_eq!(
        one.read("skills", "discovery", 0, 1024).unwrap(),
        two.read("skills", "discovery", 0, 1024).unwrap()
    );
    let mut changed: serde_json::Value = serde_json::from_str(raw).unwrap();
    changed["documents"][0]["sections"][0]["text"] = "tampered".into();
    assert!(GuidePack::parse(&changed.to_string()).is_err());
    let mut duplicate: serde_json::Value = serde_json::from_str(raw).unwrap();
    let first = duplicate["documents"][0].clone();
    duplicate["documents"].as_array_mut().unwrap().push(first);
    assert!(GuidePack::parse(&duplicate.to_string()).is_err());
    let mut duplicate_section: serde_json::Value = serde_json::from_str(raw).unwrap();
    let first = duplicate_section["documents"][0]["sections"][0].clone();
    duplicate_section["documents"][0]["sections"]
        .as_array_mut()
        .unwrap()
        .push(first);
    assert!(GuidePack::parse(&duplicate_section.to_string()).is_err());
}

#[test]
fn paged_reads_preserve_utf8_and_the_exact_canonical_section() {
    let guide = bundled().unwrap();
    let doc = guide.document("session-behaviors").unwrap();
    let section = &doc.sections[0];
    let mut text = String::new();
    let mut offset = 0;
    loop {
        let page = guide
            .read(&doc.document_id, &section.section_id, offset, 128)
            .unwrap();
        assert!(page.text.len() <= 128);
        text.push_str(&page.text);
        match page.next_offset {
            Some(next) => {
                assert!(next > offset);
                offset = next;
            }
            None => break,
        }
    }
    assert_eq!(text, section.text);
    let unicode = section
        .text
        .char_indices()
        .find(|(_, value)| !value.is_ascii())
        .unwrap()
        .0;
    assert!(guide
        .read(&doc.document_id, &section.section_id, unicode + 1, 128)
        .is_err());
}
