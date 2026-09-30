//! Identical bounded SQL contract for every engine. This is a store-stage probe,
//! not the complete server/worker fixture or its application acceptance authority.
use crate::engine::{Backend, Connection};
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

const SEED: u64 = 168886546;
const ITERATIONS: usize = 32;

fn session(id: &str, behavior: &str) -> String {
    format!("INSERT INTO sessions(session_id,behavior,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES('{id}','{behavior}','/disposable','/disposable','deterministic','http://127.0.0.1','[]','fixed','fixed')")
}

fn percentile(values: &[u128], percent: usize) -> u128 {
    values[(values.len() - 1) * percent / 100]
}

pub async fn run(mode: &str, path: &Path, count: usize) -> Result<Value> {
    ensure!([1, 2, 4].contains(&count), "only 1/2/4 supported");
    let started = Instant::now();
    let initial_usage = crate::resources::usage()?;
    let backend = Backend::open(mode, path).await?;
    let conn = backend.connect()?;
    conn.batch("PRAGMA foreign_keys=ON;").await?;
    let prefix = format!("all114-{SEED}-{count}");
    let parent = format!("{prefix}-parent");
    conn.execute(&session(&parent, "direct-with-orchestrator"))
        .await?;
    for ordinal in 0..count {
        let id = format!("{prefix}-{ordinal}");
        conn.execute(&session(&id, "orchestrator")).await?;
        conn.execute(&format!(
            "INSERT INTO threads VALUES('worker','{id}','fixed','fixed')"
        ))
        .await?;
        conn.execute(&format!("INSERT INTO managed_orchestrators(orchestrator_session_id,parent_session_id,root_session_id,description,created_at,updated_at) VALUES('{id}','{parent}','{parent}','deterministic-{ordinal}','fixed','fixed')")).await?;
        ensure!(conn.execute(&format!("UPDATE managed_orchestrators SET status='running',generation=1,run_id='run-{ordinal}',execution_mode='background',version=version+1 WHERE orchestrator_session_id='{id}' AND generation=0 AND status='idle'")).await? == 1, "admission CAS");
    }
    let begin = if mode == "mvcc" {
        "BEGIN CONCURRENT"
    } else {
        "BEGIN IMMEDIATE"
    };
    let mut latency = Vec::new();
    let mut cpu = Vec::new();
    let mut operation_us = serde_json::Map::new();
    // Round-robin order is fixed. No retries, external models, or timing sleeps.
    for position in 0..ITERATIONS {
        for ordinal in 0..count {
            let id = format!("{prefix}-{ordinal}");
            let t = Instant::now();
            let before_cpu = crate::resources::usage()?.cpu_us;
            conn.execute(begin).await?;
            let message = json!({"role":"assistant","content":format!("seed-{SEED}-worker-{ordinal}-{}", "x".repeat(192))}).to_string();
            let event = json!({"nac_transcript_message":{"idx":position,"kind":"assistant","message":message}}).to_string();
            conn.execute(&format!("INSERT INTO thread_events(session_id,thread_name,event_json,created_at) VALUES('{id}','__orchestrator__','{event}','fixed')")).await?;
            conn.execute("COMMIT").await?;
            latency.push(t.elapsed().as_micros());
            cpu.push((crate::resources::usage()?.cpu_us - before_cpu) as u128);
        }
    }
    latency.sort_unstable();
    cpu.sort_unstable();
    operation_us.insert("transcript_append_transaction".into(), json!({"count":latency.len(),"p50":percentile(&latency,50),"p95":percentile(&latency,95),"p99":percentile(&latency,99),"max":latency.last(),"cpu_total_us":cpu.iter().sum::<u128>(),"cpu_p50_us":percentile(&cpu,50),"cpu_p95_us":percentile(&cpu,95),"cpu_p99_us":percentile(&cpu,99)}));
    let gates = Instant::now();
    let mut stale_rejected = 0;
    for ordinal in 0..count {
        let id = format!("{prefix}-{ordinal}");
        ensure!(conn.scalar(&format!("SELECT COUNT(*) FROM thread_events WHERE session_id='{id}' AND thread_name='__orchestrator__'")).await? == ITERATIONS as i64, "lost transcript events");
        ensure!(conn.scalar(&format!("SELECT COUNT(DISTINCT json_extract(event_json,'$.nac_transcript_message.idx')) FROM thread_events WHERE session_id='{id}' AND thread_name='__orchestrator__'")).await? == ITERATIONS as i64, "duplicate transcript positions");
        ensure!(conn.scalar(&format!("SELECT MAX(json_extract(event_json,'$.nac_transcript_message.idx')) FROM thread_events WHERE session_id='{id}' AND thread_name='__orchestrator__'")).await? == ITERATIONS as i64-1, "transcript gap");
        conn.execute(begin).await?;
        ensure!(conn.execute(&format!("UPDATE managed_orchestrators SET status='completed',report='done',version=version+1 WHERE orchestrator_session_id='{id}' AND generation=1 AND run_id='run-{ordinal}' AND status='running'")).await? == 1, "settlement CAS");
        let changed = conn.execute(&format!("UPDATE managed_orchestrators SET status='cancelled' WHERE orchestrator_session_id='{id}' AND generation=0 AND status='running'")).await?;
        ensure!(changed == 0, "stale generation mutated");
        stale_rejected += 1;
        conn.execute(&format!("INSERT INTO episodes(thread_name,session_id,action,content,created_at,status) VALUES('worker','{id}','fixed action','fixed result','fixed','ok')")).await?;
        conn.execute(&format!("INSERT INTO session_inbox(session_id,delivery,content,client_id,created_at,updated_at) VALUES('{parent}','queue','done-{ordinal}','{id}','fixed','fixed')")).await?;
        let inbox = conn.scalar("SELECT last_insert_rowid()").await?;
        conn.execute(&format!("UPDATE managed_orchestrators SET completion_inbox_id={inbox} WHERE orchestrator_session_id='{id}' AND generation=1")).await?;
        ensure!(conn.execute(&format!("UPDATE session_inbox SET status='delivered',delivered_run_id='parent-run',delivered_at='fixed',version=version+1 WHERE id={inbox} AND status='pending'")).await? == 1, "inbox delivery");
        ensure!(conn.execute(&format!("UPDATE session_inbox SET status='delivered',delivered_run_id='parent-run',delivered_at='fixed' WHERE id={inbox} AND status='pending'")).await? == 0, "duplicate delivery");
        conn.execute("COMMIT").await?;
        conn.execute(begin).await?;
        conn.execute(&format!("INSERT INTO episodes(thread_name,session_id,action,content,created_at,status) VALUES('worker','{id}','rollback','discard','fixed','cancelled')")).await?;
        conn.execute("ROLLBACK").await?;
        ensure!(
            conn.scalar(&format!(
                "SELECT COUNT(*) FROM episodes WHERE session_id='{id}'"
            ))
            .await?
                == 1,
            "rollback leaked result"
        );
    }
    operation_us.insert(
        "settlement_worker_inbox_and_rollback".into(),
        json!({"count":count,"total_us":gates.elapsed().as_micros()}),
    );
    let orphan = conn.execute("INSERT INTO episodes(thread_name,session_id,action,content,created_at) VALUES('missing','missing','invalid','invalid','fixed')").await;
    ensure!(orphan.is_err(), "foreign key enforcement absent");
    ensure!(
        conn.query("PRAGMA foreign_key_check").await?.is_empty(),
        "foreign key violation"
    );
    ensure!(
        conn.query("PRAGMA quick_check").await? == vec![vec![json!("ok")]],
        "integrity"
    );
    let checkpoint = conn.query("PRAGMA wal_checkpoint(TRUNCATE)").await;
    let checkpoint = match checkpoint {
        Ok(rows) => json!({"rows":rows}),
        Err(e) => json!({"error":e.to_string()}),
    };
    drop(conn);
    drop(backend);
    let reopened = Backend::open(mode, path).await?;
    let conn = reopened.connect()?;
    ensure!(conn.scalar(&format!("SELECT COUNT(*) FROM managed_orchestrators WHERE parent_session_id='{parent}' AND status='completed' AND completion_inbox_id IS NOT NULL")).await? == count as i64, "reopen lost settlements");
    ensure!(
        conn.scalar(&format!(
            "SELECT COUNT(*) FROM session_inbox WHERE session_id='{parent}' AND status='delivered'"
        ))
        .await?
            == count as i64,
        "reopen lost deliveries"
    );
    let conflict = lock_probe(&reopened, begin).await?;
    let previous = conn
        .scalar(&format!(
            "SELECT config_version FROM sessions WHERE session_id='{parent}'"
        ))
        .await?;
    drop(conn);
    drop(reopened);
    let crash = crate::crash::probe(mode, path, &parent, previous).await?;
    let final_usage = crate::resources::usage()?;
    Ok(
        json!({"cpu_total_us":final_usage.cpu_us-initial_usage.cpu_us,"peak_rss_bytes":final_usage.peak_rss_bytes,"scope":"store-stage-only","seed":SEED,"orchestrators":count,"mode":mode,"iterations":ITERATIONS,"passed":true,"stale_generation_rejected":stale_rejected,"foreign_key_rejected":orphan.err().map(|e|e.to_string()),"checkpoint":checkpoint,"lock_probe":conflict,"crash":crash,"operation_us":operation_us,"retry_count":0,"elapsed_ms":started.elapsed().as_millis(),"store_bytes":std::fs::metadata(path)?.len()}),
    )
}

async fn lock_probe(backend: &Backend, begin: &str) -> Result<Value> {
    let a: Connection = backend.connect()?;
    let b: Connection = backend.connect()?;
    a.batch("PRAGMA foreign_keys=ON;").await?;
    b.batch("PRAGMA foreign_keys=ON;").await?;
    a.execute(begin).await?;
    a.execute("UPDATE sessions SET config_version=config_version+1 WHERE session_id=(SELECT session_id FROM sessions ORDER BY session_id LIMIT 1)").await?;
    let t = Instant::now();
    let b_begin = b.execute(begin).await;
    let competing = if b_begin.is_ok() {
        b.execute("UPDATE sessions SET config_version=config_version+1 WHERE session_id=(SELECT session_id FROM sessions ORDER BY session_id LIMIT 1)").await
    } else {
        b_begin
    };
    let outcome = match competing {
        Ok(n) => json!({"changed":n}),
        Err(e) => json!({"error":e.to_string()}),
    };
    let waited_us = t.elapsed().as_micros();
    // Neither competing write is committed: this characterizes engine lock
    // behavior independently of the NAC application’s lease/retry policy.
    let _ = b.execute("ROLLBACK").await;
    a.execute("ROLLBACK").await?;
    Ok(json!({"outcome":outcome,"waited_us":waited_us}))
}
