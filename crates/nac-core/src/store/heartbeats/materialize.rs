use super::*;

pub(super) fn pending_occurrence(
    conn: &Connection,
    schedule: &HeartbeatSchedule,
    first: i64,
    last: i64,
    count: i64,
    run_now: bool,
) -> Result<HeartbeatOccurrence> {
    let pending=conn.query_row(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE schedule_id=?1 AND state='pending'"),[&schedule.schedule_id],occurrence_row).optional()?;
    let id = if let Some(pending) = pending {
        ensure!(
            pending.schedule_version == schedule.version,
            "stale heartbeat pending occurrence"
        );
        let total = pending
            .coalesced_count
            .checked_add(count)
            .context("heartbeat coalescing overflow")?;
        conn.execute("UPDATE heartbeat_occurrences SET due_first_ms=min(due_first_ms,?2),due_last_ms=max(due_last_ms,?3),coalesced_count=?4,expected_revision=expected_revision+1 WHERE occurrence_id=?1",params![pending.occurrence_id,first,last,total])?;
        pending.occurrence_id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT INTO heartbeat_occurrences(occurrence_id,schedule_id,session_id,schedule_version,due_first_ms,due_last_ms,coalesced_count,source,state,specification_json,receipt_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9,?10)",params![id,schedule.schedule_id,schedule.session_id,schedule.version,first,last,count,if run_now{"run_now"}else{"interval"},encode(&schedule.spec)?,uuid::Uuid::new_v4().to_string()])?;
        id
    };
    Ok(conn.query_row(
        &format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE occurrence_id=?1"),
        [id],
        occurrence_row,
    )?)
}

coordinated_command! {
/// The wall clock is merely input: durable next_due decides eligibility. One
/// transaction advances each anchor and materializes/coalesces at most one row.
pub fn materialize_heartbeats(path:&Path,now_ms:i64) -> Result<Vec<HeartbeatOccurrence>> {
    ensure!(now_ms>=0,"invalid heartbeat time");
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let due={
        let mut query=tx.prepare(&format!("SELECT {SCHEDULE_COLUMNS} FROM heartbeat_schedules WHERE state='active' AND next_due_ms<=?1 ORDER BY next_due_ms,schedule_id LIMIT ?2"))?;
        let rows=query.query_map(params![now_ms,MAX_HEARTBEAT_SCHEDULES],schedule_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for schedule in due {
        let steps=now_ms.checked_sub(schedule.next_due_ms).and_then(|n| n.checked_div(schedule.spec.interval_ms)).and_then(|n|n.checked_add(1)).context("heartbeat cadence overflow")?;
        let advance=steps.checked_mul(schedule.spec.interval_ms).context("heartbeat cadence overflow")?;
        let next=schedule.next_due_ms.checked_add(advance).context("heartbeat cadence overflow")?;
        pending_occurrence(&tx,&schedule,schedule.next_due_ms,next-schedule.spec.interval_ms,steps,false)?;
        tx.execute("UPDATE heartbeat_schedules SET next_due_ms=?2,updated_at_ms=?3 WHERE schedule_id=?1",params![schedule.schedule_id,next,now_ms])?;
    }
    let pending={
        let mut query=tx.prepare(&format!("SELECT {OCCURRENCE_COLUMNS} FROM heartbeat_occurrences WHERE state='pending' ORDER BY due_first_ms,occurrence_id LIMIT ?1"))?;
        let rows=query.query_map([MAX_HEARTBEAT_SCHEDULES],occurrence_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    tx.commit()?;
    Ok(pending)
}
command MaterializeHeartbeatsCommand {now_ms:i64=now_ms}
call |command| (command.now_ms)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}
