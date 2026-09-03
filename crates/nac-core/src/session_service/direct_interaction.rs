use super::*;

impl SessionService {
    fn require_direct_behavior(&self) -> Result<()> {
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            return Err(anyhow::anyhow!(
                "the durable session inbox is available only for direct behaviors"
            ));
        }
        Ok(())
    }

    fn require_direct_primary_behavior(&self) -> Result<()> {
        self.require_direct_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        if crate::store::load_traditional_child(&self.metadata.store_path, session_id)?.is_some() {
            return Err(anyhow::anyhow!(
                "delegated sessions accept input only through their parent"
            ));
        }
        Ok(())
    }

    fn direct_permission_broker(&self) -> Result<&Arc<crate::permissions::PermissionBroker>> {
        self.require_direct_behavior()?;
        self.permission_broker
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("direct permission broker is unavailable"))
    }

    fn require_direct_goal_behavior(&self) -> Result<()> {
        self.require_direct_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        if crate::store::load_traditional_child(&self.metadata.store_path, session_id)?.is_some() {
            return Err(anyhow::anyhow!(
                "traditional child sessions cannot own autonomous goals"
            ));
        }
        Ok(())
    }

    pub fn list_permission_requests(&self) -> Result<Vec<crate::permissions::PermissionRequest>> {
        Ok(self.direct_permission_broker()?.pending())
    }

    pub fn list_permission_grants(&self) -> Result<Vec<crate::store::PermissionGrantRecord>> {
        self.direct_permission_broker()?.grants()
    }

    pub fn reply_permission_request(
        &self,
        request_id: &str,
        reply: crate::permissions::PermissionReply,
    ) -> Result<()> {
        self.direct_permission_broker()?.reply(request_id, reply)
    }

    pub fn delete_permission_grant(&self, grant_id: &str) -> Result<()> {
        self.direct_permission_broker()?.delete_grant(grant_id)
    }

    pub fn list_direct_inbox(&self) -> Result<Vec<crate::store::SessionInboxRecord>> {
        self.require_direct_primary_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::list_session_inbox(&self.metadata.store_path, session_id)
    }

    pub async fn enqueue_direct_input(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        client_id: Option<&SessionClientId>,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_primary_behavior()?;
        self.enqueue_direct_input_unchecked(delivery, content, client_id)
            .await
    }

    /// Parent-owned child control path. Public direct-inbox APIs deliberately
    /// reject the same session; only the validated child controller calls this.
    pub async fn enqueue_traditional_child_input(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        if crate::store::load_traditional_child(&self.metadata.store_path, session_id)?.is_none() {
            return Err(anyhow::anyhow!("traditional child was not found"));
        }
        self.enqueue_direct_input_unchecked(delivery, content, None)
            .await
    }

    async fn enqueue_direct_input_unchecked(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        client_id: Option<&SessionClientId>,
    ) -> Result<crate::store::SessionInboxRecord> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let (record, target_run_id) = {
            let active = self.lock_active_operation();
            let target_run_id = match (delivery, active.as_ref()) {
                (crate::store::InboxDelivery::Steer, Some(ActiveSessionOperation::Run(run)))
                    if !run.finishing =>
                {
                    Some(run.snapshot.run_id.to_string())
                }
                _ => None,
            };
            let record = crate::store::create_session_inbox_item(
                &self.metadata.store_path,
                session_id,
                delivery,
                content,
                target_run_id.as_deref(),
                client_id.map(SessionClientId::as_str),
            )?;
            (record, target_run_id)
        };
        if target_run_id.is_none() {
            self.start_next_direct_inbox_item().await?;
        }
        Ok(record)
    }

    pub async fn update_direct_inbox_item(
        &self,
        item_id: i64,
        expected_version: i64,
        delivery: crate::store::InboxDelivery,
        content: Option<&str>,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_primary_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let (record, interrupt_run_id) = {
            let active = self.lock_active_operation();
            // Queue-list "steer now" interrupts a live agent and promotes that
            // item as the successor prompt. Leave `target_run_id` unset so the
            // dying run cannot consume the item into a cancelled transcript.
            // Task-less helper runs still bind for in-run injection.
            let interrupt_run_id = match (delivery, active.as_ref()) {
                (crate::store::InboxDelivery::Steer, Some(ActiveSessionOperation::Run(run)))
                    if !run.finishing && run.task.is_some() =>
                {
                    Some(run.snapshot.run_id.clone())
                }
                _ => None,
            };
            let target_run_id = match (delivery, active.as_ref(), interrupt_run_id.as_ref()) {
                (
                    crate::store::InboxDelivery::Steer,
                    Some(ActiveSessionOperation::Run(run)),
                    None,
                ) if !run.finishing => Some(run.snapshot.run_id.to_string()),
                _ => None,
            };
            let record = crate::store::update_pending_session_inbox_item(
                &self.metadata.store_path,
                session_id,
                item_id,
                expected_version,
                delivery,
                target_run_id.as_deref(),
                content,
            )?;
            (record, interrupt_run_id)
        };
        if let Some(run_id) = interrupt_run_id {
            self.move_pending_direct_inbox_item_to_front(session_id, record.id)?;
            match self.request_cancel(&run_id).await {
                Ok(()) | Err(SessionCancelError::NotActive { .. }) => {}
                Err(error) => return Err(error.into()),
            }
            if !self.has_active_operation() {
                self.start_next_direct_inbox_item().await?;
            }
            return crate::store::load_session_inbox_item(
                &self.metadata.store_path,
                session_id,
                record.id,
            );
        }
        if record.target_run_id.is_none() {
            self.start_next_direct_inbox_item().await?;
        }
        Ok(record)
    }

    fn move_pending_direct_inbox_item_to_front(
        &self,
        session_id: &str,
        item_id: i64,
    ) -> Result<()> {
        let pending: Vec<i64> =
            crate::store::list_session_inbox(&self.metadata.store_path, session_id)?
                .into_iter()
                .filter(|item| item.status == crate::store::InboxStatus::Pending)
                .map(|item| item.id)
                .collect();
        if pending.first() == Some(&item_id) || !pending.contains(&item_id) {
            return Ok(());
        }
        let mut ordered = Vec::with_capacity(pending.len());
        ordered.push(item_id);
        ordered.extend(pending.into_iter().filter(|id| *id != item_id));
        crate::store::reorder_pending_session_inbox_items(
            &self.metadata.store_path,
            session_id,
            &ordered,
        )?;
        Ok(())
    }

    pub fn reorder_direct_inbox_items(
        &self,
        item_ids: &[i64],
    ) -> Result<Vec<crate::store::SessionInboxRecord>> {
        self.require_direct_primary_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::reorder_pending_session_inbox_items(
            &self.metadata.store_path,
            session_id,
            item_ids,
        )
    }

    pub fn cancel_direct_inbox_item(
        &self,
        item_id: i64,
        expected_version: i64,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_primary_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::cancel_pending_session_inbox_item(
            &self.metadata.store_path,
            session_id,
            item_id,
            expected_version,
        )
    }

    pub fn direct_goal(&self) -> Result<Option<crate::store::SessionGoalRecord>> {
        self.require_direct_goal_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::load_session_goal(&self.metadata.store_path, session_id)
    }

    pub async fn create_direct_goal(
        &self,
        objective: &str,
        token_budget: Option<u64>,
    ) -> Result<crate::store::SessionGoalRecord> {
        self.require_direct_goal_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let _wake = self.inbox_wake.lock().await;
        // Freeze local run identity while capturing the lock-free GoalRuntime
        // usage snapshot and committing the goal. If no local run exists,
        // acquire the cross-process operation lease before creating an
        // unbound goal: a peer-owned run cannot otherwise supply the exact
        // mid-run token baseline and must fail closed instead of silently
        // excluding that run from goal accounting.
        let (goal, idle_lease) = {
            let active = self.lock_active_operation();
            let active_run_id = match active.as_ref() {
                Some(ActiveSessionOperation::Run(run)) if !run.finishing => {
                    Some(run.snapshot.run_id.clone())
                }
                _ => None,
            };
            let baseline = active_run_id.as_ref().map(|run_id| {
                self.goal_runtime
                    .as_ref()
                    .and_then(|runtime| runtime.current_baseline())
                    .filter(|baseline| baseline.run_id == run_id.as_str())
                    .unwrap_or_else(|| crate::store::GoalRunBaseline {
                        run_id: run_id.to_string(),
                        billable_tokens: 0,
                        started_at_epoch_ms: now_epoch_ms(),
                        continuation: false,
                    })
            });
            let idle_lease = if active_run_id.is_none() {
                Some(
                    sessions::SessionOperationLease::try_acquire(
                        &self.metadata.store_path,
                        session_id,
                    )
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseError::Busy(_) => anyhow::anyhow!(
                            "cannot create a goal while session '{session_id}' is running in another process"
                        ),
                        sessions::SessionOperationLeaseError::Store(error) => error,
                    })?,
                )
            } else {
                None
            };
            let goal = crate::store::create_session_goal(
                &self.metadata.store_path,
                session_id,
                objective,
                token_budget,
                baseline.as_ref(),
            )?;
            (goal, idle_lease)
        };
        if let Some(lease) = idle_lease {
            self.start_next_direct_inbox_item_with_lease(lease)?;
        }
        Ok(goal)
    }

    pub async fn update_direct_goal(
        &self,
        goal_id: &str,
        expected_version: i64,
        update: crate::store::UserGoalUpdate,
    ) -> Result<crate::store::SessionGoalRecord> {
        self.require_direct_goal_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let goal = crate::store::update_session_goal_by_user(
            &self.metadata.store_path,
            session_id,
            goal_id,
            expected_version,
            update,
        )?;
        if goal.status == crate::store::GoalStatus::Active {
            self.start_next_direct_inbox_item().await?;
        }
        Ok(goal)
    }

    pub fn clear_direct_goal(&self, goal_id: &str, expected_version: i64) -> Result<()> {
        self.require_direct_goal_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::clear_session_goal(
            &self.metadata.store_path,
            session_id,
            goal_id,
            expected_version,
        )
    }

    /// Idempotently promote the oldest pending item when this direct session
    /// is idle. The operation lease is acquired before selection, preventing
    /// two server processes from promoting the same durable item.
    pub async fn start_next_direct_inbox_item(&self) -> Result<Option<SessionRunHandle>> {
        self.require_direct_behavior()?;
        let _wake = self.inbox_wake.lock().await;
        if self.has_active_operation() {
            return Ok(None);
        }
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let lease = match sessions::SessionOperationLease::try_acquire(
            &self.metadata.store_path,
            session_id,
        ) {
            Ok(lease) => lease,
            Err(sessions::SessionOperationLeaseError::Busy(_)) => return Ok(None),
            Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
        };
        self.start_next_direct_inbox_item_with_lease(lease)
    }

    fn start_next_direct_inbox_item_with_lease(
        &self,
        lease: sessions::SessionOperationLease,
    ) -> Result<Option<SessionRunHandle>> {
        if self.has_active_operation() {
            return Ok(None);
        }
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        crate::store::reconcile_session_goal_run(&self.metadata.store_path, session_id)?;
        if let Some(item) =
            crate::store::next_pending_session_inbox_item(&self.metadata.store_path, session_id)?
        {
            return self
                .try_submit_prompt_inner(
                    None,
                    item.content,
                    Some(lease),
                    RunAdmissionKind {
                        inbox_item_id: Some(item.id),
                        ..RunAdmissionKind::default()
                    },
                )
                .map(Some)
                .map_err(anyhow::Error::new);
        }
        let Some(goal) = crate::store::load_session_goal(&self.metadata.store_path, session_id)?
            .filter(|goal| goal.status == crate::store::GoalStatus::Active)
        else {
            return Ok(None);
        };
        self.try_submit_prompt_inner(
            None,
            goal_continuation_prompt(&goal),
            Some(lease),
            RunAdmissionKind {
                goal_continuation: true,
                ..RunAdmissionKind::default()
            },
        )
        .map(Some)
        .map_err(anyhow::Error::new)
    }
}
