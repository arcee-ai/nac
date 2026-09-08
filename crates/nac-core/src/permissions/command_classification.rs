use super::*;

pub(super) fn is_broad_command(tokens: &[String]) -> bool {
    is_broad_command_inner(tokens, 0)
}

pub(super) fn is_broad_command_inner(tokens: &[String], depth: usize) -> bool {
    const BROAD: &[&str] = &[
        "bash", "bun", "dash", "deno", "fish", "node", "nodejs", "npm", "perl", "php", "pnpm",
        "python", "python3", "ruby", "sh", "yarn", "zsh",
    ];
    if depth < 8 {
        if let Ok(Some(expanded)) = expanded_env_split_tokens(tokens) {
            if is_broad_command_inner(&expanded, depth + 1) {
                return true;
            }
        }
    }
    let effective = effective_command_tokens(tokens);
    let command_is_broad = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| {
            let command = command.to_ascii_lowercase();
            BROAD.contains(&command.as_str())
                || command.starts_with("python3.")
                || command.starts_with("node-")
                || command == "xargs"
                || command == "find" && find_exec_commands(effective).next().is_some()
        });
    command_is_broad
        || project_code_command(effective)
        || cargo_configuration(effective)
        || embedded_command_body(effective).is_some()
}

pub(super) fn project_code_command(tokens: &[String]) -> bool {
    tokens
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| {
            matches!(
                command.to_ascii_lowercase().as_str(),
                "cargo" | "git" | "gmake" | "make"
            )
        })
}

pub(super) fn cargo_configuration(tokens: &[String]) -> bool {
    if !tokens
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("cargo"))
    {
        return false;
    }
    tokens.iter().enumerate().skip(1).any(|(index, token)| {
        token.starts_with("--config=") || index > 0 && tokens[index - 1] == "--config"
    })
}

pub(super) fn shell_control_prefix(tokens: &[String]) -> bool {
    let effective = effective_command_tokens(tokens);
    let mut command = effective.first();
    if command.is_some_and(|token| token.eq_ignore_ascii_case("time")) {
        command = effective
            .iter()
            .skip(1)
            .find(|token| !token.starts_with('-'));
    }
    command.is_some_and(|token| {
        matches!(
            token.to_ascii_lowercase().as_str(),
            "!" | "{"
                | "}"
                | "coproc"
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
    })
}
