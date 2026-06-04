/// Parse Emacs-style key notation into raw bytes. Text outside `<KEY>` spans
/// passes through as literal UTF-8; unrecognised keys are kept verbatim.
/// Matching is case-insensitive.
pub fn parse_keys(input: &str) -> Vec<u8> {
    let chars: Vec<char> = input.chars().collect();
    let mut result = Vec::with_capacity(input.len());
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '<' {
            if let Some(end) = chars[i + 1..].iter().position(|&c| c == '>') {
                let j = i + 1 + end;
                let key: String = chars[i + 1..j].iter().collect();
                if let Some(expansion) = expand_key(&key) {
                    result.extend_from_slice(&expansion);
                    i = j + 1;
                    continue;
                }
            }
        }
        let mut buf = [0u8; 4];
        let encoded = chars[i].encode_utf8(&mut buf);
        result.extend_from_slice(encoded.as_bytes());
        i += 1;
    }
    result
}

fn expand_key(key: &str) -> Option<Vec<u8>> {
    let u = key.to_uppercase();
    match u.as_str() {
        "RET" | "RETURN" | "ENTER" => Some(vec![b'\r']),
        "TAB" => Some(vec![b'\t']),
        "BSPC" | "BACKSPACE" => Some(vec![0x7f]),
        "ESC" | "ESCAPE" => Some(vec![0x1b]),
        "UP" => Some(vec![0x1b, b'[', b'A']),
        "DOWN" => Some(vec![0x1b, b'[', b'B']),
        "RIGHT" => Some(vec![0x1b, b'[', b'C']),
        "LEFT" => Some(vec![0x1b, b'[', b'D']),
        "C-C" | "CTRL-C" | "CTRL+C" => Some(vec![0x03]),
        "C-D" | "CTRL-D" | "CTRL+D" => Some(vec![0x04]),
        "C-Z" | "CTRL-Z" | "CTRL+Z" => Some(vec![0x1a]),
        "C-/" | "CTRL-/" | "CTRL+SLASH" | "C-\\" | "CTRL-\\" | "CTRL+\\" => Some(vec![0x1c]),
        _ => {
            let letter = u
                .strip_prefix("CTRL-")
                .or_else(|| u.strip_prefix("CTRL+"))
                .or_else(|| u.strip_prefix("C-"))
                .and_then(|s| s.chars().next())?;
            if letter.is_ascii_uppercase() {
                Some(vec![letter as u8 - b'A' + 1])
            } else if letter.is_ascii_lowercase() {
                Some(vec![letter.to_ascii_uppercase() as u8 - b'A' + 1])
            } else {
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_text() {
        assert_eq!(parse_keys("hello"), b"hello".to_vec());
        assert_eq!(parse_keys("echo 'hi'\n"), b"echo 'hi'\n".to_vec());
    }

    #[test]
    fn ret_and_enter() {
        assert_eq!(parse_keys("ls<RET>"), b"ls\r".to_vec());
        assert_eq!(parse_keys("pwd<ENTER>"), b"pwd\r".to_vec());
    }

    #[test]
    fn ctrl_keys() {
        assert_eq!(parse_keys("<C-c>"), vec![0x03]);
        assert_eq!(parse_keys("<C-d>"), vec![0x04]);
        assert_eq!(parse_keys("<C-a>"), vec![0x01]);
        assert_eq!(parse_keys("<C-z>"), vec![0x1a]);
        assert_eq!(parse_keys("<CTRL+C>"), vec![0x03]);
    }

    #[test]
    fn mixed() {
        assert_eq!(parse_keys("cargo build<RET>"), b"cargo build\r".to_vec());
    }

    #[test]
    fn unknown_key_passthrough() {
        assert_eq!(parse_keys("echo <F5> test"), b"echo <F5> test".to_vec());
    }

    #[test]
    fn arrows() {
        assert_eq!(parse_keys("<UP>"), vec![0x1b, b'[', b'A']);
        assert_eq!(parse_keys("<DOWN>"), vec![0x1b, b'[', b'B']);
        assert_eq!(parse_keys("<RIGHT>"), vec![0x1b, b'[', b'C']);
        assert_eq!(parse_keys("<LEFT>"), vec![0x1b, b'[', b'D']);
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(parse_keys("<ret>"), b"\r".to_vec());
        assert_eq!(parse_keys("<Ret>"), b"\r".to_vec());
    }
}
