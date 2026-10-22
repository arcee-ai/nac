//! Input refusal controls. These numbers are fixtures, not selected policy.
use super::*;

fn scope() -> ScopeCapacityInput {
    ScopeCapacityInput {
        endpoints: Some(2),
        live_jobs: Some(3),
        native_payload_bytes: Some(4096),
        captured_results: Some(4),
        captured_bytes: Some(8192),
    }
}
fn input() -> CapacityInput {
    CapacityInput {
        host: Some(scope()),
        session: Some(scope()),
        max_sessions: Some(2),
    }
}

#[test]
fn missing_scope_or_session_count_never_inherits_a_default() {
    for missing in 0..3 {
        let mut candidate = input();
        match missing {
            0 => candidate.host = None,
            1 => candidate.session = None,
            _ => candidate.max_sessions = None,
        }
        assert!(candidate.validate().is_err());
    }
    let mut candidate = input();
    candidate.max_sessions = Some(0);
    assert!(candidate.validate().is_err());
}

#[test]
fn every_dimension_is_required_independently_in_both_scopes() {
    for host in [false, true] {
        for dimension in 0..5 {
            let mut candidate = input();
            let scope = if host {
                candidate.host.as_mut().unwrap()
            } else {
                candidate.session.as_mut().unwrap()
            };
            match dimension {
                0 => scope.endpoints = None,
                1 => scope.live_jobs = None,
                2 => scope.native_payload_bytes = None,
                3 => scope.captured_results = None,
                _ => scope.captured_bytes = None,
            }
            let error = candidate
                .validate()
                .err()
                .expect("missing dimension refused");
            let scope = if host { "host" } else { "session" };
            assert!(error.to_string().contains(scope));
        }
    }
}

#[test]
fn zero_dimensions_are_explicit_denial_data() {
    let zero = ScopeCapacityInput {
        endpoints: Some(0),
        live_jobs: Some(0),
        native_payload_bytes: Some(0),
        captured_results: Some(0),
        captured_bytes: Some(0),
    };
    let validated = CapacityInput {
        host: Some(zero),
        session: Some(zero),
        max_sessions: Some(1),
    }
    .validate()
    .unwrap();
    assert_eq!(validated.host.endpoints, 0);
    assert_eq!(validated.host.live_jobs, 0);
    assert_eq!(validated.host.native_payload_bytes, 0);
    assert_eq!(validated.session.captured_results, 0);
    assert_eq!(validated.session.captured_bytes, 0);
    assert_eq!(validated.max_sessions.get(), 1);
}

#[test]
fn ceilings_are_independent_and_values_are_not_clamped_or_multiplied() {
    let mut candidate = input();
    candidate.host.as_mut().unwrap().endpoints = Some(1);
    candidate.session.as_mut().unwrap().endpoints = Some(usize::MAX as u64);
    candidate.max_sessions = Some(usize::MAX as u64);
    let validated = candidate.validate().unwrap();
    assert_eq!(validated.host.endpoints, 1);
    assert_eq!(validated.session.endpoints, usize::MAX);
    assert_eq!(validated.max_sessions.get(), usize::MAX);
    assert_eq!(validated.host.native_payload_bytes, 4096);
    assert_eq!(validated.session.captured_results, 4);
}

#[cfg(target_pointer_width = "32")]
#[test]
fn oversized_input_refuses_instead_of_truncating_on_32_bit_hosts() {
    let mut candidate = input();
    candidate.host.as_mut().unwrap().captured_bytes = Some(u64::from(u32::MAX) + 1);
    assert!(candidate.validate().is_err());
    let mut candidate = input();
    candidate.max_sessions = Some(u64::from(u32::MAX) + 1);
    assert!(candidate.validate().is_err());
}
