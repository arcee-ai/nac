use super::*;

impl PermissionPolicy {
    pub fn for_backend(
        backend: PermissionBackend,
        configured_rules: impl IntoIterator<Item = PermissionRule>,
    ) -> Self {
        let mut rules = backend_defaults(backend);
        rules.extend(configured_rules);
        Self { rules }
    }

    pub fn rules(&self) -> &[PermissionRule] {
        &self.rules
    }

    /// OpenCode-shaped last-match evaluation with deny-before-grant
    /// aggregation. Remembered allows may satisfy an `ask`, but never override
    /// a configured denial or a native hard denial.
    pub fn evaluate(
        &self,
        resources: &[PermissionResource],
        remembered_allows: &[PermissionRule],
    ) -> PermissionDecision {
        if let Some(reason) = resources
            .iter()
            .find_map(|resource| resource.hard_denial.clone())
        {
            return PermissionDecision {
                effect: PermissionEffect::Deny,
                hard_denial: Some(reason),
            };
        }

        if resources.iter().any(|resource| {
            evaluate_one(&resource.action, &resource.resource, &self.rules)
                == PermissionEffect::Deny
        }) {
            return PermissionDecision {
                effect: PermissionEffect::Deny,
                hard_denial: None,
            };
        }

        let effect = resources
            .iter()
            .map(|resource| {
                evaluate_one_with_grants(
                    &resource.action,
                    &resource.resource,
                    &self.rules,
                    remembered_allows,
                )
            })
            .fold(PermissionEffect::Allow, strictest);
        PermissionDecision {
            effect,
            hard_denial: None,
        }
    }

    pub fn wholly_denies(&self, action: &str) -> bool {
        self.rules
            .iter()
            .rev()
            .find(|rule| wildcard_match(&rule.action, action))
            .is_some_and(|rule| rule.resource == "*" && rule.effect == PermissionEffect::Deny)
    }
}

fn evaluate_one_with_grants(
    action: &str,
    resource: &str,
    rules: &[PermissionRule],
    remembered_allows: &[PermissionRule],
) -> PermissionEffect {
    rules
        .iter()
        .chain(remembered_allows.iter())
        .rev()
        .find(|rule| {
            wildcard_match(&rule.action, action) && wildcard_match(&rule.resource, resource)
        })
        .map_or(PermissionEffect::Ask, |rule| rule.effect)
}

fn evaluate_one(action: &str, resource: &str, rules: &[PermissionRule]) -> PermissionEffect {
    rules
        .iter()
        .rev()
        .find(|rule| {
            wildcard_match(&rule.action, action) && wildcard_match(&rule.resource, resource)
        })
        .map_or(PermissionEffect::Ask, |rule| rule.effect)
}

fn strictest(left: PermissionEffect, right: PermissionEffect) -> PermissionEffect {
    use PermissionEffect::{Allow, Ask, Deny};
    match (left, right) {
        (Deny, _) | (_, Deny) => Deny,
        (Ask, _) | (_, Ask) => Ask,
        (Allow, Allow) => Allow,
    }
}

fn backend_defaults(backend: PermissionBackend) -> Vec<PermissionRule> {
    use PermissionEffect::{Allow, Ask};
    let mut rules = vec![
        PermissionRule::new("*", "*", Allow),
        PermissionRule::new("external_directory", "*", Ask),
        PermissionRule::new("execute_opaque", "*", Ask),
        PermissionRule::new("execute_broad", "*", Ask),
        PermissionRule::new("terminal_input", "*", Ask),
        PermissionRule::new("read", "*.env", Ask),
        PermissionRule::new("read", "*.env.*", Ask),
        PermissionRule::new("read", "*.env.example", Allow),
    ];
    if matches!(backend, PermissionBackend::Local | PermissionBackend::Ssh) {
        rules.push(PermissionRule::new("execute", "*", Ask));
        rules.push(PermissionRule::new("execute", "command:[rg]*", Allow));
    }
    rules
}

/// Small `*`/`?` matcher. Both wildcards cross path separators, matching the
/// permission algebra rather than filesystem-glob semantics.
pub fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.chars().collect::<Vec<_>>();
    let value = value.chars().collect::<Vec<_>>();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    for token in pattern {
        let mut current = vec![false; value.len() + 1];
        if token == '*' {
            current[0] = previous[0];
        }
        for index in 1..=value.len() {
            current[index] = match token {
                '*' => previous[index] || current[index - 1],
                '?' => previous[index - 1],
                literal => previous[index - 1] && literal == value[index - 1],
            };
        }
        previous = current;
    }
    previous[value.len()]
}
