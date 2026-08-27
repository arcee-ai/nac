use super::*;

pub(super) fn hard_shell_denial(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Option<String> {
    hard_shell_denial_inner(tokens, cwd, backend, 0)
}

pub(super) fn hard_shell_denial_inner(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
    depth: usize,
) -> Option<String> {
    if let Some(name) = executable_environment_hook(tokens) {
        return Some(if name == "indirect stateful shell assignment" {
            "indirect stateful shell assignments are blocked because they can mutate dynamic-loader hooks without disclosing the target variable"
                .to_string()
        } else if matches!(name, "RSYNC_RSH" | "RSYNC_CONNECT_PROG") {
            "rsync executable environment hooks are blocked because they can conceal commands"
                .to_string()
        } else {
            format!(
                "dynamic-loader environment hook '{name}' is blocked because it can execute hidden code"
            )
        });
    }
    if shell_control_prefix(tokens) {
        return Some(
            "shell control syntax is blocked because it can hide protected commands".to_string(),
        );
    }
    if literal_env_split_string(tokens).is_some() {
        return Some(
            "env split-string execution is blocked because embedded command paths cannot be independently authorized"
                .to_string(),
        );
    }
    if git_environment_configuration_override(tokens) {
        return Some(
            "Git environment configuration is blocked because it can execute hidden commands"
                .to_string(),
        );
    }
    let tokens = effective_command_tokens(tokens);
    let command = tokens.first()?.rsplit('/').next()?.to_ascii_lowercase();
    if matches!(
        command.as_str(),
        "chroot"
            | "chrt"
            | "daemon"
            | "daemonize"
            | "flock"
            | "ionice"
            | "numactl"
            | "nsenter"
            | "parallel"
            | "prlimit"
            | "runuser"
            | "script"
            | "setpriv"
            | "setsid"
            | "start-stop-daemon"
            | "stdbuf"
            | "systemd-run"
            | "taskset"
            | "unshare"
            | "watch"
    ) {
        return Some(format!(
            "execution wrapper '{command}' is blocked because it can conceal a protected command"
        ));
    }
    if command == "rsync"
        && tokens.iter().skip(1).any(|token| {
            token == "--daemon"
                || token.starts_with('-') && !token.starts_with("--") && token[1..].contains('e')
                || token == "--rsh"
                || token.starts_with("--rsh=")
                || token == "--rsync-path"
                || token.starts_with("--rsync-path=")
                || token == "--config"
                || token.starts_with("--config=")
        })
    {
        return Some(
            "rsync executable and daemon configuration is blocked because it can conceal commands"
                .to_string(),
        );
    }
    if command == "eval" {
        return Some(
            "shell eval is blocked because quoted data can become a protected command".to_string(),
        );
    }
    if embedded_command_body(tokens).is_some() {
        return Some(
            "embedded executable command bodies are blocked because their paths cannot be independently authorized"
                .to_string(),
        );
    }
    if command == "xargs" {
        if depth >= 8 {
            return Some("nested executable wrapper depth exceeds the safety limit".to_string());
        }
        match xargs_command_tokens(tokens) {
            Ok(Some(_)) => {
                return Some(
                    "xargs command execution is blocked because streamed input can become unauthorized executable arguments"
                        .to_string(),
                );
            }
            Ok(None) => {}
            Err(reason) => return Some(reason.to_string()),
        }
    }
    if command == "find" {
        if depth >= 8 && find_exec_commands(tokens).next().is_some() {
            return Some("nested executable wrapper depth exceeds the safety limit".to_string());
        }
        if find_exec_commands(tokens).next().is_some() {
            return Some(
                "find executable actions are blocked because nested command paths cannot be independently authorized"
                    .to_string(),
            );
        }
        if tokens.iter().any(|token| token == "-delete") {
            return Some(
                "find -delete is blocked because traversal can remove protected paths".to_string(),
            );
        }
    }
    if matches!(
        command.as_str(),
        "sudo" | "doas" | "su" | "shutdown" | "reboot"
    ) {
        return Some(format!(
            "protected authority-amplifying command '{command}' is blocked"
        ));
    }
    if command.starts_with("mkfs") {
        return Some("filesystem formatting commands are blocked".to_string());
    }
    if command == "git" {
        if git_alias_override(tokens) {
            return Some(
                "Git command-scoped configuration is blocked because it can execute hidden commands"
                    .to_string(),
            );
        }
        let destructive = tokens
            .iter()
            .skip(1)
            .any(|token| matches!(token.as_str(), "clean" | "reset" | "restore"));
        let checkout = tokens.iter().skip(1).any(|token| token == "checkout");
        if destructive || checkout {
            return Some("destructive Git workspace rewrites are blocked".to_string());
        }
    }
    if command == "rm" && removes_protected_root(tokens, cwd, backend) {
        return Some(
            "recursive deletion of the workspace or filesystem root is blocked".to_string(),
        );
    }
    if matches!(command.as_str(), "bash" | "dash" | "fish" | "sh" | "zsh") {
        if depth >= 8 {
            return Some("nested shell command depth exceeds the safety limit".to_string());
        }
        if literal_shell_command_body(tokens).is_some() {
            return Some(
                "nested shell command bodies are blocked because their paths cannot be independently authorized"
                    .to_string(),
            );
        }
    }
    None
}

pub(super) fn git_alias_override(tokens: &[String]) -> bool {
    let Some(command_index) = tokens.iter().position(|token| {
        token
            .rsplit('/')
            .next()
            .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    }) else {
        return false;
    };
    let subcommand_index = git_subcommand_index(tokens, command_index).unwrap_or(tokens.len());
    let mut index = command_index + 1;
    while index < subcommand_index {
        let token = &tokens[index];
        let configured = if token == "-c" || token == "--config-env" {
            index += 1;
            tokens.get(index).map(String::as_str)
        } else if let Some(configured) = token.strip_prefix("-c") {
            (!configured.is_empty()).then_some(configured)
        } else {
            token.strip_prefix("--config-env=")
        };
        if configured.is_some() {
            return true;
        }
        index += 1;
    }
    false
}

pub(super) fn git_environment_configuration_override(tokens: &[String]) -> bool {
    let effective = effective_command_tokens(tokens);
    if !effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    {
        return false;
    }
    let prefix_len = tokens.len().saturating_sub(effective.len());
    tokens[..prefix_len].iter().any(|token| {
        let Some((name, _)) = token.split_once('=') else {
            return false;
        };
        let name = name.to_ascii_uppercase();
        matches!(
            name.as_str(),
            "GIT_CONFIG_COUNT"
                | "GIT_CONFIG_PARAMETERS"
                | "GIT_CONFIG_GLOBAL"
                | "GIT_CONFIG_SYSTEM"
        ) || name.starts_with("GIT_CONFIG_KEY_")
            || name.starts_with("GIT_CONFIG_VALUE_")
    })
}

pub(super) fn literal_shell_command_body(tokens: &[String]) -> Option<&str> {
    let option_index = tokens
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, token)| {
            (token.starts_with('-') && !token.starts_with("--") && token[1..].contains('c'))
                .then_some(index)
        })?;
    tokens.get(option_index + 1).map(String::as_str)
}

pub(super) fn embedded_command_body(tokens: &[String]) -> Option<&str> {
    let effective = effective_command_tokens(tokens);
    let command = effective.first()?.rsplit('/').next()?;
    if !command.eq_ignore_ascii_case("rg") {
        return None;
    }
    effective
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, token)| {
            if token == "--pre" {
                effective.get(index + 1).map(String::as_str)
            } else {
                token.strip_prefix("--pre=")
            }
        })
}

pub(super) fn xargs_command_tokens(tokens: &[String]) -> Result<Option<&[String]>, &'static str> {
    const VALUE_OPTIONS: &[&str] = &[
        "-a",
        "--arg-file",
        "-d",
        "--delimiter",
        "-E",
        "--eof",
        "-I",
        "--replace",
        "-L",
        "--max-lines",
        "-n",
        "--max-args",
        "-P",
        "--max-procs",
        "-s",
        "--max-chars",
        "--process-slot-var",
    ];
    const FLAG_OPTIONS: &[&str] = &[
        "-0",
        "--null",
        "--show-limits",
        "-p",
        "--interactive",
        "-r",
        "--no-run-if-empty",
        "-t",
        "--verbose",
        "-x",
        "--exit",
        "--help",
        "--version",
        "-e",
        "-i",
        "-l",
        "-o",
    ];
    const ATTACHED_VALUE_OPTIONS: &[&str] = &[
        "-a", "-d", "-E", "-I", "-J", "-L", "-n", "-P", "-R", "-S", "-s",
    ];
    let effective = effective_command_tokens(tokens);
    let mut index = 1;
    while let Some(token) = effective.get(index) {
        if token == "--" {
            return Ok(effective
                .get(index + 1..)
                .filter(|command| !command.is_empty()));
        }
        if !token.starts_with('-') || token == "-" {
            return Ok(Some(&effective[index..]));
        }
        let option = token
            .split_once('=')
            .map_or(token.as_str(), |(name, _)| name);
        index += 1;
        if VALUE_OPTIONS.contains(&option) && !token.contains('=') && token == option {
            index += 1;
        } else if FLAG_OPTIONS.contains(&option)
            || ATTACHED_VALUE_OPTIONS
                .iter()
                .any(|prefix| token.starts_with(prefix) && token.len() > prefix.len())
        {
        } else {
            return Err("unsupported xargs option syntax is blocked");
        }
    }
    Ok(None)
}

pub(super) fn find_exec_commands(tokens: &[String]) -> impl Iterator<Item = &[String]> {
    let effective = effective_command_tokens(tokens);
    let mut commands = Vec::new();
    let mut index = 1;
    while index < effective.len() {
        if matches!(
            effective[index].as_str(),
            "-exec" | "-execdir" | "-ok" | "-okdir"
        ) {
            let start = index + 1;
            let end = effective[start..]
                .iter()
                .position(|token| matches!(token.as_str(), ";" | "+"))
                .map_or(effective.len(), |offset| start + offset);
            if start < end {
                commands.push(&effective[start..end]);
            }
            index = end.saturating_add(1);
        } else {
            index += 1;
        }
    }
    commands.into_iter()
}

pub(super) fn literal_env_split_string(tokens: &[String]) -> Option<(&str, &str, &[String])> {
    let mut index = 0;
    while tokens
        .get(index)
        .is_some_and(|token| is_environment_assignment(token))
    {
        index += 1;
    }
    let env_command = tokens.get(index)?;
    if !env_command.rsplit('/').next()?.eq_ignore_ascii_case("env") {
        return None;
    }
    index += 1;
    while let Some(option) = tokens.get(index) {
        if matches!(option.as_str(), "-S" | "--split-string") {
            return tokens
                .get(index + 1)
                .map(|body| (env_command.as_str(), body.as_str(), &tokens[index + 2..]));
        }
        if let Some(body) = option.strip_prefix("--split-string=") {
            return Some((env_command.as_str(), body, &tokens[index + 1..]));
        }
        if let Some(body) = option.strip_prefix("-S").filter(|body| !body.is_empty()) {
            return Some((env_command.as_str(), body, &tokens[index + 1..]));
        }
        if matches!(option.as_str(), "-u" | "--unset" | "-C" | "--chdir") {
            index += 2;
        } else if option.starts_with('-') || is_environment_assignment(option) {
            index += 1;
        } else {
            break;
        }
    }
    None
}

pub(super) fn env_split_string_policy_body(body: &str) -> Result<String, &'static str> {
    let mut normalized = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(current) = chars.next() {
        if current == '$' {
            return Err("dynamic env split-string expansion is blocked");
        }
        if current != '\\' {
            normalized.push(current);
            continue;
        }
        let Some(escaped) = chars.next() else {
            return Err("unsupported env split-string escape is blocked");
        };
        match escaped {
            '_' | 'f' | 'n' | 'r' | 't' | 'v' => normalized.push(' '),
            'c' => break,
            _ => return Err("unsupported env split-string escape is blocked"),
        }
    }
    Ok(normalized)
}

pub(super) fn expanded_env_split_tokens(
    tokens: &[String],
) -> Result<Option<Vec<String>>, &'static str> {
    let Some((env_command, body, trailing)) = literal_env_split_string(tokens) else {
        return Ok(None);
    };
    let body = env_split_string_policy_body(body)?;
    let ParsedShell::Supported(mut segments) = parse_shell(&body) else {
        return Err("unsupported env split-string syntax is blocked");
    };
    if segments.len() != 1 {
        return Err("unsupported env split-string syntax is blocked");
    }
    let mut expanded = segments.pop().unwrap_or_default();
    expanded.extend_from_slice(trailing);
    if expanded
        .first()
        .is_none_or(|token| token.starts_with('-') || is_environment_assignment(token))
    {
        expanded.insert(0, env_command.to_string());
    }
    Ok(Some(expanded))
}

pub(super) fn effective_command_tokens(tokens: &[String]) -> &[String] {
    let mut index = 0;
    loop {
        while tokens
            .get(index)
            .is_some_and(|token| is_shell_environment_assignment(token))
        {
            index += 1;
        }
        let Some(command) = tokens
            .get(index)
            .and_then(|command| command.rsplit('/').next())
            .map(str::to_ascii_lowercase)
        else {
            return &tokens[index..];
        };
        match command.as_str() {
            "command" | "builtin" | "nohup" => {
                index += 1;
                while tokens
                    .get(index)
                    .is_some_and(|token| token.starts_with('-'))
                {
                    index += 1;
                }
            }
            "exec" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if option == "-a" {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with('-') {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "env" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(
                        option.as_str(),
                        "-u" | "--unset"
                            | "-C"
                            | "--chdir"
                            | "-S"
                            | "--split-string"
                            | "-a"
                            | "--argv0"
                    ) {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--unset=")
                        || option.starts_with("--chdir=")
                        || option.starts_with("--split-string=")
                        || option.starts_with("--argv0=")
                        || option.starts_with('-')
                        || is_environment_assignment(option)
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "nice" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-n" | "--adjustment") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--adjustment=") || option.starts_with('-') {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "timeout" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-k" | "--kill-after" | "-s" | "--signal") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--kill-after=")
                        || option.starts_with("--signal=")
                        || option.starts_with('-')
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
                // GNU timeout requires one duration operand before COMMAND.
                if index < tokens.len() {
                    index += 1;
                }
            }
            "time" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-f" | "--format" | "-o" | "--output") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--format=")
                        || option.starts_with("--output=")
                        || option.starts_with("-f") && option.len() > 2
                        || option.starts_with("-o") && option.len() > 2
                        || option.starts_with('-')
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "busybox" => index += 1,
            _ => return &tokens[index..],
        }
    }
}

pub(super) fn is_environment_assignment(token: &str) -> bool {
    environment_assignment_name(token).is_some()
}

pub(super) fn is_shell_environment_assignment(token: &str) -> bool {
    shell_environment_assignment_name(token).is_some()
}

pub(super) fn environment_assignment_name(token: &str) -> Option<&str> {
    let (name, _) = token.split_once('=')?;
    valid_environment_name(name).then_some(name)
}

pub(super) fn shell_environment_assignment_name(token: &str) -> Option<&str> {
    let (left, _) = token.split_once('=')?;
    let name = left.strip_suffix('+').unwrap_or(left);
    valid_environment_name(name).then_some(name)
}

pub(super) fn valid_environment_name(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphanumeric() && (index > 0 || !byte.is_ascii_digit())
        })
}

/// Returns an execution-bearing assignment only while it is in a position
/// Bash or `env` treats as command environment. Tokens after the effective
/// command are data and must not be rejected merely because they contain an
/// assignment-looking string.
pub(super) fn executable_environment_hook(tokens: &[String]) -> Option<&str> {
    const INDIRECT_ASSIGNMENT: &str = "indirect stateful shell assignment";
    const STATEFUL_EXPORT: &str = "stateful shell environment export";
    const HOOKS: &[&str] = &[
        "RSYNC_RSH",
        "RSYNC_CONNECT_PROG",
        "LD_PRELOAD",
        "LD_AUDIT",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
    ];

    let mut leading = 0;
    while let Some(name) = tokens
        .get(leading)
        .and_then(|token| shell_environment_assignment_name(token))
    {
        if HOOKS.contains(&name) {
            return Some(name);
        }
        leading += 1;
    }

    let command_index = tokens
        .len()
        .saturating_sub(effective_command_tokens(tokens).len());
    if let Some(name) = tokens[leading..command_index]
        .iter()
        .filter_map(|token| environment_assignment_name(token))
        .find(|name| HOOKS.contains(name))
    {
        return Some(name);
    }

    // Bash executes a semicolon-delimited command line in one stateful shell,
    // even though authorization inspects each simple command independently.
    // Assignment builtins can therefore seed a loader hook in one segment and
    // have a later, otherwise-safe executable inherit it. Restrict scanning to
    // builtin operands so assignment-looking data after ordinary commands
    // remains harmless.
    let effective = effective_command_tokens(tokens);
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())?;
    let command = command.to_ascii_lowercase();

    // `printf -v NAME` mutates the current Bash process without using
    // assignment syntax. If NAME is exported, a later simple command inherits
    // the value, so it must receive the same non-bypassable hook denial as a
    // direct assignment.
    if command == "printf" {
        let mut operands = effective[1..].iter();
        while let Some(option) = operands.next() {
            let target = if option == "-v" {
                operands.next().map(String::as_str)
            } else {
                option
                    .strip_prefix("-v")
                    .filter(|target| !target.is_empty())
            };
            if let Some(target) = target {
                return HOOKS.contains(&target).then_some(target);
            }
            if option == "--" || !option.starts_with('-') {
                break;
            }
        }
        return None;
    }

    // `set -a` / `set -o allexport` changes the meaning of later simple
    // commands in the same `bash -c`: assignment-capable builtins such as
    // `let` and `read` can then create an exported loader hook without any
    // assignment syntax in the `set` segment. Authorization intentionally
    // tokenizes shell segments, so reject the state transition itself instead
    // of pretending later segments can be judged without prior shell state.
    if command == "set" {
        let operands = &effective[1..];
        if operands.iter().any(|operand| {
            operand
                .strip_prefix('-')
                .filter(|flags| !flags.is_empty() && *flags != "-")
                .is_some_and(|flags| flags.contains('a'))
        }) || operands
            .windows(2)
            .any(|pair| pair[0] == "-o" && pair[1].eq_ignore_ascii_case("allexport"))
        {
            return Some(STATEFUL_EXPORT);
        }
        return None;
    }

    // These Bash builtins assign in the current shell without needing a
    // leading NAME=value token. Block direct writes to protected hook names
    // even when an earlier export attribute is not visible in this segment.
    if command == "let" {
        return effective[1..]
            .iter()
            .filter_map(|operand| shell_environment_assignment_name(operand))
            .find(|name| HOOKS.contains(name));
    }
    if command == "read" {
        let mut index = 1;
        while let Some(operand) = effective.get(index) {
            if operand == "--" {
                index += 1;
                break;
            }
            if matches!(
                operand.as_str(),
                "-a" | "-d" | "-i" | "-n" | "-N" | "-p" | "-t" | "-u"
            ) {
                index = (index + 2).min(effective.len());
            } else if operand.starts_with('-') {
                index += 1;
            } else {
                break;
            }
        }
        return effective[index..]
            .iter()
            .find(|name| HOOKS.contains(&name.as_str()))
            .map(String::as_str);
    }

    if !matches!(
        command.as_str(),
        "declare" | "export" | "readonly" | "typeset"
    ) {
        return None;
    }

    // Bash namerefs make the eventual assignment target depend on shell state
    // from an earlier segment. Reject creation of that indirection rather than
    // pretending the visible alias can be authorized as a narrow variable.
    if matches!(command.as_str(), "declare" | "typeset")
        && effective[1..]
            .iter()
            .take_while(|token| *token != "--")
            .any(|token| {
                token
                    .strip_prefix(['-', '+'])
                    .is_some_and(|flags| flags.contains('n'))
            })
    {
        return Some(INDIRECT_ASSIGNMENT);
    }
    effective[1..]
        .iter()
        .filter(|token| !token.starts_with('-') && !token.starts_with('+'))
        .filter_map(|token| {
            shell_environment_assignment_name(token)
                .or_else(|| valid_environment_name(token).then_some(token.as_str()))
        })
        .find(|name| HOOKS.contains(name))
}
