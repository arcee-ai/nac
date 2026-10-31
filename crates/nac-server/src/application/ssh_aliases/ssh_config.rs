//! Pure, side-effect-free reading of OpenSSH client configuration text.
//!
//! Only the three keywords alias discovery needs are recognised: `Host`,
//! `Match` and `Include`. Every other directive is ignored. Nothing here
//! evaluates a condition, expands a token, or touches the filesystem; `Match`
//! criteria (including `exec`) are recorded as an opaque block boundary.

#[cfg(test)]
#[path = "ssh_config_tests.rs"]
mod tests;

/// One recognised directive, with its arguments split the way OpenSSH splits
/// them (whitespace separated, quotes grouping, a leading `#` ending the line).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Directive {
    Host(Vec<String>),
    /// A `Match` line starts a conditional block. Its criteria are
    /// deliberately not retained so nothing downstream can evaluate them.
    Match,
    Include(Vec<String>),
    /// A recognised keyword whose arguments OpenSSH itself would reject, such
    /// as an unterminated quote or a missing argument.
    Malformed,
}

/// Whether one `Host` pattern names a literal alias a user can type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum HostPattern {
    Literal(String),
    /// Wildcards, negations and names that cannot be passed to `ssh` as a
    /// destination. These stay reachable through manual entry.
    Undiscoverable,
}

/// Longest alias offered. DNS names stop at 253 bytes; anything longer is not
/// something a person picks from a list.
const MAX_ALIAS_BYTES: usize = 255;

pub(super) fn parse(text: &str) -> Vec<Directive> {
    text.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<Directive> {
    let line = line.trim_matches(|c: char| c.is_ascii_whitespace() || c == '\u{c}');
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    // OpenSSH splits the keyword at whitespace or a single `=`, so
    // `Host=a`, `Host = a` and `Host a` are all the same directive.
    let keyword_end = line.find(['=', ' ', '\t']).unwrap_or(line.len());
    let keyword = &line[..keyword_end];
    let mut rest = line[keyword_end..].trim_start_matches([' ', '\t']);
    if let Some(after_equals) = rest.strip_prefix('=') {
        rest = after_equals.trim_start_matches([' ', '\t']);
    }
    let make: fn(Vec<String>) -> Directive = match keyword.to_ascii_lowercase().as_str() {
        "host" => Directive::Host,
        "match" => |_| Directive::Match,
        "include" => Directive::Include,
        _ => return None,
    };
    match split_arguments(rest) {
        Some(arguments) if !arguments.is_empty() => Some(make(arguments)),
        // A Match line still opens a block even when it is malformed, so later
        // Host-less Includes are never mistaken for unconditional ones.
        _ if keyword.eq_ignore_ascii_case("match") => Some(Directive::Match),
        // So does a Host line without patterns, which OpenSSH rejects: the
        // empty block matches no host, and the walk reports it as malformed.
        _ if keyword.eq_ignore_ascii_case("host") => Some(Directive::Host(Vec::new())),
        _ => Some(Directive::Malformed),
    }
}

/// OpenSSH's `argv_split` with comment termination: whitespace separates
/// arguments, single or double quotes group, a backslash escapes a quote,
/// backslash or (outside quotes) a space, and an unquoted `#` that starts an
/// argument ends the line. Returns `None` for an unterminated quote.
fn split_arguments(input: &str) -> Option<Vec<String>> {
    let mut arguments = Vec::new();
    let mut chars = input.chars().peekable();
    loop {
        while chars.peek().is_some_and(|c| *c == ' ' || *c == '\t') {
            chars.next();
        }
        match chars.peek() {
            None | Some('#') => return Some(arguments),
            Some(_) => {}
        }
        let mut argument = String::new();
        let mut quote: Option<char> = None;
        while let Some(c) = chars.next() {
            match c {
                '\\' => match chars.peek().copied() {
                    Some(next @ ('\'' | '"' | '\\')) => {
                        chars.next();
                        argument.push(next);
                    }
                    Some(' ') if quote.is_none() => {
                        chars.next();
                        argument.push(' ');
                    }
                    _ => argument.push('\\'),
                },
                ' ' | '\t' if quote.is_none() => break,
                '"' | '\'' if quote.is_none() => quote = Some(c),
                _ if quote == Some(c) => quote = None,
                _ => argument.push(c),
            }
        }
        if quote.is_some() {
            return None;
        }
        arguments.push(argument);
    }
}

pub(super) fn classify(pattern: &str) -> HostPattern {
    let usable = !pattern.is_empty()
        && pattern.len() <= MAX_ALIAS_BYTES
        // A leading dash would be read by ssh as an option, not a destination.
        && !pattern.starts_with('-')
        && pattern
            .chars()
            .all(|c| !c.is_whitespace() && !c.is_control() && !"!*?,@%'\"\\".contains(c));
    if usable {
        HostPattern::Literal(pattern.to_string())
    } else {
        HostPattern::Undiscoverable
    }
}

/// True when a `Host` line applies to every destination (`Host *` without a
/// negation), which is the only Host block whose Includes OpenSSH reads
/// unconditionally.
pub(super) fn matches_every_host(patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| pattern == "*")
        && !patterns.iter().any(|pattern| pattern.starts_with('!'))
}

/// Shell-style match of one file name against a final-component `Include`
/// glob supporting only `*` and `?`. Like glob(3), a wildcard never matches a
/// leading `.` unless the pattern itself starts with one.
pub(super) fn glob_matches(pattern: &str, name: &str) -> bool {
    if name.starts_with('.') && !pattern.starts_with('.') {
        return false;
    }
    let pattern: Vec<char> = pattern.chars().collect();
    let name: Vec<char> = name.chars().collect();
    let (mut p, mut n) = (0, 0);
    let mut backtrack: Option<(usize, usize)> = None;
    while n < name.len() {
        match pattern.get(p) {
            Some('*') => {
                backtrack = Some((p, n));
                p += 1;
            }
            Some('?') => {
                p += 1;
                n += 1;
            }
            Some(c) if *c == name[n] => {
                p += 1;
                n += 1;
            }
            _ => match backtrack {
                Some((star, matched)) => {
                    p = star + 1;
                    n = matched + 1;
                    backtrack = Some((star, matched + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}
