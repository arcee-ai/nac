//! Inward-facing contracts shared by the durable harness and optional product
//! contexts. This crate stays free of HTTP, providers, persistence, and agent
//! runtime construction so those outer layers can depend on it without cycles.

use std::collections::BTreeMap;

/// Immutable command environment plus the exact secret values that must be
/// redacted from output produced under that environment.
///
/// The type intentionally has no serialization implementation: environment
/// values are process-local capability data, not a persistence or transport
/// contract.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandEnvironmentSnapshot {
    values: BTreeMap<String, String>,
    redactions: Vec<String>,
}

impl CommandEnvironmentSnapshot {
    pub fn empty() -> Self {
        Self {
            values: BTreeMap::new(),
            redactions: Vec::new(),
        }
    }

    pub fn from_parts(values: BTreeMap<String, String>, redactions: Vec<String>) -> Self {
        Self { values, redactions }
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        self.values
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    #[doc(hidden)]
    pub fn insert_dedicated(
        &mut self,
        name: impl Into<String>,
        value: impl Into<String>,
        redact: bool,
    ) {
        let value = value.into();
        if redact && !value.is_empty() {
            self.redactions.push(value.clone());
        }
        self.values.insert(name.into(), value);
    }

    pub fn redact(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        let mut values = self
            .redactions
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        values.sort_by_key(|value| std::cmp::Reverse(value.len()));
        values.dedup();
        for value in values {
            redacted = redacted.replace(value, "[REDACTED]");
        }
        redacted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_redacts_longest_distinct_values_and_keeps_environment_private() {
        let mut snapshot = CommandEnvironmentSnapshot::empty();
        snapshot.insert_dedicated("TOKEN", "secret", true);
        snapshot.insert_dedicated("LONG_TOKEN", "secret-suffix", true);
        snapshot.insert_dedicated("HOME", "/managed/home", false);
        snapshot.insert_dedicated("TOKEN_COPY", "secret", true);

        assert_eq!(snapshot.get("HOME"), Some("/managed/home"));
        assert_eq!(
            snapshot.redact("secret-suffix then secret from /managed/home"),
            "[REDACTED] then [REDACTED] from /managed/home"
        );
    }
}
