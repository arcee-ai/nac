use super::*;

pub(super) enum ParsedShell {
    Supported(Vec<Vec<String>>),
    Opaque,
}

pub(super) fn parse_shell(command: &str) -> ParsedShell {
    if contains_opaque_shell_syntax(command) {
        return ParsedShell::Opaque;
    }
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut word = String::new();
    let mut word_started = false;
    let mut quote = None;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if escaped {
            if current != '\n' {
                word.push(current);
                word_started = true;
            }
            escaped = false;
            index += 1;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            if quote == Some('"')
                && !chars
                    .get(index + 1)
                    .is_some_and(|next| matches!(next, '$' | '`' | '"' | '\\' | '\n'))
            {
                word.push(current);
                word_started = true;
                index += 1;
                continue;
            }
            escaped = true;
            index += 1;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                word.push(current);
            }
            index += 1;
            continue;
        }
        if current == '\'' || current == '"' {
            quote = Some(current);
            word_started = true;
            index += 1;
            continue;
        }
        if current.is_whitespace() {
            push_word(&mut segment, &mut word, &mut word_started);
            index += 1;
            continue;
        }
        let boundary = match current {
            '|' | '&' if chars.get(index + 1) == Some(&current) => 2,
            ';' | '\n' | '|' | '&' => 1,
            _ => 0,
        };
        if boundary > 0 {
            push_word(&mut segment, &mut word, &mut word_started);
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
            index += boundary;
            continue;
        }
        word.push(current);
        word_started = true;
        index += 1;
    }
    if escaped || quote.is_some() {
        return ParsedShell::Opaque;
    }
    push_word(&mut segment, &mut word, &mut word_started);
    if !segment.is_empty() {
        segments.push(segment);
    }
    if segments.is_empty() {
        ParsedShell::Opaque
    } else {
        ParsedShell::Supported(segments)
    }
}

pub(super) fn contains_opaque_shell_syntax(command: &str) -> bool {
    let mut quote = None;
    let mut escaped = false;
    for current in command.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else if matches!(current, '$' | '`') {
                return true;
            }
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            continue;
        }
        if matches!(
            current,
            '$' | '`' | '<' | '>' | '(' | ')' | '{' | '}' | '*' | '?' | '['
        ) {
            return true;
        }
    }
    false
}

fn push_word(segment: &mut Vec<String>, word: &mut String, word_started: &mut bool) {
    if *word_started {
        segment.push(std::mem::take(word));
        *word_started = false;
    }
}

pub(super) fn canonical_command(tokens: &[String]) -> String {
    let mut canonical = String::from("command:");
    for token in tokens {
        canonical.push('[');
        for byte in token.bytes() {
            if byte.is_ascii_alphanumeric() || b"._/-".contains(&byte) {
                canonical.push(char::from(byte));
            } else {
                canonical.push_str(&format!("%{byte:02X}"));
            }
        }
        canonical.push(']');
    }
    canonical
}

pub(super) fn command_grant_candidate(tokens: &[String]) -> String {
    const BANNED: &[&str] = &[
        "bash", "bun", "dash", "deno", "env", "fish", "node", "nodejs", "npm", "perl", "php",
        "pnpm", "python", "python3", "rm", "ruby", "sh", "sudo", "yarn", "zsh",
    ];
    let command = effective_command_tokens(tokens)
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let contains_banned_wrapper = tokens.iter().any(|token| {
        token
            .rsplit('/')
            .next()
            .is_some_and(|token| BANNED.contains(&token.to_ascii_lowercase().as_str()))
    });
    if tokens.is_empty()
        || BANNED.contains(&command.as_str())
        || contains_banned_wrapper
        || shell_control_prefix(tokens)
        || is_broad_command(tokens)
    {
        return canonical_command(tokens);
    }
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let width = if command == "git" {
        let Some(subcommand_index) = git_subcommand_index(tokens, command_index) else {
            return canonical_command(tokens);
        };
        subcommand_index + 1
    } else {
        tokens.len().min(2)
    };
    format!("{}*", canonical_command(&tokens[..width]))
}
