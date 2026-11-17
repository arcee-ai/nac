//! Health and readiness observations shared by the bounded load lanes.
use super::*;

#[derive(Clone, Debug, Serialize)]
pub(super) struct ProbeSample {
    phase: &'static str,
    route: &'static str,
    status: u16,
    latency_us: u128,
    observed_unix_ms: u128,
}

pub(super) async fn probe_pair(app: &Router, phase: &'static str) -> Vec<ProbeSample> {
    let mut samples = Vec::new();
    for route in ["/healthz", "/readyz"] {
        let started = Instant::now();
        let response = tokio::time::timeout(
            PROBE_SETTLEMENT_TIMEOUT,
            get_response(app.clone(), route, None),
        )
        .await
        .unwrap_or_else(|_| panic!("{route} exceeded the probe budget at {phase}"));
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{route} failed at {phase}"
        );
        samples.push(ProbeSample {
            phase,
            route,
            status: response.status().as_u16(),
            latency_us: started.elapsed().as_micros(),
            observed_unix_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        });
    }
    samples
}
