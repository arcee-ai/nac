use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct SkillFrontmatter {
    pub(super) name: String,
    pub(super) description: Option<String>,
    pub(super) compatibility: Option<String>,
}

pub(super) struct ParsedSkillFile {
    pub(super) name: String,
    pub(super) description: String,
    pub(super) compatibility: Option<String>,
    pub(super) body: String,
}

pub(super) fn parse_skill_file(path: &Path) -> Result<Option<ParsedSkillFile>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read skill file '{}'", path.display()))?;
    let Some((frontmatter_raw, body_raw)) = split_frontmatter(&raw) else {
        eprintln!(
            "Skill file '{}' is missing YAML frontmatter and will be skipped",
            path.display()
        );
        return Ok(None);
    };

    let frontmatter = match parse_frontmatter(frontmatter_raw) {
        Ok(frontmatter) => frontmatter,
        Err(error) => {
            eprintln!(
                "Skill file '{}' has invalid frontmatter and will be skipped: {:#}",
                path.display(),
                error
            );
            return Ok(None);
        }
    };

    let name = frontmatter.name.trim().to_string();
    if name.is_empty() {
        eprintln!(
            "Skill file '{}' has an empty name and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    if let Some(parent) = path
        .parent()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
    {
        if parent != name {
            eprintln!(
                "Skill '{}' in '{}' does not match parent directory name '{}'; loading anyway",
                name,
                path.display(),
                parent
            );
        }
    }

    let Some(description) = frontmatter
        .description
        .map(|value| value.trim().to_string())
    else {
        eprintln!(
            "Skill file '{}' is missing a description and will be skipped",
            path.display()
        );
        return Ok(None);
    };
    if description.is_empty() {
        eprintln!(
            "Skill file '{}' has an empty description and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    let body = body_raw.trim().to_string();
    if body.is_empty() {
        eprintln!(
            "Skill file '{}' has no body content and will be skipped",
            path.display()
        );
        return Ok(None);
    }

    Ok(Some(ParsedSkillFile {
        name,
        description,
        compatibility: frontmatter
            .compatibility
            .map(|value| value.trim().to_string()),
        body,
    }))
}

pub(super) fn parse_frontmatter(raw: &str) -> Result<SkillFrontmatter> {
    match serde_yaml_ng::from_str(raw) {
        Ok(frontmatter) => Ok(frontmatter),
        Err(_) => {
            let repaired = repair_frontmatter(raw);
            serde_yaml_ng::from_str(&repaired).map_err(|error| anyhow!(error))
        }
    }
}

fn repair_frontmatter(raw: &str) -> String {
    let mut repaired = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            repaired.push(line.to_string());
            continue;
        }

        let Some((key, value)) = line.split_once(':') else {
            repaired.push(line.to_string());
            continue;
        };
        let key_trimmed = key.trim();
        let value_trimmed = value.trim();
        if !matches!(
            key_trimmed,
            "name" | "description" | "compatibility" | "license"
        ) {
            repaired.push(line.to_string());
            continue;
        }
        if value_trimmed.is_empty()
            || value_trimmed.starts_with('"')
            || value_trimmed.starts_with('\'')
            || value_trimmed.starts_with('[')
            || value_trimmed.starts_with('{')
            || value_trimmed.starts_with('|')
            || value_trimmed.starts_with('>')
        {
            repaired.push(line.to_string());
            continue;
        }

        repaired.push(format!(
            "{}: {}",
            key_trimmed,
            serde_json::to_string(value_trimmed).unwrap_or_else(|_| "\"\"".to_string())
        ));
    }
    repaired.join("\n")
}

fn split_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.strip_prefix("---\n")?;
    let end = rest.find("\n---\n")?;
    let frontmatter = &rest[..end];
    let body = &rest[end + 5..];
    Some((frontmatter, body))
}
