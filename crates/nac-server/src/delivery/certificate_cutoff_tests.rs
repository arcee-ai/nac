use super::*;

const HOST: &[u8] = include_bytes!("fixtures/managed_fact_tls/host.der");

fn bounds() -> (SystemTime, SystemTime) {
    let (_, certificate) = X509CertificateParser::new().parse(HOST).unwrap();
    let validity = certificate.validity();
    (
        unix_time(validity.not_before.timestamp()).unwrap(),
        unix_time(validity.not_after.timestamp()).unwrap(),
    )
}

#[test]
fn actual_der_cutoff_preserves_fractional_seconds_and_can_only_tighten() {
    let (_, end) = bounds();
    let start = Instant::now();
    let anchor = CertificateTimeAnchor::for_test(end - Duration::from_millis(100), start);
    assert_eq!(
        anchor
            .tighten(HOST, start + Duration::from_secs(60))
            .unwrap(),
        start + Duration::from_millis(100)
    );
    let earlier = start + Duration::from_millis(10);
    assert_eq!(anchor.tighten(HOST, earlier).unwrap(), earlier);
    // The exact same pair is retained. Re-reading metadata cannot create a
    // new receipt-time deadline even if the observer runs again later.
    assert_eq!(anchor.tighten(HOST, earlier).unwrap(), earlier);
}

#[test]
fn not_after_is_exclusive_and_future_or_unsupported_times_are_refused() {
    let (begin, end) = bounds();
    for utc in [
        begin - Duration::from_nanos(1),
        end,
        end + Duration::from_secs(1),
    ] {
        let start = Instant::now();
        assert!(CertificateTimeAnchor::for_test(utc, start)
            .tighten(HOST, start + Duration::from_secs(1))
            .is_err());
    }
    assert!(unix_time(-1).is_err());
}

#[test]
fn fractional_not_before_cannot_be_floored_into_current_validity() {
    use x509_parser::prelude::FromDer;
    // Actual DER GeneralizedTime accepts .5, although this authority profile
    // supports only RFC5280 whole-second certificate times.
    let (remaining, fractional) = ASN1Time::from_der(b"\x18\x1120261015010203.5Z").unwrap();
    assert!(remaining.is_empty());
    assert_eq!(fractional.to_datetime().nanosecond(), 500_000_000);
    let floored = unix_time(fractional.timestamp()).unwrap();
    let observation = floored + Duration::from_millis(100);
    assert!(
        observation > floored,
        "flooring would admit the future NotBefore"
    );
    assert!(certificate_time(fractional).is_err());
}

#[test]
fn malformed_trailing_oversized_and_unsupported_version_der_fail_closed() {
    let (begin, _) = bounds();
    let start = Instant::now();
    let anchor = CertificateTimeAnchor::for_test(begin, start);
    let cutoff = start + Duration::from_secs(1);
    for bytes in [vec![], vec![0; 32], vec![0; MAX_CERTIFICATE_BYTES + 1]] {
        assert!(anchor.tighten(&bytes, cutoff).is_err());
    }
    let mut trailing = HOST.to_vec();
    trailing.push(0);
    assert!(anchor.tighten(&trailing, cutoff).is_err());
    let mut version = HOST.to_vec();
    let offset = version
        .windows(5)
        .position(|v| v == [0xa0, 3, 2, 1, 2])
        .unwrap();
    version[offset + 4] = 1;
    assert!(anchor.tighten(&version, cutoff).is_err());
}
