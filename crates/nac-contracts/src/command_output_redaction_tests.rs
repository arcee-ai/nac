use super::*;
use crate::CommandEnvironmentSnapshot;
use std::collections::BTreeMap;

fn snapshot(values: &[&str]) -> CommandEnvironmentSnapshot {
    CommandEnvironmentSnapshot::from_parts(
        BTreeMap::new(),
        values.iter().map(|value| (*value).to_string()).collect(),
    )
}

#[test]
fn every_three_chunk_partition_masks_complete_and_overlapping_values() {
    for (input, values, expected) in [
        ("xxsecret-tokenyy", vec!["secret-token"], "xx[REDACTED]yy"),
        ("ababa", vec!["aba", "bab"], "[REDACTED]"),
        (
            "prefix-secret-suffix",
            vec!["prefix-secret", "prefix-secret-suffix"],
            "[REDACTED]",
        ),
        (
            "\x1b[31msecret\x1b[0m",
            vec!["secret"],
            "\x1b[31m[REDACTED]\x1b[0m",
        ),
        ("中文🙂TOKEN尾", vec!["TOKEN"], "中文🙂[REDACTED]尾"),
        ("partial sec", vec!["secret"], "partial sec"),
        ("a", vec!["a", "", "a"], "[REDACTED]"),
        ("secrettoken", vec!["secret", "token"], "[REDACTED]"),
    ] {
        let bytes = input.as_bytes();
        for first in 0..=bytes.len() {
            for second in first..=bytes.len() {
                let mut redactor = snapshot(&values).stream_redactor();
                let mut output = Vec::new();
                for chunk in [&bytes[..first], &bytes[first..second], &bytes[second..]] {
                    output.extend(redactor.push(chunk));
                    assert!(redactor.pending.len() < values.iter().map(|s| s.len()).max().unwrap());
                    for value in values.iter().filter(|value| !value.is_empty()) {
                        assert!(!output
                            .windows(value.len())
                            .any(|bytes| bytes == value.as_bytes()));
                    }
                }
                output.extend(redactor.finish());
                assert_eq!(
                    output,
                    expected.as_bytes(),
                    "{input:?}, splits {first}/{second}"
                );
            }
        }
    }
}

#[test]
fn ordinary_and_invalid_utf8_bytes_pass_through_without_loss() {
    let input = b"\xff\xfe\x1b[2J\x00\r\n\xe4\xb8\xad";
    for values in [vec![], vec![""], vec!["unrelated-secret"]] {
        let mut redactor = snapshot(&values).stream_redactor();
        let mut output = Vec::new();
        for byte in input {
            output.extend(redactor.push(&[*byte]));
        }
        output.extend(redactor.finish());
        assert_eq!(output, input);
    }
}

#[test]
fn ambiguous_idle_prefix_is_withheld_until_disambiguated_or_eof() {
    let mut redactor = snapshot(&["secret"]).stream_redactor();
    assert_eq!(redactor.push(b"prompt sec"), b"prompt ");
    assert_eq!(redactor.push(b""), b"");
    assert_eq!(redactor.push(b"r"), b"");
    assert_eq!(redactor.push(b"et"), REDACTED);
    assert_eq!(redactor.finish(), b"");

    let mut redactor = snapshot(&["secret"]).stream_redactor();
    assert_eq!(redactor.push(b"sec"), b"");
    assert_eq!(redactor.push(b"ular"), b"secular");
    assert_eq!(redactor.finish(), b"");

    let mut redactor = snapshot(&["secret"]).stream_redactor();
    assert_eq!(redactor.push(b"sec"), b"");
    assert_eq!(redactor.finish(), b"sec");
}

#[test]
fn long_overlapping_matches_keep_buffer_and_range_count_bounded() {
    let value = "a".repeat(4096);
    let mut redactor = snapshot(&[&value]).stream_redactor();
    let mut output = Vec::new();
    for _ in 0..50_000 {
        output.extend(redactor.push(b"a"));
        assert!(redactor.pending.len() < value.len());
        assert!(redactor.masked.len() <= 1);
    }
    output.extend(redactor.finish());
    assert_eq!(output, REDACTED);
}

#[test]
fn snapshot_replacement_does_not_change_existing_stream_authority() {
    let original = snapshot(&["old-token"]);
    let mut existing = original.stream_redactor();
    let mut replacement = snapshot(&["new-token"]).stream_redactor();
    assert_eq!(
        existing.push(b"old-token new-token"),
        b"[REDACTED] new-token"
    );
    assert_eq!(
        replacement.push(b"old-token new-token"),
        b"old-token [REDACTED]"
    );
    assert!(existing.finish().is_empty());
    assert!(replacement.finish().is_empty());
    assert_eq!(original.redact("old-token"), "[REDACTED]");
}

fn reference(input: &[u8], values: &[&str]) -> Vec<u8> {
    let mut mask = vec![false; input.len()];
    for value in values.iter().filter(|value| !value.is_empty()) {
        for (start, window) in input.windows(value.len()).enumerate() {
            if window == value.as_bytes() {
                mask[start..start + value.len()].fill(true);
            }
        }
    }
    let mut output = Vec::new();
    let mut previous = false;
    for (byte, masked) in input.iter().zip(mask) {
        if masked && !previous {
            output.extend_from_slice(REDACTED);
        } else if !masked {
            output.push(*byte);
        }
        previous = masked;
    }
    output
}

#[test]
fn binary_alphabet_streams_match_whole_input_union_oracle() {
    for length in 0..=9 {
        for encoding in 0..(1 << length) {
            let input = (0..length)
                .map(|bit| {
                    if encoding & (1 << bit) == 0 {
                        b'a'
                    } else {
                        b'b'
                    }
                })
                .collect::<Vec<_>>();
            for values in [
                vec!["aba", "bab"],
                vec!["a", "aab"],
                vec!["bb", "abb", "baba"],
            ] {
                for chunk_bytes in 1..=4 {
                    let mut redactor = snapshot(&values).stream_redactor();
                    let mut output = Vec::new();
                    for chunk in input.chunks(chunk_bytes) {
                        output.extend(redactor.push(chunk));
                    }
                    output.extend(redactor.finish());
                    assert_eq!(output, reference(&input, &values), "{input:?}, {values:?}");
                }
            }
        }
    }
}
