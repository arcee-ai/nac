use super::*;

#[derive(Clone)]
pub struct SkillRegistry {
    skills: Arc<HashMap<String, SkillRecord>>,
}

impl SkillRegistry {
    pub fn load(
        workspace_dir: Option<&Path>,
        sandbox: Option<&SandboxSession>,
    ) -> Result<Option<Arc<Self>>> {
        let sources = discover_skill_sources(workspace_dir)?;
        if sources.is_empty() {
            return Ok(None);
        }

        let mut skills = HashMap::new();
        let mut shadowed = HashSet::new();

        for source in sources {
            let visible_root = match visible_root_for_source(&source, sandbox) {
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
                let skill_root_visible = join_path(&visible_root, relative);
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

    pub fn activate(&self, name: &str) -> ToolResult {
        let Some(skill) = self.skills.get(name) else {
            return ToolResult {
                content: format!("Error: unknown skill '{}'", name),
                is_error: true,
            };
        };

        let mut content = format!("<skill_content name=\"{}\">\n", escape_xml(&skill.name));
        if let Some(compatibility) = &skill.compatibility {
            content.push_str(&format!("Compatibility: {}\n\n", compatibility));
        }
        content.push_str(&skill.body);
        if !skill.body.ends_with('\n') {
            content.push('\n');
        }
        content.push('\n');

        content.push_str(&format!(
            "Skill directory: {}\n",
            skill.skill_root_visible.display()
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

        ToolResult {
            content,
            is_error: false,
        }
    }
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
