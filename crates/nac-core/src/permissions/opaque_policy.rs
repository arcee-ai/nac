use super::*;

pub(super) fn opaque_hard_shell_denial(
    command: &str,
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Option<String> {
    if contains_unquoted_shell_redirection(command) {
        return Some(
            "opaque shell redirection is blocked because its path targets cannot be independently authorized"
                .to_string(),
        );
    }
    if raw_shell_control_syntax(command) {
        return Some(
            "shell control syntax is blocked because it can hide protected commands".to_string(),
        );
    }
    let segments = opaque_shell_segments(command);
    if segments.iter().any(|tokens| {
        effective_command_tokens(tokens)
            .first()
            .is_some_and(|token| dynamic_shell_command_name(token))
    }) {
        return Some(
            "dynamic command names are blocked because expansion can become a protected command"
                .to_string(),
        );
    }
    if segments
        .iter()
        .any(|tokens| dynamic_deletion_command(tokens))
    {
        return Some(
            "dynamic deletion operands are blocked because protected targets cannot be resolved before execution"
                .to_string(),
        );
    }
    let tokens = opaque_literal_tokens(command);
    if command.contains('$') && literal_env_split_string(&tokens).is_some() {
        return Some("dynamic env split-string expansion is blocked".to_string());
    }
    if tokens.iter().any(|token| {
        let path = Path::new(token);
        looks_like_shell_path(token)
            && path_contains_component(
                &if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    cwd.join(path)
                },
                ".git",
            )
    }) {
        return Some(
            "opaque shell access to Git metadata is blocked; use a supported non-destructive command"
                .to_string(),
        );
    }
    for segment in &segments {
        if let Some(reason) = hard_shell_denial(segment, cwd, backend) {
            return Some(reason);
        }
    }
    None
}

pub(super) fn contains_unquoted_shell_redirection(command: &str) -> bool {
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
            }
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            continue;
        }
        if matches!(current, '<' | '>') {
            return true;
        }
    }
    false
}

pub(super) fn dynamic_shell_command_name(token: &str) -> bool {
    let expandable_character = token
        .chars()
        .any(|character| matches!(character, '$' | '`' | '{' | '}' | '*' | '?'));
    expandable_character && !matches!(token, "{" | "}")
        || token.contains('[') && token != "[" && !token.starts_with("[[")
}

pub(super) fn dynamic_deletion_command(tokens: &[String]) -> bool {
    let mut effective = effective_command_tokens(tokens);
    if effective
        .first()
        .is_some_and(|token| token.eq_ignore_ascii_case("time"))
    {
        effective = &effective[1..];
        while effective
            .first()
            .is_some_and(|token| token.starts_with('-'))
        {
            effective = &effective[1..];
        }
    }
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(command.as_str(), "rm" | "rmdir" | "unlink")
        && effective.iter().skip(1).any(|token| {
            token
                .chars()
                .any(|character| matches!(character, '$' | '`' | '*' | '?' | '[' | '{' | '}'))
        })
    {
        return true;
    }
    if command == "xargs" {
        return xargs_command_tokens(effective)
            .ok()
            .flatten()
            .is_some_and(dynamic_deletion_command);
    }
    if command == "find" && find_exec_commands(effective).any(dynamic_deletion_command) {
        return true;
    }
    if matches!(command.as_str(), "bash" | "dash" | "fish" | "sh" | "zsh") {
        if let Some(body) = literal_shell_command_body(effective) {
            return opaque_shell_segments(body)
                .iter()
                .any(|tokens| dynamic_deletion_command(tokens));
        }
    }
    false
}

/// Tokenize opaque input just far enough to identify the literal command in
/// each shell segment. Expansions remain marked in their containing word; no
/// value is expanded and quoted data cannot become a command position.
pub(super) fn opaque_shell_segments(command: &str) -> Vec<Vec<String>> {
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;
    let finish_word = |segment: &mut Vec<String>, word: &mut String| {
        if !word.is_empty() {
            segment.push(std::mem::take(word));
        }
    };
    let finish_segment = |segments: &mut Vec<Vec<String>>, segment: &mut Vec<String>| {
        if !segment.is_empty() {
            segments.push(std::mem::take(segment));
        }
    };
    while index < chars.len() {
        let current = chars[index];
        if escaped {
            if current != '\n' {
                word.push(current);
            }
            escaped = false;
            index += 1;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
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
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            index += 1;
            continue;
        }
        if current == '#' && word.is_empty() {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            finish_segment(&mut segments, &mut segment);
            continue;
        }
        if current.is_whitespace() {
            finish_word(&mut segment, &mut word);
            if current == '\n' {
                finish_segment(&mut segments, &mut segment);
            }
            index += 1;
            continue;
        }
        if matches!(current, ';' | '|' | '&') {
            finish_word(&mut segment, &mut word);
            finish_segment(&mut segments, &mut segment);
            index += 1;
            if index < chars.len() && chars[index] == current {
                index += 1;
            }
            continue;
        }
        word.push(current);
        index += 1;
    }
    finish_word(&mut segment, &mut word);
    finish_segment(&mut segments, &mut segment);
    segments
}

pub(super) fn raw_shell_control_syntax(command: &str) -> bool {
    fn is_control_keyword(word: &str) -> bool {
        matches!(
            word.to_ascii_lowercase().as_str(),
            "coproc"
                | "if"
                | "then"
                | "else"
                | "elif"
                | "fi"
                | "for"
                | "while"
                | "until"
                | "do"
                | "done"
                | "case"
                | "esac"
                | "select"
                | "function"
                | "[["
                | "]]"
        )
    }

    fn finish_word(word: &mut String, command_position: &mut bool, time_prefix: &mut bool) -> bool {
        if word.is_empty() {
            return false;
        }
        let control = *command_position && is_control_keyword(word);
        // `time` is itself shell grammar and leaves the following word in a
        // command position, including options and a following `!` word.
        if *command_position && word.eq_ignore_ascii_case("time") {
            *time_prefix = true;
        } else if !(*command_position && *time_prefix && word.starts_with('-')) {
            *command_position = false;
            *time_prefix = false;
        }
        word.clear();
        control
    }

    let mut chars = command.chars().peekable();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut command_position = true;
    let mut time_prefix = false;
    while let Some(current) = chars.next() {
        if escaped {
            if current != '\n' {
                word.push(current);
            }
            escaped = false;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else if active == '"'
                && (current == '`' || current == '$' && chars.peek() == Some(&'('))
            {
                // Command substitutions remain executable inside double
                // quotes, so opaque parsing must fail closed on them.
                return true;
            }
            continue;
        }
        if current == '\\' {
            escaped = true;
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            word.push('q');
            continue;
        }
        if current == '$' && chars.peek() == Some(&'(') || current == '`' {
            return true;
        }
        if current == '#' && word.is_empty() {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            for comment in chars.by_ref() {
                if comment == '\n' {
                    command_position = true;
                    time_prefix = false;
                    break;
                }
            }
            continue;
        }
        if current.is_whitespace() {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            if current == '\n' {
                command_position = true;
                time_prefix = false;
            }
            continue;
        }
        if matches!(current, ';' | '|' | '&') {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            command_position = true;
            time_prefix = false;
            continue;
        }
        if matches!(current, '(' | ')') {
            // Parentheses outside quotes are shell grouping, function, or
            // substitution syntax. All are opaque executable structure.
            return true;
        }
        if matches!(current, '!' | '{' | '}') && word.is_empty() && command_position {
            let boundary = chars.peek().is_none_or(|next| {
                next.is_whitespace() || matches!(next, ';' | '|' | '&' | '(' | ')')
            });
            if boundary {
                return true;
            }
        }
        word.push(current);
    }
    finish_word(&mut word, &mut command_position, &mut time_prefix)
}

pub(super) fn opaque_literal_tokens(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for current in command.chars() {
        if escaped {
            if current != '\n' {
                word.push(current);
            }
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
            } else {
                word.push(current);
            }
            continue;
        }
        if current == '\'' || current == '"' {
            quote = Some(current);
        } else if current.is_ascii_alphanumeric() || "_./~-".contains(current) {
            word.push(current);
        } else if !word.is_empty() {
            tokens.push(std::mem::take(&mut word));
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    tokens
}

pub(super) fn removes_protected_root(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
) -> bool {
    let recursive = tokens
        .iter()
        .skip(1)
        .filter(|token| token.starts_with('-'))
        .any(|flags| {
            flags == "--recursive"
                || flags
                    .strip_prefix('-')
                    .is_some_and(|flags| flags.contains('r') || flags.contains('R'))
        });
    if !recursive {
        return false;
    }
    let workspace = lexical_normalize(&backend.default_terminal_cwd());
    tokens
        .iter()
        .skip(1)
        .filter(|token| !token.starts_with('-'))
        .map(Path::new)
        .map(|target| {
            if target.is_absolute() {
                lexical_normalize(target)
            } else {
                lexical_normalize(&cwd.join(target))
            }
        })
        .any(|target| {
            target == Path::new("/")
                || target == workspace
                || path_contains_component(&target, ".git")
        })
}
