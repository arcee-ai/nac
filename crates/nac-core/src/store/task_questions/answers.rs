//! Exact answer admission and its private inbox/run provenance. An accepted
//! answer is immutable even if its undelivered continuation is cancelled.
use super::*;

#[derive(Clone)]
pub(crate) struct QuestionAgentScope {
    pub caller_session_id: String,
    pub caller_run_id: String,
    pub caller_config_version: i64,
    pub explicit_project: Option<String>,
    pub target_project: Option<String>,
}

pub(crate) struct QuestionAnswerAdmission {
    pub receipt: QuestionAnswerReceipt,
    pub should_wake: bool,
}

fn scope_valid(
    conn: &Connection,
    scope: &QuestionAgentScope,
    target: &QuestionRecord,
) -> Result<bool> {
    let current_project = project(conn, &target.request.session_id)?;
    Ok(
        plain_local(conn, &scope.caller_session_id)? == scope.caller_config_version
            && current_project == scope.target_project
            && match &scope.explicit_project {
                Some(project) => current_project.as_ref() == Some(project),
                None => project(conn, &scope.caller_session_id)? == current_project,
            }
            && super::super::run_recovery::load_run_recovery_with_connection(
                conn,
                &scope.caller_session_id,
            )?
            .is_some_and(|r| {
                r.run_id == scope.caller_run_id && r.status == RunRecoveryStatus::Active
            }),
    )
}

#[cfg(test)]
pub(crate) fn answer_task_question(
    path: &Path,
    session_id: &str,
    input: &QuestionAnswer,
    agent: Option<&QuestionAgentScope>,
    expected_config: i64,
) -> Result<QuestionAnswerAdmission> {
    answer_task_question_bound(
        path,
        session_id,
        input,
        agent,
        expected_config,
        &canonical_digest(input)?,
    )
}

coordinated_command! {
pub(crate) fn answer_task_question_bound(path:&Path,session_id:&str,input:&QuestionAnswer,agent:Option<&QuestionAgentScope>,expected_config:i64,argument_digest:&str)->Result<QuestionAnswerAdmission> {
    anyhow::ensure!(valid_id(&input.request_id)&&input.expected_revision>0,QuestionError::Invalid);
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let question=load(&tx,session_id,&input.request_id)?.ok_or(QuestionError::NotFound)?;
    if agent.is_some() && question.request.responder_class==QuestionResponder::HumanDecision {
        return Err(QuestionError::HumanRequired.into());
    }
    let actor=agent.map_or_else(||"human".to_owned(),|a|format!("agent:{}",a.caller_session_id));
    let canonical=argument_digest;
    if let Some(receipt)=question.answer {
        let (accepted,accepted_actor):(String,String)=tx.query_row("SELECT answer_digest,answer_actor FROM task_questions WHERE session_id=?1 AND request_id=?2",params![session_id,input.request_id],|r|Ok((r.get(0)?,r.get(1)?)))?;
        anyhow::ensure!(accepted==canonical&&accepted_actor==actor,QuestionError::Conflict);
        return Ok(QuestionAnswerAdmission { should_wake:continuation_pending(&tx,&receipt)?,receipt });
    }
    anyhow::ensure!(!input.answer.trim().is_empty()&&input.answer.chars().count()<=4000,QuestionError::Invalid);
    anyhow::ensure!(question.status=="pending"&&question.revision==input.expected_revision
        &&question.request.run_id==input.run_id&&question.request.generation==input.generation
        &&question.config_version==expected_config&&compatible(&tx,&question)?,QuestionError::Conflict);
    if let Some(scope)=agent { anyhow::ensure!(scope_valid(&tx,scope,&question)?,QuestionError::Conflict); }
    // The source may have deliberately yielded or survived a process restart.
    // Explicit failure/cancellation is never made answerable by that rule.
    let terminated:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM session_run_outcomes WHERE session_id=?1 AND run_id=?2 AND (disposition='cancelled' OR (disposition='failed' AND COALESCE(json_extract(failure_json,'$.kind'),'')!='interrupted')))",params![session_id,input.run_id],|r|r.get(0))?;
    anyhow::ensure!(!terminated,QuestionError::Conflict);
    let continuation_run_id=uuid::Uuid::new_v4().to_string();
    let content=format!("Structured question response:\n{}\nThis answers the exact question only; it is not permission approval, a grant or backend authority.",serde_json::json!({"request_id":input.request_id,"source_run_id":input.run_id,"generation":input.generation,"question":question.request.text,"answer":input.answer}));
    let now=now_utc();
    tx.execute("INSERT INTO session_inbox(session_id,delivery,status,content,created_at,updated_at) VALUES(?1,'queue','pending',?2,?3,?3)",params![session_id,content,now])?;
    let receipt=QuestionAnswerReceipt {session_id:session_id.to_owned(),request_id:input.request_id.clone(),run_id:input.run_id.clone(),generation:input.generation.clone(),revision:question.revision+1,answer:input.answer.clone(),continuation_run_id,inbox_item_id:tx.last_insert_rowid()};
    tx.execute("UPDATE task_questions SET status='answered',revision=?3,answer_digest=?4,answer_actor=?5,answer_json=?6,inbox_item_id=?7,continuation_run_id=?8,continuation_state='pending' WHERE session_id=?1 AND request_id=?2 AND status='pending' AND revision=?9",params![session_id,input.request_id,receipt.revision,canonical,actor,serde_json::to_string(&receipt)?,receipt.inbox_item_id,receipt.continuation_run_id,input.expected_revision])?;
    let changed=load(&tx,session_id,&input.request_id)?.ok_or(QuestionError::NotFound)?;
    tx.commit()?;
    super::super::goal_changes::question_committed(path,&changed);
    Ok(QuestionAnswerAdmission {receipt,should_wake:true})
}
command AnswerTaskQuestion { session_id:String=session_id.to_owned(),input:QuestionAnswer=input.clone(),agent:Option<QuestionAgentScope>=agent.cloned(),expected_config:i64=expected_config,argument_digest:String=argument_digest.to_owned() }
call |command| (&command.session_id,&command.input,command.agent.as_ref(),command.expected_config,&command.argument_digest)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

fn continuation_pending(conn: &Connection, receipt: &QuestionAnswerReceipt) -> Result<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM task_questions q JOIN session_inbox i ON i.id=q.inbox_item_id AND i.session_id=q.session_id WHERE q.session_id=?1 AND q.request_id=?2 AND q.continuation_state='pending' AND i.status='pending' AND q.continuation_run_id=?3)",params![receipt.session_id,receipt.request_id,receipt.continuation_run_id],|r|r.get(0))?)
}

coordinated_command! {
pub(crate) fn question_continuation_run(path:&Path,session_id:&str,inbox_item_id:i64)->Result<Option<String>> {
    let conn=open_runtime_connection(path)?;
    let request:Option<String>=conn.query_row("SELECT request_id FROM task_questions WHERE session_id=?1 AND inbox_item_id=?2",params![session_id,inbox_item_id],|r|r.get(0)).optional()?;
    let Some(request)=request else {return Ok(None)};
    let question=load(&conn,session_id,&request)?.ok_or(QuestionError::NotFound)?;
    let receipt=question.answer.as_ref().ok_or(QuestionError::Conflict)?;
    anyhow::ensure!(compatible(&conn,&question)?&&continuation_pending(&conn,receipt)?,QuestionError::Conflict);
    Ok(Some(receipt.continuation_run_id.clone()))
}
command QuestionContinuationRun {session_id:String=session_id.to_owned(),inbox_item_id:i64=inbox_item_id}
call |command| (&command.session_id,command.inbox_item_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

/// Inside the existing inbox prompt/steer commit. A question response can only
/// reach the one reserved continuation, regardless of another run's activity.
pub(crate) fn consume_question_answer(
    conn: &Connection,
    session: &str,
    item: i64,
    run: &str,
) -> Result<()> {
    let request: Option<String> = conn
        .query_row(
            "SELECT request_id FROM task_questions WHERE session_id=?1 AND inbox_item_id=?2",
            params![session, item],
            |r| r.get(0),
        )
        .optional()?;
    let Some(request) = request else {
        return Ok(());
    };
    let question = load(conn, session, &request)?.ok_or(QuestionError::NotFound)?;
    let receipt = question.answer.as_ref().ok_or(QuestionError::Conflict)?;
    anyhow::ensure!(
        compatible(conn, &question)?
            && question.continuation_state.as_deref() == Some("pending")
            && receipt.continuation_run_id == run,
        QuestionError::Conflict
    );
    conn.execute("UPDATE task_questions SET continuation_state='delivered' WHERE session_id=?1 AND request_id=?2 AND continuation_state='pending'",params![session,request])?;
    Ok(())
}

pub(crate) fn require_question_queue(
    conn: &Connection,
    session: &str,
    item: i64,
    delivery: InboxDelivery,
) -> Result<()> {
    let identified: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM task_questions WHERE session_id=?1 AND inbox_item_id=?2)",
        params![session, item],
        |r| r.get(0),
    )?;
    anyhow::ensure!(
        !identified || delivery == InboxDelivery::Queue,
        QuestionError::Conflict
    );
    Ok(())
}

pub(crate) fn cancel_question_inbox(conn: &Connection, session: &str, item: i64) -> Result<()> {
    conn.execute("UPDATE task_questions SET continuation_state='cancelled',revision=revision+1 WHERE session_id=?1 AND inbox_item_id=?2 AND continuation_state='pending'",params![session,item])?;
    Ok(())
}

/// Caller already owns the surrounding lifecycle transaction. Exact answer
/// receipts remain retained while undelivered inbox obligations are cancelled.
pub(crate) fn invalidate_questions(
    conn: &Connection,
    session: &str,
    source_run: Option<&str>,
) -> Result<()> {
    let now = now_utc();
    conn.execute("UPDATE session_inbox SET status='cancelled',cancelled_at=?3,updated_at=?3,version=version+1 WHERE session_id=?1 AND status='pending' AND id IN(SELECT inbox_item_id FROM task_questions WHERE session_id=?1 AND continuation_state='pending' AND (?2 IS NULL OR json_extract(request_json,'$.run_id')=?2))",params![session,source_run,now])?;
    conn.execute("UPDATE task_questions SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,continuation_state=CASE WHEN continuation_state='pending' THEN 'cancelled' ELSE continuation_state END,revision=revision+1 WHERE session_id=?1 AND (status='pending' OR continuation_state='pending') AND (?2 IS NULL OR json_extract(request_json,'$.run_id')=?2)",params![session,source_run])?;
    Ok(())
}

coordinated_command! {
pub(crate) fn cancel_task_question(path:&Path,session_id:&str,request_id:&str,expected_revision:i64)->Result<QuestionRecord> {
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current=load(&tx,session_id,request_id)?.ok_or(QuestionError::NotFound)?;
    anyhow::ensure!(current.revision==expected_revision,QuestionError::Conflict);
    anyhow::ensure!(current.status=="pending"||current.continuation_state.as_deref()==Some("pending"),QuestionError::Conflict);
    if let Some(receipt)=&current.answer {
        tx.execute("UPDATE session_inbox SET status='cancelled',cancelled_at=?2,updated_at=?2,version=version+1 WHERE id=?1 AND status='pending'",params![receipt.inbox_item_id,now_utc()])?;
    }
    tx.execute("UPDATE task_questions SET status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END,continuation_state=CASE WHEN continuation_state='pending' THEN 'cancelled' ELSE continuation_state END,revision=revision+1 WHERE session_id=?1 AND request_id=?2",params![session_id,request_id])?;
    let question=load(&tx,session_id,request_id)?.ok_or(QuestionError::NotFound)?;
    tx.commit()?;
    super::super::goal_changes::question_committed(path,&question);
    Ok(question)
}
command CancelTaskQuestion {session_id:String=session_id.to_owned(),request_id:String=request_id.to_owned(),expected_revision:i64=expected_revision}
call |command| (&command.session_id,&command.request_id,command.expected_revision)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}
