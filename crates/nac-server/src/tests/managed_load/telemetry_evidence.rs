//! Bounded telemetry export and distribution evidence for the load lanes.
use super::*;

pub(super) async fn drain_telemetry(
    recorder: &nac_core::telemetry::TelemetryRecorder,
    exporter: &nac_core::telemetry::InMemoryExporter,
) -> TelemetryEvidence {
    let deadline = Instant::now() + Duration::from_secs(2);
    let stats = loop {
        let stats = recorder.stats();
        if stats.exported + stats.failures >= stats.accepted {
            break stats;
        }
        assert!(Instant::now() < deadline, "telemetry export did not drain");
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    let events = exporter.events();
    let mut store_latencies: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    let mut api_latencies: BTreeMap<String, Vec<u64>> = BTreeMap::new();
    let mut evidence = TelemetryEvidence {
        store_latency_us: BTreeMap::new(),
        api_latency_us: BTreeMap::new(),
        max_connection_active: 0,
        max_persistence_queue_active: 0,
        max_orchestrators_active: 0,
        max_child_processes_active: 0,
        child_process_started: BTreeSet::new(),
        child_process_stopped: BTreeSet::new(),
        max_cpu_time_us: 0,
        max_resident_memory_bytes: 0,
        accepted: stats.accepted,
        dropped: stats.dropped,
        exported: stats.exported,
        failures: stats.failures,
    };
    for event in events {
        if let (Some(operation), Some(duration)) = (event.operation, event.duration_us) {
            store_latencies
                .entry(serde_label(operation))
                .or_default()
                .push(duration);
        }
        if event.name == nac_core::telemetry::TelemetryName::HttpRequestDuration {
            if let (Some(route), Some(duration)) = (event.route, event.duration_us) {
                api_latencies.entry(route).or_default().push(duration);
            }
        }
        let value = event.value.unwrap_or(0);
        match (event.name, event.activity) {
            (nac_core::telemetry::TelemetryName::StoreConnectionActive, _) => {
                evidence.max_connection_active = evidence.max_connection_active.max(value);
            }
            (nac_core::telemetry::TelemetryName::PersistenceQueueActive, _) => {
                evidence.max_persistence_queue_active =
                    evidence.max_persistence_queue_active.max(value);
            }
            (
                nac_core::telemetry::TelemetryName::RuntimeActivityActive,
                Some(nac_core::telemetry::RuntimeActivity::Orchestrator),
            ) => evidence.max_orchestrators_active = evidence.max_orchestrators_active.max(value),
            (
                nac_core::telemetry::TelemetryName::RuntimeActivityActive,
                Some(nac_core::telemetry::RuntimeActivity::ChildProcess),
            ) => {
                evidence.max_child_processes_active =
                    evidence.max_child_processes_active.max(value);
            }
            _ => {}
        }
        if event.name == nac_core::telemetry::TelemetryName::ChildProcess {
            if let Some(pid) = event.pid {
                match event.outcome {
                    Some(nac_core::telemetry::TelemetryOutcome::Started) => {
                        evidence.child_process_started.insert(pid);
                    }
                    Some(nac_core::telemetry::TelemetryOutcome::Stopped) => {
                        evidence.child_process_stopped.insert(pid);
                    }
                    _ => {}
                }
            }
        }
        evidence.max_cpu_time_us = evidence.max_cpu_time_us.max(event.cpu_time_us.unwrap_or(0));
        evidence.max_resident_memory_bytes = evidence
            .max_resident_memory_bytes
            .max(event.resident_memory_bytes.unwrap_or(0));
    }
    evidence.store_latency_us = store_latencies
        .into_iter()
        .map(|(name, values)| (name, LatencyDistribution::from_values(values)))
        .collect();
    evidence.api_latency_us = api_latencies
        .into_iter()
        .map(|(name, values)| (name, LatencyDistribution::from_values(values)))
        .collect();
    evidence
}

fn serde_label(value: impl Serialize) -> String {
    serde_json::to_value(value)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}
