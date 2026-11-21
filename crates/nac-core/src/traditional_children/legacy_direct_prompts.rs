//! Exact shipped direct system heads, retained only to decode older transcripts.
//! File names identify the commit that last changed each template. New prompts
//! use the current renderer; do not extend this list for unrelated prompt text.

pub(super) const TEMPLATES: &[&str] = &[
    include_str!("legacy_direct_prompts/c9a4326cde.md"),
    include_str!("legacy_direct_prompts/a0e808bf76.md"),
    include_str!("legacy_direct_prompts/799ad22222.md"),
    include_str!("legacy_direct_prompts/c84cc3d29c.md"),
    include_str!("legacy_direct_prompts/588dd423f7.md"),
    include_str!("legacy_direct_prompts/adead58b82.md"),
    include_str!("legacy_direct_prompts/c3583781e8.md"),
    include_str!("legacy_direct_prompts/af6bedd772.md"),
    include_str!("legacy_direct_prompts/2cf76a914e.md"),
    include_str!("legacy_direct_prompts/b4c2a1fff9.md"),
    include_str!("legacy_direct_prompts/5944b74b9c.md"),
    include_str!("legacy_direct_prompts/9455b5b76e.md"),
    include_str!("legacy_direct_prompts/6a4645f0d5.md"),
];

pub(super) fn instruction_suffix<'a>(system: &'a str, working_directory: &str) -> Option<&'a str> {
    // Longer heads precede shorter ones: an older head can be a prefix of a
    // later one, and its extra native guidance must not become child guidance.
    for template in TEMPLATES {
        let base = template.replacen("{working_directory}", working_directory, 1);
        if let Some(suffix) = system.strip_prefix(&base) {
            return Some(suffix);
        }
    }
    None
}
