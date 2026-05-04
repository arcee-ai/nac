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
                    skill_md_path,
                    skill_root_host: skill_dir.clone(),
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

    pub fn tool_definition(&self) -> ToolDefinition {
        let mut names: Vec<String> = self.skills.keys().cloned().collect();
        names.sort();
        ToolDefinition {
            def_type: "function".to_string(),
            function: FunctionDef {
                name: "activate_skill".to_string(),
                description:
                    "Load the full instructions for an available skill by name before proceeding."
                        .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "enum": names,
                            "description": "Name of the skill to activate"
                        }
                    },
                    "required": ["name"]
                }),
            },
        }
    }

    pub fn catalog_message(&self) -> Option<String> {
        let catalog = self.catalog_entries();
        if catalog.is_empty() {
            return None;
        }

        let mut content = String::from(
            "The following skills provide specialized instructions for specific tasks. \
             When a task clearly matches a skill's description, call activate_skill(name) \
             before proceeding. After activation, follow the returned instructions and \
             resolve any relative paths against the returned skill directory.\n\n<available_skills>",
        );

        for entry in catalog {
            content.push_str("\n  <skill>");
            content.push_str(&format!("\n    <name>{}</name>", escape_xml(&entry.name)));
            content.push_str(&format!(
                "\n    <description>{}</description>",
                escape_xml(&entry.description)
            ));
            if let Some(compatibility) = entry.compatibility {
                content.push_str(&format!(
                    "\n    <compatibility>{}</compatibility>",
                    escape_xml(&compatibility)
                ));
            }
            content.push_str("\n  </skill>");
        }
        content.push_str("\n</available_skills>");
        Some(content)
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

    pub fn activate(&self, name: &str, already_active: bool) -> ToolResult {
        let Some(skill) = self.skills.get(name) else {
            return ToolResult {
                content: format!("Error: unknown skill '{}'", name),
                is_error: true,
            };
        };

        let mut content = String::new();
        if already_active {
            content.push_str(&format!(
                "<skill_content name=\"{}\" already_active=\"true\">\n",
                escape_xml(&skill.name)
            ));
            content.push_str(
                "This skill is already active in the current conversation, so its instructions are not being re-injected.\n\n",
            );
        } else {
            content.push_str(&format!(
                "<skill_content name=\"{}\">\n",
                escape_xml(&skill.name)
            ));
            if let Some(compatibility) = &skill.compatibility {
                content.push_str(&format!("Compatibility: {}\n\n", compatibility));
            }
            content.push_str(&skill.body);
            if !skill.body.ends_with('\n') {
                content.push('\n');
            }
            content.push('\n');
        }

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
