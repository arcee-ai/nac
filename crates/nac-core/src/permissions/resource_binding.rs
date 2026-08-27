use super::*;

pub(super) fn shell_path_resources(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Vec<PermissionResource> {
    let mut paths = Vec::<(PathBuf, bool, bool)>::new();
    for index in 0..tokens.len() {
        if let Some((_, requested)) = shell_path_candidate(tokens, index) {
            let path = shell_path_requested_path(tokens, index, requested, cwd);
            let mutating = shell_path_is_mutating(tokens, index);
            let effective = effective_command_tokens(tokens);
            let command_index = tokens.len().saturating_sub(effective.len());
            let preserve_final_component =
                deletion_operand_path_position(tokens, command_index, index);
            if let Some((_, existing_mutating, existing_preserve_final)) =
                paths.iter_mut().find(|(existing, _, _)| existing == &path)
            {
                *existing_mutating |= mutating;
                *existing_preserve_final |= preserve_final_component;
            } else {
                paths.push((path, mutating, preserve_final_component));
            }
        }
    }
    paths
        .into_iter()
        .flat_map(|(path, mutating, preserve_final_component)| {
            let action = if mutating { "edit" } else { "execute_path" };
            let binding = path.display().to_string();
            let mut resources = file_resources(action, path, backend, Path::new(""), mutating);
            resources[0] = resources[0]
                .clone()
                .with_shell_binding(binding, preserve_final_component);
            resources
        })
        .collect()
}

pub(super) fn looks_like_shell_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value == ".git"
        || value.starts_with(".git/")
        || value == ".env"
        || value.starts_with(".env.")
}

pub(super) fn shell_path_candidate(
    tokens: &[String],
    index: usize,
) -> Option<(Option<&str>, &Path)> {
    let token = tokens.get(index)?;
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let git_command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"));
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let git_subcommand = git_command
        .then(|| git_subcommand_index(tokens, command_index))
        .flatten();
    if git_command
        && index > command_index
        && git_subcommand.is_some_and(|subcommand| index < subcommand)
    {
        if let Some(candidate) = token
            .strip_prefix("-C")
            .filter(|candidate| !candidate.is_empty())
        {
            return Some((Some("-C"), Path::new(candidate)));
        }
    }
    if command == "dd" {
        if let Some(candidate) = token.strip_prefix("of=") {
            return Some((Some("of"), Path::new(candidate)));
        }
    }
    let (option, candidate) = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map_or((None, token.as_str()), |(option, value)| {
            (Some(option), value)
        });
    let git_global_c_value = git_command
        && index > 0
        && tokens[index - 1] == "-C"
        && git_subcommand.is_some_and(|subcommand| index < subcommand);
    let cargo_key_value_config = command == "cargo"
        && index > 0
        && tokens[index - 1] == "--config"
        && token.contains('=')
        && !looks_like_shell_path(token);
    let previous_takes_path = index > 0
        && matches!(
            tokens[index - 1].as_str(),
            "--manifest-path" | "--config" | "--output" | "-o" | "-f" | "--file"
        )
        && !cargo_key_value_config
        || git_global_c_value
        || index > 0 && matches!(command.as_str(), "make" | "tar") && tokens[index - 1] == "-C"
        || command == "unzip" && index > 0 && tokens[index - 1] == "-d";
    let git_global_path = git_command
        && (option
            .is_some_and(|option| matches!(option, "--git-dir" | "--work-tree" | "--exec-path"))
            || index > 0 && matches!(tokens[index - 1].as_str(), "--git-dir" | "--work-tree"));
    let explicit_command_path = index == command_index && candidate.contains('/');
    let known_bare_path = bare_relative_path_position(tokens, index);
    let deletion_operand = deletion_operand_path_position(tokens, command_index, index);
    (previous_takes_path
        || git_global_path
        || explicit_command_path
        || looks_like_shell_path(candidate)
        || known_bare_path
        || deletion_operand)
        .then(|| (option, Path::new(candidate)))
}

pub(super) fn deletion_operand_path_position(
    tokens: &[String],
    command_index: usize,
    index: usize,
) -> bool {
    let command = tokens
        .get(command_index)
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default();
    matches!(
        command.to_ascii_lowercase().as_str(),
        "rm" | "rmdir" | "unlink"
    ) && rm_operand_path_position(tokens, command_index, index)
}

pub(super) fn rm_operand_path_position(
    tokens: &[String],
    command_index: usize,
    index: usize,
) -> bool {
    if index <= command_index {
        return false;
    }
    let token = &tokens[index];
    !token.starts_with('-')
        || tokens[command_index + 1..index]
            .iter()
            .any(|candidate| candidate == "--")
}

pub(super) fn shell_path_requested_path(
    tokens: &[String],
    index: usize,
    requested: &Path,
    cwd: &Path,
) -> PathBuf {
    if requested.is_absolute() {
        return requested.to_path_buf();
    }
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    if effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    {
        if git_c_path_position(tokens, command_index, index) {
            return git_effective_cwd_before(tokens, command_index, index, cwd).join(requested);
        }
        if git_global_path_position(tokens, command_index, index)
            || bare_relative_path_position(tokens, index)
        {
            return git_effective_cwd(tokens, command_index, cwd).join(requested);
        }
    }
    cwd.join(requested)
}

pub(super) fn shell_path_is_mutating(tokens: &[String], index: usize) -> bool {
    let option = tokens[index]
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map(|(option, _)| option);
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let writer_operand = index > command_index
        && matches!(
            command.as_str(),
            "chmod"
                | "chown"
                | "chgrp"
                | "cp"
                | "install"
                | "ln"
                | "mkdir"
                | "mv"
                | "rm"
                | "rsync"
                | "rmdir"
                | "tee"
                | "touch"
                | "truncate"
                | "unlink"
        )
        && (!tokens[index].starts_with('-')
            || deletion_operand_path_position(tokens, command_index, index));
    let in_place_editor = index > command_index
        && matches!(command.as_str(), "perl" | "sed")
        && tokens[command_index + 1..index].iter().any(|token| {
            token == "-i" || token.starts_with("-i") || token.starts_with("--in-place")
        });
    let extracts_into_path = command == "tar"
        && tokens[command_index + 1..]
            .iter()
            .any(|token| token == "--extract" || token.starts_with('-') && token.contains('x'));
    let destructive_find = command == "find" && tokens.iter().any(|token| token == "-delete");
    let cargo_output_path = command.eq_ignore_ascii_case("cargo")
        && (matches!(option, Some("--target-dir" | "--lockfile-path"))
            || index > 0
                && matches!(
                    tokens[index - 1].as_str(),
                    "--target-dir" | "--lockfile-path"
                ));
    let archive_output_path = command == "unzip" && index > 0 && tokens[index - 1] == "-d";
    option == Some("--output")
        || index > 0 && matches!(tokens[index - 1].as_str(), "--output" | "-o" | "-O")
        || writer_operand
        || command == "dd" && tokens[index].starts_with("of=")
        || in_place_editor
        || extracts_into_path
        || destructive_find
        || cargo_output_path
        || archive_output_path
}

pub(super) fn bare_relative_path_position(tokens: &[String], index: usize) -> bool {
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if index <= command_index {
        return false;
    }
    match command.as_str() {
        "cargo" => cargo_bare_relative_path_position(tokens, index),
        "rg" => rg_bare_relative_path_position(tokens, command_index, index),
        "git" => git_bare_relative_path_position(tokens, command_index, index),
        "chmod" | "chown" | "chgrp" => simple_bare_path_operand(tokens, command_index, index, 1),
        "cat" | "cp" | "du" | "file" | "head" | "install" | "ln" | "ls" | "mkdir" | "mv"
        | "readlink" | "realpath" | "rsync" | "rmdir" | "stat" | "tail" | "tee" | "touch"
        | "truncate" | "unlink" | "wc" => simple_bare_path_operand(tokens, command_index, index, 0),
        _ => false,
    }
}

pub(super) fn simple_bare_path_operand(
    tokens: &[String],
    command_index: usize,
    index: usize,
    leading_data_operands: usize,
) -> bool {
    const VALUE_OPTIONS: &[&str] = &[
        "-m",
        "--mode",
        "-o",
        "--owner",
        "-g",
        "--group",
        "-t",
        "--target-directory",
        "-S",
        "--suffix",
        "--reference",
        "-s",
        "--size",
        "-n",
        "--lines",
        "-c",
        "--bytes",
        "--block-size",
        "--format",
        "--printf",
    ];
    let mut options = true;
    let mut skip_value = false;
    let mut positional = 0usize;
    for (cursor, token) in tokens.iter().enumerate().skip(command_index + 1) {
        if skip_value {
            skip_value = false;
            continue;
        }
        if options && token == "--" {
            options = false;
            continue;
        }
        if options && token.starts_with('-') && token != "-" {
            let option = token
                .split_once('=')
                .map_or(token.as_str(), |(name, _)| name);
            if VALUE_OPTIONS.contains(&option) && !token.contains('=') {
                skip_value = true;
            }
            continue;
        }
        if cursor == index {
            return positional >= leading_data_operands;
        }
        positional += 1;
    }
    false
}

pub(super) fn cargo_bare_relative_path_position(tokens: &[String], index: usize) -> bool {
    let token = &tokens[index];
    let option_and_value = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'));
    option_and_value.is_some_and(|(option, value)| {
        matches!(
            option,
            "--manifest-path" | "--target-dir" | "--lockfile-path"
        ) || option == "--config" && !value.contains('=')
    }) || index > 0
        && matches!(
            tokens[index - 1].as_str(),
            "--manifest-path" | "--target-dir" | "--lockfile-path"
        )
}

pub(super) fn rg_bare_relative_path_position(
    tokens: &[String],
    command_index: usize,
    index: usize,
) -> bool {
    const VALUE_OPTIONS: &[&str] = &[
        "-A",
        "--after-context",
        "-B",
        "--before-context",
        "-C",
        "--context",
        "--color",
        "--colors",
        "--context-separator",
        "-E",
        "--encoding",
        "--engine",
        "--field-match-separator",
        "-g",
        "--glob",
        "--iglob",
        "-M",
        "--max-columns",
        "-m",
        "--max-count",
        "--max-depth",
        "--max-filesize",
        "--path-separator",
        "--pre",
        "--pre-glob",
        "-r",
        "--replace",
        "--sort",
        "--sortr",
        "-t",
        "--type",
        "--type-add",
        "--type-clear",
        "--type-not",
        "-j",
        "--threads",
    ];
    const PATTERN_OPTIONS: &[&str] = &["-e", "--regexp"];
    const PATH_OPTIONS: &[&str] = &["-f", "--file", "--ignore-file"];

    let mut options = true;
    let mut skip_value = false;
    let mut explicit_pattern = false;
    let files_mode = tokens[command_index + 1..]
        .iter()
        .any(|token| token == "--files");
    let mut positional = Vec::new();
    for (cursor, token) in tokens.iter().enumerate().skip(command_index + 1) {
        if skip_value {
            skip_value = false;
            continue;
        }
        if options && token == "--" {
            options = false;
            continue;
        }
        if options && token.starts_with('-') {
            let option = token
                .split_once('=')
                .map_or(token.as_str(), |(name, _)| name);
            if PATTERN_OPTIONS.contains(&option) {
                explicit_pattern = true;
                skip_value = !token.contains('=');
            } else if PATH_OPTIONS.contains(&option) || VALUE_OPTIONS.contains(&option) {
                skip_value = !token.contains('=');
            }
            continue;
        }
        positional.push(cursor);
    }
    let Some(position) = positional.iter().position(|candidate| *candidate == index) else {
        return false;
    };
    files_mode || explicit_pattern || position > 0
}

pub(super) fn git_bare_relative_path_position(
    tokens: &[String],
    command_index: usize,
    index: usize,
) -> bool {
    let Some(subcommand_index) = git_subcommand_index(tokens, command_index) else {
        return false;
    };
    let subcommand = tokens[subcommand_index].as_str();
    if !matches!(subcommand, "diff" | "log" | "show" | "status") {
        return false;
    }
    if let Some(separator) = tokens[subcommand_index + 1..]
        .iter()
        .position(|token| token == "--")
        .map(|offset| subcommand_index + 1 + offset)
    {
        return index > separator;
    }
    if subcommand != "diff"
        || !tokens[subcommand_index + 1..]
            .iter()
            .any(|token| token == "--no-index")
    {
        return false;
    }
    let operands = (subcommand_index + 1..tokens.len())
        .filter(|candidate| !tokens[*candidate].starts_with('-'))
        .collect::<Vec<_>>();
    operands
        .iter()
        .rev()
        .take(2)
        .any(|candidate| *candidate == index)
}

pub(super) fn git_subcommand_index(tokens: &[String], command_index: usize) -> Option<usize> {
    let mut index = command_index + 1;
    while let Some(option) = tokens.get(index) {
        if matches!(
            option.as_str(),
            "-C" | "-c"
                | "--git-dir"
                | "--work-tree"
                | "--namespace"
                | "--super-prefix"
                | "--config-env"
        ) {
            index += 2;
        } else if option.starts_with('-') {
            index += 1;
        } else {
            return Some(index);
        }
    }
    None
}

pub(super) fn git_c_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    if index <= command_index
        || !git_subcommand_index(tokens, command_index).is_some_and(|subcommand| index < subcommand)
    {
        return false;
    }
    tokens.get(index - 1).is_some_and(|option| option == "-C")
        || tokens[index]
            .strip_prefix("-C")
            .is_some_and(|path| !path.is_empty())
}

pub(super) fn git_global_path_position(
    tokens: &[String],
    command_index: usize,
    index: usize,
) -> bool {
    if index <= command_index {
        return false;
    }
    let token = &tokens[index];
    token.starts_with("--git-dir=")
        || token.starts_with("--work-tree=")
        || token.starts_with("--exec-path=")
        || tokens
            .get(index - 1)
            .is_some_and(|option| matches!(option.as_str(), "--git-dir" | "--work-tree"))
}

pub(super) fn git_effective_cwd_before(
    tokens: &[String],
    command_index: usize,
    before_index: usize,
    cwd: &Path,
) -> PathBuf {
    let mut effective = cwd.to_path_buf();
    let mut index = command_index + 1;
    while index < before_index {
        let Some(option) = tokens.get(index) else {
            break;
        };
        let requested = if option == "-C" {
            if index + 1 >= before_index {
                break;
            }
            tokens.get(index + 1).map(String::as_str)
        } else {
            option
                .strip_prefix("-C")
                .filter(|requested| !requested.is_empty())
        };
        if let Some(requested) = requested {
            effective = if Path::new(requested).is_absolute() {
                PathBuf::from(requested)
            } else {
                effective.join(requested)
            };
            effective = lexical_normalize(&effective);
            index += if option == "-C" { 2 } else { 1 };
        } else if matches!(
            option.as_str(),
            "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--super-prefix" | "--config-env"
        ) {
            index += 2;
        } else if option.starts_with('-') {
            index += 1;
        } else {
            break;
        }
    }
    effective
}

pub(super) fn git_effective_cwd(tokens: &[String], command_index: usize, cwd: &Path) -> PathBuf {
    git_effective_cwd_before(tokens, command_index, tokens.len(), cwd)
}

pub(crate) fn bind_authorized_shell_command(
    command: &str,
    cwd: &Path,
    resources: &[PermissionResource],
) -> anyhow::Result<String> {
    let ParsedShell::Supported(segments) = parse_shell(command) else {
        return Ok(command.to_string());
    };
    let spans = supported_shell_word_spans(command)
        .ok_or_else(|| anyhow::anyhow!("authorized command could not be tokenized for binding"))?;
    if spans.len() != segments.len()
        || spans.iter().zip(&segments).any(|(spans, tokens)| {
            spans.iter().map(|span| &span.value).collect::<Vec<_>>()
                != tokens.iter().collect::<Vec<_>>()
        })
    {
        return Err(anyhow::anyhow!(
            "authorized command tokenization changed before binding"
        ));
    }

    let mut authorized_paths = resources
        .iter()
        .filter(|resource| matches!(resource.action.as_str(), "execute_path" | "edit"))
        .map(|resource| {
            resource
                .shell_binding
                .as_deref()
                .unwrap_or(resource.resource.as_str())
        });
    let cwd = lexical_normalize(cwd);
    let mut replacements = Vec::<(usize, usize, String)>::new();
    for (tokens, spans) in segments.iter().zip(spans) {
        let mut canonical_by_requested = Vec::<(PathBuf, String)>::new();
        for (index, span) in spans.iter().enumerate() {
            let Some((option, requested)) = shell_path_candidate(tokens, index) else {
                continue;
            };
            let requested = shell_path_requested_path(tokens, index, requested, &cwd);
            let canonical = if let Some((_, canonical)) = canonical_by_requested
                .iter()
                .find(|(seen, _)| seen == &requested)
            {
                canonical.clone()
            } else {
                let canonical = authorized_paths
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("authorized command path is missing"))?
                    .to_string();
                canonical_by_requested.push((requested, canonical.clone()));
                canonical
            };
            let bound = option.map_or(canonical.clone(), |option| {
                if option == "-C" {
                    format!("-C{canonical}")
                } else {
                    format!("{option}={canonical}")
                }
            });
            replacements.push((span.start, span.end, shell_quote(&bound)));
        }
    }
    if authorized_paths.next().is_some() {
        return Err(anyhow::anyhow!(
            "authorized command contains unmatched path resources"
        ));
    }
    let mut rebound = command.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        rebound.replace_range(start..end, &replacement);
    }
    Ok(rebound)
}

#[derive(Debug)]
pub(super) struct ShellWordSpan {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) value: String,
}

pub(super) fn supported_shell_word_spans(command: &str) -> Option<Vec<Vec<ShellWordSpan>>> {
    if matches!(parse_shell(command), ParsedShell::Opaque) {
        return None;
    }
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut start = None;
    let mut value = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut escape_start = 0;
    let mut chars = command.char_indices().peekable();
    let push = |segment: &mut Vec<ShellWordSpan>,
                start: &mut Option<usize>,
                value: &mut String,
                end: usize| {
        if start.is_some() {
            segment.push(ShellWordSpan {
                start: start.take().expect("started shell word has a start"),
                end,
                value: std::mem::take(value),
            });
        } else {
            *start = None;
        }
    };
    while let Some((index, current)) = chars.next() {
        if escaped {
            if current != '\n' {
                start.get_or_insert(escape_start);
                value.push(current);
            }
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            if quote == Some('"')
                && !chars
                    .peek()
                    .is_some_and(|(_, next)| matches!(next, '$' | '`' | '"' | '\\' | '\n'))
            {
                start.get_or_insert(index);
                value.push(current);
                continue;
            }
            escape_start = index;
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                value.push(current);
            }
            continue;
        }
        if current == '\'' || current == '"' {
            start.get_or_insert(index);
            quote = Some(current);
            continue;
        }
        if current.is_whitespace() {
            push(&mut segment, &mut start, &mut value, index);
            continue;
        }
        let boundary = matches!(current, ';' | '\n' | '|' | '&');
        if boundary {
            push(&mut segment, &mut start, &mut value, index);
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
            if matches!(current, '|' | '&')
                && chars.peek().is_some_and(|(_, next)| *next == current)
            {
                chars.next();
            }
            continue;
        }
        start.get_or_insert(index);
        value.push(current);
    }
    push(&mut segment, &mut start, &mut value, command.len());
    if !segment.is_empty() {
        segments.push(segment);
    }
    Some(segments)
}

pub(super) fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_./:=+,-".contains(&byte))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}
