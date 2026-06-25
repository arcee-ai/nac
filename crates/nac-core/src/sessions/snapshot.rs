use super::*;

fn now_utc() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let nanos = d.subsec_nanos();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, rem) = (rem / 3_600, rem % 3_600);
    let (m, s) = (rem / 60, rem % 60);
    let (mut y, mut mo, mut day) = (1970i64, 1u32, 1u32);
    let mut remaining = days as i64;
    loop {
        let yd = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < yd {
            break;
        }
        remaining -= yd;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let mdays = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for md in mdays {
        if remaining < md as i64 {
            break;
        }
        remaining -= md as i64;
        mo += 1;
    }
    day += remaining as u32;
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:09}",
        y, mo, day, h, m, s, nanos
    )
}

pub fn new_snapshot(
    session_id: String,
    cwd: PathBuf,
    model: String,
    base_url: String,
    backend: BackendKind,
    reasoning_effort: Option<ReasoningEffort>,
    sandbox_spec: Option<SandboxSpec>,
    ssh_host: Option<String>,
    messages: Vec<Message>,
    api_key_env: Option<String>,
    extra_headers: BTreeMap<String, String>,
) -> SessionSnapshot {
    let now = now_utc();
    SessionSnapshot {
        session_id,
        cwd,
        model,
        base_url,
        backend,
        reasoning_effort,
        sandbox_spec,
        ssh_host,
        api_key_env,
        extra_headers,
        messages,
        last_response_duration_ms: None,
        previous_response_duration_ms: None,
        response_durations_ms: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn refresh_snapshot(
    snapshot: &SessionSnapshot,
    messages: Vec<Message>,
    last_response_duration_ms: Option<u64>,
    previous_response_duration_ms: Option<u64>,
    response_durations_ms: Option<Vec<Option<u64>>>,
) -> SessionSnapshot {
    SessionSnapshot {
        session_id: snapshot.session_id.clone(),
        cwd: snapshot.cwd.clone(),
        model: snapshot.model.clone(),
        base_url: snapshot.base_url.clone(),
        backend: snapshot.backend,
        reasoning_effort: snapshot.reasoning_effort,
        sandbox_spec: snapshot.sandbox_spec.clone(),
        ssh_host: snapshot.ssh_host.clone(),
        api_key_env: snapshot.api_key_env.clone(),
        extra_headers: snapshot.extra_headers.clone(),
        messages,
        last_response_duration_ms,
        previous_response_duration_ms,
        response_durations_ms,
        created_at: snapshot.created_at.clone(),
        updated_at: now_utc(),
    }
}
