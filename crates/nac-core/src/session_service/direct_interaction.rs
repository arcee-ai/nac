use super::*;

/// Shared into the durable caller so dropping the request future cannot
/// release deletion fences while its queued write is still in flight.
struct ChildRetryScope {
    parent_session_id: String,
    _parent_lease: sessions::SessionRelationshipLease,
    _child_lease: sessions::SessionRelationshipLease,
}

impl SessionService {
    /// Stop this serving lifetime's run admission before persistence drains.
    /// The operation lock linearizes with admissions already establishing
    /// durable preconditions; queued inbox items and goals remain restartable.
    pub async fn stop_run_admission(&self) -> Result<()> {
        // Raise the fail-closed gate before waiting for bounded caller
        // capacity. An admission already holding the operation lock may
        // finish; every later admission observes this flag under that lock.
        self.stopping_admission
            .store(true, std::sync::atomic::Ordering::Release);
        if let Some(context) = &self.user_terminal_context {
            context.stop_admission().await;
        }
        self.cancel_goal_retry_wake();
        self.coordinate_local(|service| {
            let operation = service.lock_active_operation();
            if let Some(ActiveSessionOperation::Run(run)) = operation.as_ref() {
                // Wake finishing-input observers so they revalidate the closed
                // admission gate even when cleanup cannot finish during shutdown.
                run.settlement.send_replace(false);
            }
            if let Some(ActiveSessionOperation::HumanShell(command)) = operation.as_ref() {
                command.cancel_for_shutdown();
            }
        })
        .await
    }

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

    pub(super) async fn require_direct_primary_behavior_async(&self) -> Result<()> {
        let service = self.clone();
        crate::store::call_legacy_store(&self.metadata.store_path, move || {
            service.require_direct_primary_behavior()
        })
        .await?
    }

    async fn require_direct_goal_behavior_async(&self) -> Result<()> {
        let service = self.clone();
        crate::store::call_legacy_store(&self.metadata.store_path, move || {
            service.require_direct_goal_behavior()
        })
        .await?
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

    pub async fn permission_approval_mode(
        &self,
    ) -> Result<crate::permissions::PermissionApprovalMode> {
        self.direct_permission_broker()?.approval_mode().await
    }

    pub async fn set_permission_approval_mode(
        &self,
        mode: crate::permissions::PermissionApprovalMode,
    ) -> Result<()> {
        self.require_direct_primary_behavior_async().await?;
        self.direct_permission_broker()?
            .set_approval_mode(mode)
            .await
    }

    /// Recent automatic reviews in every state, newest first.
    pub fn list_permission_reviews(&self) -> Result<Vec<crate::permissions::PermissionReview>> {
        Ok(self.direct_permission_broker()?.recent_reviews())
    }

    /// Blocked reviews the user may still authorize for one retry.
    pub fn list_blocked_permission_reviews(
        &self,
    ) -> Result<Vec<crate::permissions::PermissionReview>> {
        Ok(self.direct_permission_broker()?.blocked_reviews())
    }

    /// Makes the next retry authorization fail to record its request.
    #[cfg(feature = "test-support")]
    pub fn fail_next_retry_enqueue_for_test() {
        FAIL_NEXT_RETRY_ENQUEUE.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Makes the next retry authorization fail to start a run after its
    /// request was recorded.
    #[cfg(feature = "test-support")]
    pub fn fail_next_retry_wake_for_test() {
        FAIL_NEXT_RETRY_WAKE.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    #[cfg(feature = "test-support")]
    pub fn permission_broker_for_test(&self) -> Result<Arc<crate::permissions::PermissionBroker>> {
        self.direct_permission_broker().map(Arc::clone)
    }

    /// Records the user's explicit authorization to retry one blocked action
    /// and asks the model, through the steering inbox, to retry it. The retry
    /// is a new invocation: policy runs again and it is reviewed afresh.
    pub async fn authorize_permission_review_retry(
        &self,
        review_id: &str,
    ) -> Result<crate::permissions::PermissionReview> {
        self.require_direct_primary_behavior_async().await?;
        self.authorize_permission_review_retry_unchecked(review_id, None)
            .await
    }

    /// Parent-mediated recourse for one traditional child's blocked action.
    /// The primary entry point stays primary-only; callers must name the
    /// child's actual parent and the child's own broker supplies authority.
    pub async fn authorize_child_permission_review_retry(
        &self,
        parent_session_id: &str,
        review_id: &str,
    ) -> Result<crate::permissions::PermissionReview> {
        self.require_direct_behavior()?;
        let service = self.clone();
        let parent = parent_session_id.to_owned();
        // Deletion takes these same leases, parent first. Keep them through
        // enqueue and wake so neither a local nor peer deletion can orphan
        // a successfully authorized retry.
        let relationships =
            crate::store::call_legacy_store(&self.metadata.store_path, move || -> Result<_> {
                let child = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
                let parent_lease = sessions::SessionRelationshipLease::try_acquire(
                    &service.metadata.store_path,
                    &parent,
                )?;
                let child_lease = sessions::SessionRelationshipLease::try_acquire(
                    &service.metadata.store_path,
                    child,
                )?;
                let parent_snapshot =
                    sessions::load_session(&service.metadata.store_path, &parent)?;
                if parent_snapshot.behavior == sessions::SessionBehavior::Orchestrator
                    || crate::store::load_traditional_child(&service.metadata.store_path, &parent)?
                        .is_some()
                    || crate::store::load_managed_orchestrator(
                        &service.metadata.store_path,
                        &parent,
                    )?
                    .is_some()
                {
                    return Err(anyhow::anyhow!("retry requires a primary direct parent"));
                }
                service.require_retry_child(&parent)?;
                Ok(Arc::new(ChildRetryScope {
                    parent_session_id: parent,
                    _parent_lease: parent_lease,
                    _child_lease: child_lease,
                }))
            })
            .await??;
        self.authorize_permission_review_retry_unchecked(review_id, Some(relationships))
            .await
    }

    fn require_retry_child(&self, parent: &str) -> Result<crate::store::TraditionalChildRecord> {
        let child = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let record = crate::store::load_traditional_child_for_parent(
            &self.metadata.store_path,
            parent,
            child,
        )?
        .ok_or_else(|| anyhow::anyhow!("traditional child was not found"))?;
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
            || crate::store::list_suppressed_traditional_child_generations(
                &self.metadata.store_path,
                parent,
            )?
            .iter()
            .any(|(id, _)| id == child)
        {
            return Err(anyhow::anyhow!(
                "traditional child is stopping or completion delivery is suppressed"
            ));
        }
        Ok(record)
    }

    async fn authorize_permission_review_retry_unchecked(
        &self,
        review_id: &str,
        retry_child: Option<Arc<ChildRetryScope>>,
    ) -> Result<crate::permissions::PermissionReview> {
        let broker = std::sync::Arc::clone(self.direct_permission_broker()?);
        let review = broker.authorize_review_retry(review_id)?;
        #[cfg(feature = "test-support")]
        let injected = FAIL_NEXT_RETRY_ENQUEUE.swap(false, std::sync::atomic::Ordering::SeqCst);
        #[cfg(not(feature = "test-support"))]
        let injected = false;
        let inserted = if injected {
            Err(anyhow::anyhow!("injected retry enqueue failure"))
        } else {
            self.insert_direct_input_unchecked(
                crate::store::InboxDelivery::Steer,
                &crate::permissions::retry_authorization_message(&review),
                None,
                None,
                retry_child.clone(),
            )
            .await
        };
        let target_run_id = match inserted {
            Ok((_, target_run_id)) => target_run_id,
            Err(error) => {
                // The retry request was not recorded, so the authorization
                // must not linger and the blocked action stays authorizable.
                broker.revoke_review_retry(review_id);
                return Err(error);
            }
        };
        // From here the request is durable and the authorization stays with
        // it. A failed wake leaves the item pending for normal inbox
        // admission; it is not rolled back or duplicated.
        if target_run_id.is_none() {
            #[cfg(feature = "test-support")]
            let wake = if FAIL_NEXT_RETRY_WAKE.swap(false, std::sync::atomic::Ordering::SeqCst) {
                Err(anyhow::anyhow!("injected retry wake failure"))
            } else {
                self.start_next_direct_inbox_item().await.map(|_| ())
            };
            #[cfg(not(feature = "test-support"))]
            let wake = self.start_next_direct_inbox_item().await.map(|_| ());
            if let Err(error) = wake {
                eprintln!(
                    "nac: authorized retry for review {review_id} is queued but could not start a run yet: {error:#}"
                );
            }
        }
        Ok(review)
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

    /// Queues direct input. `review_intent` is set only for input a person
    /// typed on a human-facing route: their text as typed, before
    /// expansion, which becomes review intent when the item reaches the
    /// model.
    pub async fn enqueue_direct_input(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        client_id: Option<&SessionClientId>,
        review_intent: Option<&str>,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_primary_behavior_async().await?;
        self.enqueue_direct_input_unchecked(delivery, content, client_id, review_intent)
            .await
    }

    /// Parent-owned child control path. Public direct-inbox APIs deliberately
    /// reject the same session; only the validated child controller calls this.
    pub async fn enqueue_traditional_child_input(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        origin: crate::store::InputOrigin,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_behavior()?;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let child = match crate::store::coordinator::owner_for(&self.metadata.store_path)? {
            Some(owner) => owner.load_traditional_child(session_id.to_owned()).await?,
            None => crate::store::load_traditional_child(&self.metadata.store_path, session_id)?,
        };
        if child.is_none() {
            return Err(anyhow::anyhow!("traditional child was not found"));
        }
        let review_intent = (origin == crate::store::InputOrigin::Person).then_some(content);
        self.enqueue_direct_input_unchecked(delivery, content, None, review_intent)
            .await
    }

    async fn enqueue_direct_input_unchecked(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        client_id: Option<&SessionClientId>,
        review_intent: Option<&str>,
    ) -> Result<crate::store::SessionInboxRecord> {
        let (record, target_run_id) = self
            .insert_direct_input_unchecked(delivery, content, client_id, review_intent, None)
            .await?;
        if target_run_id.is_none() {
            self.start_next_direct_inbox_item().await?;
        }
        Ok(record)
    }

    /// Durably records one inbox item without waking the session. Returns the
    /// run a steer was targeted at, if any; an untargeted item still needs
    /// [`Self::start_next_direct_inbox_item`].
    async fn insert_direct_input_unchecked(
        &self,
        delivery: crate::store::InboxDelivery,
        content: &str,
        client_id: Option<&SessionClientId>,
        review_intent: Option<&str>,
        retry_child: Option<Arc<ChildRetryScope>>,
    ) -> Result<(crate::store::SessionInboxRecord, Option<String>)> {
        let service = self.clone();
        let content = content.to_owned();
        let client_id = client_id.cloned();
        let review_intent = review_intent.map(str::to_owned);
        let (record, target_run_id) =
            crate::store::call_legacy_store(&self.metadata.store_path, move || -> Result<_> {
                let session_id = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;

                let child = retry_child
                    .as_ref()
                    .map(|scope| service.require_retry_child(&scope.parent_session_id))
                    .transpose()?;
                let active = service.lock_active_operation();
                let target_run_id = match (delivery, active.as_ref()) {
                    (
                        crate::store::InboxDelivery::Steer,
                        Some(ActiveSessionOperation::Run(run)),
                    ) if !run.finishing => Some(run.snapshot.run_id.to_string()),
                    // A peer may own the current child operation. Preserve
                    // its durable run binding rather than wake a successor.
                    _ => child
                        .filter(|child| {
                            child.status == crate::store::TraditionalChildStatus::Running
                        })
                        .and_then(|child| child.run_id),
                };
                let record = match review_intent.as_deref() {
                    Some(review_intent) => crate::store::create_person_session_inbox_item(
                        &service.metadata.store_path,
                        session_id,
                        delivery,
                        &content,
                        target_run_id.as_deref(),
                        client_id.as_ref().map(SessionClientId::as_str),
                        review_intent,
                    )?,
                    None => crate::store::create_session_inbox_item(
                        &service.metadata.store_path,
                        session_id,
                        delivery,
                        &content,
                        target_run_id.as_deref(),
                        client_id.as_ref().map(SessionClientId::as_str),
                    )?,
                };
                Ok((record, target_run_id))
            })
            .await??;
        Ok((record, target_run_id))
    }

    pub async fn update_direct_inbox_item(
        &self,
        item_id: i64,
        expected_version: i64,
        delivery: crate::store::InboxDelivery,
    ) -> Result<crate::store::SessionInboxRecord> {
        self.require_direct_primary_behavior_async().await?;
        let service = self.clone();
        let (record, target_run_id) =
            crate::store::call_legacy_store(&self.metadata.store_path, move || -> Result<_> {
                let session_id = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;

                let active = service.lock_active_operation();
                let target_run_id = match (delivery, active.as_ref()) {
                    (
                        crate::store::InboxDelivery::Steer,
                        Some(ActiveSessionOperation::Run(run)),
                    ) if !run.finishing => Some(run.snapshot.run_id.to_string()),
                    _ => None,
                };
                let record = crate::store::update_pending_session_inbox_item(
                    &service.metadata.store_path,
                    session_id,
                    item_id,
                    expected_version,
                    delivery,
                    target_run_id.as_deref(),
                )?;
                Ok((record, target_run_id))
            })
            .await??;
        if target_run_id.is_none() {
            self.start_next_direct_inbox_item().await?;
        }
        Ok(record)
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
        self.require_direct_goal_behavior_async().await?;
        let _wake = self.inbox_wake.lock().await;
        // Freeze local run identity while capturing the lock-free GoalRuntime
        // usage snapshot and committing the goal. If no local run exists,
        // acquire the cross-process operation lease before creating an
        // unbound goal: a peer-owned run cannot otherwise supply the exact
        // mid-run token baseline and must fail closed instead of silently
        // excluding that run from goal accounting.
        let service = self.clone();
        let objective = objective.to_owned();
        let (goal, idle_lease) = crate::store::call_legacy_store(
            &self.metadata.store_path,
            move || -> Result<_> {
                let session_id = service
                    .metadata
                    .session_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;

                let active = service.lock_active_operation();
                let active_run_id = match active.as_ref() {
                    Some(ActiveSessionOperation::Run(run)) if !run.finishing => {
                        Some(run.snapshot.run_id.clone())
                    }
                    _ => None,
                };
                let baseline = active_run_id.as_ref().map(|run_id| {
                    service
                        .goal_runtime
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
                            &service.metadata.store_path,
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
                    &service.metadata.store_path,
                    session_id,
                    &objective,
                    token_budget,
                    baseline.as_ref(),
                )?;
                Ok((goal, idle_lease))
            },
        )
        .await??;
        if let Some(lease) = idle_lease {
            self.start_next_direct_inbox_item_with_lease_async(lease)
                .await?;
        }
        Ok(goal)
    }

    pub async fn update_direct_goal(
        &self,
        goal_id: &str,
        expected_version: i64,
        update: crate::store::UserGoalUpdate,
    ) -> Result<crate::store::SessionGoalRecord> {
        self.require_direct_goal_behavior_async().await?;
        let service = self.clone();
        let goal_id = goal_id.to_owned();
        let goal = crate::store::call_legacy_store(&self.metadata.store_path, move || {
            let session_id = service
                .metadata
                .session_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
            crate::store::update_session_goal_by_user(
                &service.metadata.store_path,
                session_id,
                &goal_id,
                expected_version,
                update,
            )
        })
        .await??;
        self.cancel_goal_retry_wake();
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
        )?;
        self.cancel_goal_retry_wake();
        Ok(())
    }

    /// Idempotently promote the oldest pending item when this direct session
    /// is idle. A read-only preflight avoids leasing an empty wake; selection
    /// still happens under the operation lease, preventing two server
    /// processes from promoting the same durable item.
    pub async fn start_next_direct_inbox_item(&self) -> Result<Option<SessionRunHandle>> {
        self.require_direct_behavior()?;
        let _wake = self.inbox_wake.lock().await;
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
            || self.has_active_operation()
        {
            return Ok(None);
        }
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let path = self.metadata.store_path.clone();
        let wake_session_id = session_id.to_owned();
        let has_durable_work = crate::store::spawn_blocking_store_caller(move || {
            Ok::<_, anyhow::Error>(
                crate::store::next_pending_session_inbox_item(&path, &wake_session_id)?.is_some()
                    || crate::store::load_session_goal(&path, &wake_session_id)?.is_some(),
            )
        })
        .await??;
        if !has_durable_work {
            self.cancel_goal_retry_wake();
            return Ok(None);
        }
        // This is only a hint: re-read and reconcile under the lease below.
        // Any goal, including a paused one, may retain stale run accounting.
        // Concurrent intent writers retain their own wake after committing.
        let lease = match sessions::SessionOperationLease::try_acquire(
            &self.metadata.store_path,
            session_id,
        ) {
            Ok(lease) => lease,
            Err(sessions::SessionOperationLeaseError::Busy(_)) => return Ok(None),
            Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
        };
        self.start_next_direct_inbox_item_with_lease_async(lease)
            .await
    }

    pub(super) async fn start_next_direct_inbox_item_with_lease_async(
        &self,
        lease: sessions::SessionOperationLease,
    ) -> Result<Option<SessionRunHandle>> {
        if self.has_active_operation() {
            return Ok(None);
        }
        let service = self.clone();
        let abandoned_child =
            crate::store::call_legacy_store(&self.metadata.store_path, move || {
                let Some(session_id) = service.metadata.session_id.as_deref() else {
                    return Ok::<_, anyhow::Error>(false);
                };
                Ok(
                    crate::store::load_traditional_child(&service.metadata.store_path, session_id)?
                        .is_some_and(|child| {
                            child.status == crate::store::TraditionalChildStatus::Running
                        }),
                )
            })
            .await??;
        if abandoned_child {
            // A peer can exit after attachment or input queueing. Keep this
            // lease through run/relationship recovery and successor admission;
            // the existing inbox item remains the sole delivery authority.
            self.recover_child_input_for_admission(&lease).await?;
        }
        let service = self.clone();
        crate::store::spawn_blocking_store_caller(move || {
            service.start_next_direct_inbox_item_with_lease(lease)
        })
        .await?
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
            // Select mode at the successor-admission boundary, under its
            // operation lease and without an intervening async yield. A lost
            // waiter leaves the same durable input eligible for background
            // delivery. Once admitted, the generation's mode is immutable.
            let child_execution_mode = match item.child_execution_mode {
                Some(crate::store::TraditionalChildExecutionMode::Foreground) => {
                    match item.child_wait_id.as_deref().map(|id| {
                        sessions::ChildInputWaitLease::try_acquire(&self.metadata.store_path, id)
                    }) {
                        Some(Err(sessions::SessionOperationLeaseError::Busy(_))) => {
                            item.child_execution_mode
                        }
                        Some(Err(error)) => return Err(error.into()),
                        Some(Ok(_)) | None => {
                            Some(crate::store::TraditionalChildExecutionMode::Background)
                        }
                    }
                }
                mode => mode,
            };
            return self
                .try_submit_prompt_inner(
                    None,
                    item.content,
                    Some(lease),
                    RunAdmissionKind {
                        inbox_item_id: Some(item.id),
                        child_execution_mode,
                        terminal_selection: item.terminal_selection,
                        ..RunAdmissionKind::default()
                    },
                )
                .map(Some)
                .map_err(anyhow::Error::new);
        }
        let Some(goal) = crate::store::load_session_goal(&self.metadata.store_path, session_id)?
            .filter(|goal| goal.status == crate::store::GoalStatus::Active)
        else {
            self.cancel_goal_retry_wake();
            return Ok(None);
        };
        if goal
            .next_attempt_at_epoch_ms
            .is_some_and(|deadline| deadline > now_epoch_ms())
        {
            drop(lease);
            self.schedule_goal_retry_wake(&goal);
            return Ok(None);
        }
        self.cancel_goal_retry_wake();
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

    fn cancel_goal_retry_wake(&self) {
        let wake = self
            .goal_retry_wake
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(wake) = wake {
            wake.task.abort();
        }
    }

    fn disarm_goal_retry_wake(&self, goal_id: &str, goal_version: i64) {
        let mut guard = self
            .goal_retry_wake
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard
            .as_ref()
            .is_some_and(|wake| wake.goal_id == goal_id && wake.goal_version == goal_version)
        {
            guard.take();
        }
    }

    fn schedule_goal_retry_wake(&self, goal: &crate::store::SessionGoalRecord) {
        let Some(deadline) = goal.next_attempt_at_epoch_ms else {
            return;
        };
        let mut guard = self
            .goal_retry_wake
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.as_ref().is_some_and(|wake| {
            wake.goal_id == goal.goal_id
                && wake.goal_version == goal.version
                && !wake.task.is_finished()
        }) {
            return;
        }
        if let Some(previous) = guard.take() {
            previous.task.abort();
        }
        let service = self.clone();
        let goal_id = goal.goal_id.clone();
        let goal_version = goal.version;
        let task = tokio::spawn(async move {
            loop {
                let remaining = deadline.saturating_sub(now_epoch_ms());
                if remaining == 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(remaining)).await;
            }
            let Some(session_id) = service.metadata.session_id.as_deref() else {
                return;
            };
            let goal = match crate::store::coordinator::owner_for(&service.metadata.store_path) {
                Ok(Some(owner)) => owner.load_session_goal(session_id.to_owned()).await,
                Ok(None) => {
                    crate::store::load_session_goal(&service.metadata.store_path, session_id)
                }
                Err(error) => Err(error),
            };
            let current = match goal {
                Ok(Some(goal)) => goal,
                Ok(None) => return,
                Err(error) => {
                    eprintln!("nac: failed to load goal at retry deadline: {error:#}");
                    return;
                }
            };
            if current.goal_id != goal_id
                || current.version != goal_version
                || current.status != crate::store::GoalStatus::Active
                || current.next_attempt_at_epoch_ms != Some(deadline)
            {
                return;
            }
            service.disarm_goal_retry_wake(&goal_id, goal_version);
            if let Err(error) = service.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to resume goal at retry deadline: {error:#}");
            }
        });
        *guard = Some(GoalRetryWake {
            goal_id: goal.goal_id.clone(),
            goal_version,
            task,
        });
    }
}

#[cfg(test)]
mod owned_lifecycle_tests;

#[cfg(feature = "test-support")]
static FAIL_NEXT_RETRY_ENQUEUE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(feature = "test-support")]
static FAIL_NEXT_RETRY_WAKE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
