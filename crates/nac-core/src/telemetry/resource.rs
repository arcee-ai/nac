use super::{enabled, global_record, Correlation, Observation, TelemetryKind, TelemetryName};

pub fn emit_resource_sample(correlation: Correlation, pid: Option<u32>) {
    if !enabled() {
        return;
    }
    let target_pid = pid.unwrap_or_else(std::process::id);
    let (cpu_time_us, resident_memory_bytes) = process_resource_sample(target_pid);
    global_record(Observation {
        name: TelemetryName::ResourceSample,
        kind: TelemetryKind::Gauge,
        operation: None,
        activity: None,
        route: None,
        outcome: None,
        duration_us: None,
        value: None,
        pid: Some(target_pid),
        cpu_time_us,
        resident_memory_bytes,
        error: None,
        correlation,
    });
}

#[cfg(target_os = "linux")]
fn process_resource_sample(pid: u32) -> (Option<u64>, Option<u64>) {
    if pid != std::process::id() {
        return linux_process_resource_sample(pid);
    }
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` initializes the supplied `rusage` structure when it
    // returns zero; the pointer is valid for the duration of the call.
    let cpu_time_us = (unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0)
        .then(|| {
            // SAFETY: successful `getrusage` initialized the structure above.
            let usage = unsafe { usage.assume_init() };
            timeval_micros(usage.ru_utime).saturating_add(timeval_micros(usage.ru_stime))
        });
    let resident_memory_bytes = std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|contents| contents.split_whitespace().nth(1)?.parse::<u64>().ok())
        .map(|pages| {
            // SAFETY: `_SC_PAGESIZE` is a read-only process configuration query.
            let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
            pages.saturating_mul(u64::try_from(page_size).unwrap_or(0))
        });
    (cpu_time_us, resident_memory_bytes)
}

#[cfg(target_os = "linux")]
fn linux_process_resource_sample(pid: u32) -> (Option<u64>, Option<u64>) {
    let cpu_time_us = std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|contents| {
            let fields = contents
                .rsplit_once(") ")?
                .1
                .split_whitespace()
                .collect::<Vec<_>>();
            let ticks = fields
                .get(11)?
                .parse::<u64>()
                .ok()?
                .saturating_add(fields.get(12)?.parse::<u64>().ok()?);
            // SAFETY: `_SC_CLK_TCK` is a read-only process configuration query.
            let ticks_per_second = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
            (ticks_per_second > 0).then(|| {
                ticks.saturating_mul(1_000_000) / u64::try_from(ticks_per_second).unwrap_or(1)
            })
        });
    let resident_memory_bytes = std::fs::read_to_string(format!("/proc/{pid}/statm"))
        .ok()
        .and_then(|contents| contents.split_whitespace().nth(1)?.parse::<u64>().ok())
        .map(|pages| {
            // SAFETY: `_SC_PAGESIZE` is a read-only process configuration query.
            let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
            pages.saturating_mul(u64::try_from(page_size).unwrap_or(0))
        });
    (cpu_time_us, resident_memory_bytes)
}

#[cfg(unix)]
fn timeval_micros(value: libc::timeval) -> u64 {
    u64::try_from(value.tv_sec)
        .unwrap_or(0)
        .saturating_mul(1_000_000)
        .saturating_add(u64::try_from(value.tv_usec).unwrap_or(0))
}

#[cfg(all(unix, not(target_os = "linux")))]
fn process_resource_sample(pid: u32) -> (Option<u64>, Option<u64>) {
    if pid != std::process::id() {
        return (None, None);
    }
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: `getrusage` initializes the supplied record on success.
    let cpu_time_us = (unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) } == 0)
        .then(|| {
            // SAFETY: successful `getrusage` initialized the structure above.
            let usage = unsafe { usage.assume_init() };
            timeval_micros(usage.ru_utime).saturating_add(timeval_micros(usage.ru_stime))
        });
    (cpu_time_us, None)
}

#[cfg(not(unix))]
fn process_resource_sample(_pid: u32) -> (Option<u64>, Option<u64>) {
    (None, None)
}
