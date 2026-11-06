//! Host-wide retained resources are finite and explicitly changed. Reservations
//! and allowance changes serialize in the same durable writer transaction.
use super::*;

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FreshTaskRetainedAllowanceChange {
    pub request_id: String,
    pub expected_revision: i64,
    pub retained_limit: i64,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FreshTaskRetainedAllowance {
    pub revision: i64,
    pub retained_limit: i64,
    /// Includes partial preparations and deleted tasks, across all projects.
    pub retained_count: i64,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FreshTaskRetainedAllowanceReceipt {
    pub request_id: String,
    pub allowance: FreshTaskRetainedAllowance,
}

fn read(conn: &Connection) -> Result<FreshTaskRetainedAllowance> {
    Ok(conn.query_row(
        "SELECT revision,retained_limit,(SELECT count(*) FROM heartbeat_task_launches)
         FROM heartbeat_retained_allowance WHERE singleton=1",
        [],
        |row| {
            Ok(FreshTaskRetainedAllowance {
                revision: row.get(0)?,
                retained_limit: row.get(1)?,
                retained_count: row.get(2)?,
            })
        },
    )?)
}

coordinated_command! {
/// Passive host inventory; this never changes a schedule or execution owner.
pub fn fresh_heartbeat_retained_allowance(path:&Path)->Result<FreshTaskRetainedAllowance> {
    let conn=open_runtime_connection(path)?;
    read(&conn)
}
command FreshHeartbeatRetainedAllowanceCommand {}
call |_c| ()
correlation |_c| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// The serving human operation authorizes this command. A lost acknowledgement
/// returns its original receipt before checking the now-current revision/count.
/// Reducing an allowance affects future reservations, never retained resources.
pub fn change_fresh_heartbeat_retained_allowance(path:&Path,change:&FreshTaskRetainedAllowanceChange,expected_binding:&HeartbeatBinding)->Result<FreshTaskRetainedAllowanceReceipt> {
    ensure!(uuid::Uuid::parse_str(&change.request_id).is_ok_and(|id|id.to_string()==change.request_id),"retained allowance request identity must be a canonical UUID");
    ensure!(change.expected_revision>=1,"invalid retained allowance expected revision");
    ensure!((1..=10_000).contains(&change.retained_limit),"host retained allowance must be between 1 and 10000");
    let project=expected_binding.project_id.as_deref().context("host allowance requires an exact saved Local project policy context")?;
    ensure!(expected_binding.backend=="local","host allowance cannot switch its selected backend");
    let digest=format!("{:x}",Sha256::digest(encode(&(project,change.expected_revision,change.retained_limit))?.as_bytes()));
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let prior:Option<(String,String)>=tx.query_row("SELECT canonical_digest,response_json FROM heartbeat_retained_commands WHERE request_id=?1",[&change.request_id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    if let Some((prior_digest,response))=prior {
        ensure!(prior_digest==digest,"conflict: retained allowance request identity changed its arguments");
        return Ok(serde_json::from_str(&response)?);
    }
    ensure!(expected_binding.same_target(&current_project_binding(&tx,project)?),"conflict: retained allowance project policy binding changed before commit");
    let current=read(&tx)?;
    ensure!(current.revision==change.expected_revision,"conflict: host retained allowance revision changed; review the current host inventory");
    let commands:i64=tx.query_row("SELECT count(*) FROM heartbeat_retained_commands",[],|row|row.get(0))?;
    ensure!(commands<HEARTBEAT_COMMAND_LIMIT,"host retained allowance command receipt capacity exhausted; existing resources and exact retries remain retained");
    let revision=current.revision.checked_add(1).context("host retained allowance revision exhausted")?;
    tx.execute("UPDATE heartbeat_retained_allowance SET retained_limit=?1,revision=?2 WHERE singleton=1",params![change.retained_limit,revision])?;
    let receipt=FreshTaskRetainedAllowanceReceipt { request_id:change.request_id.clone(),allowance:FreshTaskRetainedAllowance {revision,retained_limit:change.retained_limit,retained_count:current.retained_count}};
    tx.execute("INSERT INTO heartbeat_retained_commands(request_id,canonical_digest,response_json) VALUES(?1,?2,?3)",params![change.request_id,digest,encode(&receipt)?])?;
    tx.commit()?;
    Ok(receipt)
}
command ChangeFreshHeartbeatRetainedAllowanceCommand {change:FreshTaskRetainedAllowanceChange=change.clone(),expected_binding:HeartbeatBinding=expected_binding.clone()}
call |c| (&c.change,&c.expected_binding)
correlation |_c| crate::telemetry::Correlation::default();
port public;
}
