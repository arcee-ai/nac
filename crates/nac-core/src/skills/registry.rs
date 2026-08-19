use super::*;

#[derive(Clone)]
pub struct SkillRegistry {
    skills: Arc<HashMap<String, SkillRecord>>,
}

impl SkillRegistry {
    pub fn load(
        workspace_dir: Option<&Path>,
        visibility: SkillPathVisibility,
        paths: &PathContext,
    ) -> Result<Option<Arc<Self>>> {
        let sources = discover_skill_sources(workspace_dir, paths)?;
        if sources.is_empty() {
            return Ok(None);
        }

        let mut skills = HashMap::new();
        let mut shadowed = HashSet::new();

        for source in sources {
            let visible_root = match visible_root_for_source(&source, visibility) {
                Some(path) => path,
                None => continue,
            };
            for skill_dir in discover_skill_dirs(&source.host_root)? {
                let skill_md_path = skill_dir.join(SKILL_FILENAME);
                let Some(parsed) = parse_skill_file(&skill_md_path)? else {
                    continue;
                };

                let relative = skill_dir
                    .strip_prefix(&source.host_root)
                    .unwrap_or_else(|_| Path::new(""));
                let skill_root_visible = if visibility == SkillPathVisibility::Hidden {
                    PathBuf::from("[filepath-not-visible]")
                } else {
                    join_path(&visible_root, relative)
                };
                let record = SkillRecord {
                    name: parsed.name.clone(),
                    description: parsed.description,
                    compatibility: parsed.compatibility,
                    skill_root_visible,
                    body: parsed.body,
                    resources: list_skill_resources(&skill_dir)?,
                };

                if skills.contains_key(&parsed.name) {
                    shadowed.insert(parsed.name);
                    continue;
                }
                if is_env_var_style_name(&parsed.name) {
                    eprintln!(
                        "Skill '{}' has an env-var-style name; writing '${}' in a prompt will expand this skill",
                        parsed.name, parsed.name
                    );
                }
                skills.insert(parsed.name.clone(), record);
            }
        }

        for name in shadowed {
            eprintln!(
                "Skill '{}' is shadowed by a higher-precedence definition",
                name
            );
        }

        if skills.is_empty() {
            return Ok(None);
        }

        Ok(Some(Arc::new(Self {
            skills: Arc::new(skills),
        })))
    }

    pub fn catalog_entries(&self) -> Vec<SkillCatalogEntry> {
        let mut entries: Vec<SkillCatalogEntry> = self
            .skills
            .values()
            .map(|skill| SkillCatalogEntry {
                name: skill.name.clone(),
                description: skill.description.clone(),
                compatibility: skill.compatibility.clone(),
            })
            .collect();
        entries.sort_by(|left, right| left.name.cmp(&right.name));
        entries
    }

    pub fn has_skill(&self, name: &str) -> bool {
        self.skills.contains_key(name)
    }

    /// Returns the longest registered skill name that begins `input` and ends
    /// at a reference boundary. Registry names are matched literally instead
    /// of being constrained by a second, prompt-specific name grammar.
    pub(crate) fn match_prompt_reference<'a>(&'a self, input: &str) -> Option<&'a str> {
        self.skills
            .keys()
            .filter_map(|name| {
                let remainder = input.strip_prefix(name)?;
                let is_boundary = match remainder.chars().next() {
                    Some(character) => {
                        !character.is_alphanumeric() && character != '_' && character != '-'
                    }
                    None => true,
                };
                is_boundary.then_some(name.as_str())
            })
            .max_by_key(|name| name.len())
    }

    pub fn activate(&self, name: &str) -> ToolResult {
        let Some(content) = self.render_for_prompt(name) else {
            return ToolResult {
                content: (format!("Error: unknown skill '{}'", name)).into(),
                is_error: true,
            };
        };

        ToolResult {
            content: content.into(),
            is_error: false,
        }
    }

    /// Renders the skill in the `<skill_content>` format for injection into
    /// a user prompt, or `None` when the name is not registered. This is the
    /// exact rendering `activate` returns, so a `$skill` prompt expansion
    /// reads identically to a tool activation.
    pub(crate) fn render_for_prompt(&self, name: &str) -> Option<String> {
        let skill = self.skills.get(name)?;

        let mut content = format!("<skill_content name=\"{}\">\n", escape_xml(&skill.name));
        if let Some(compatibility) = &skill.compatibility {
            content.push_str(&format!(
                "Compatibility: {}\n\n",
                neutralize_prompt_markup(compatibility)
            ));
        }
        content.push_str(&neutralize_prompt_markup(&skill.body));
        if !skill.body.ends_with('\n') {
            content.push('\n');
        }
        content.push('\n');

        content.push_str(&format!(
            "Skill directory: {}\n",
            neutralize_prompt_markup(&skill.skill_root_visible.display().to_string())
        ));
        content.push_str("Relative paths in this skill are relative to the skill directory.\n");
        if !skill.resources.is_empty() {
            content.push_str("<skill_resources>\n");
            for resource in &skill.resources {
                content.push_str(&format!("  <file>{}</file>\n", escape_xml(resource)));
            }
            content.push_str("</skill_resources>\n");
        }
        content.push_str("</skill_content>");

        Some(content)
    }
}

/// Env-var-style names — all uppercase letters, digits, and underscores
/// (`HOME`, `PATH`, `VIRTUAL_ENV`), including all-digit names (`5`) —
/// collide with shell syntax: `$HOME` in a prompt is indistinguishable
/// from a skill reference, and the registered skill wins. Loading still
/// succeeds; the registry warns at load time so the collision is visible
/// to whoever installed the skill.
pub(super) fn is_env_var_style_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Skill-controlled text (body, compatibility, and the on-disk skill
/// directory path — a directory name may legally contain newlines and
/// markup) is inserted into prompts raw, so it must not be able to forge
/// the markup the prompt pipeline treats structurally. A literal
/// `<invoked_skills>` sentinel in a skill body would corrupt the
/// expand/collapse round trip: collapse truncates at the last separator,
/// so a forged one makes display/resend show text the user never typed
/// and makes re-expansion nest wrappers. Forged `<skill_content>` tags
/// would fake block boundaries. Neutralize exactly those sequences by
/// escaping their angle brackets — the same convention `escape_xml` uses
/// for names and resource paths — and leave every other byte untouched.
/// This rendering also backs `activate`, so tool activation and prompt
/// expansion stay byte-identical.
fn neutralize_prompt_markup(value: &str) -> String {
    value
        .replace("<invoked_skills>", "&lt;invoked_skills&gt;")
        .replace("</invoked_skills>", "&lt;/invoked_skills&gt;")
        .replace("</skill_content>", "&lt;/skill_content&gt;")
        .replace("<skill_content", "&lt;skill_content")
}

#[cfg(test)]
impl SkillRegistry {
    pub(crate) fn load_for_test(records: Vec<SkillRecord>) -> Self {
        let skills = records
            .into_iter()
            .map(|record| (record.name.clone(), record))
            .collect();
        Self {
            skills: Arc::new(skills),
        }
    }
}
