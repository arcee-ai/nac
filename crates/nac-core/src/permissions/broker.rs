use super::*;

impl PermissionBroker {
    /// Automatic admission is not an interactive approver. Ask/Deny retain a
    /// schedule-specific attention reason; executing tools still use their
    /// ordinary prepared authorization on the selected backend.
    pub(crate) fn heartbeat_admission_allowed(&self) -> bool {
        self.policy
            .evaluate(
                &[
                    PermissionResource::new(
                        "heartbeat_manage",
                        format!("session:{}", self.session_id),
                    ),
                    PermissionResource::new(
                        "heartbeat_run",
                        format!("session:{}", self.session_id),
                    ),
                ],
                &[],
            )
            .effect
            == PermissionEffect::Allow
    }
    /// Read-only fencing for the additive execution observation capability.
    /// This neither authorizes an operation nor changes ordinary broker policy.
    pub(crate) async fn validate_execution_observation_binding(
        self: &Arc<Self>,
        store_path: &std::path::Path,
        session_id: Option<&str>,
        backend: &ExecutionBackend,
    ) -> anyhow::Result<()> {
        let backend = match PermissionBackend::from_execution_backend(backend) {
            PermissionBackend::Local => "local",
            PermissionBackend::Podman => "podman",
            PermissionBackend::Ssh => "ssh",
        };
        anyhow::ensure!(
            store_path == self.store_path
                && session_id == Some(self.session_id.as_str())
                && backend == self.backend,
            "execution unavailable"
        );
        let broker = Arc::clone(self);
        crate::store::call_legacy_store(store_path, move || {
            anyhow::ensure!(
                crate::store::observe_probe_migration_status(&broker.store_path).state
                    == crate::store::StoreMigrationState::Current,
                "execution unavailable"
            );
            let config =
                crate::sessions::load_session_config(&broker.store_path, &broker.session_id)?;
            anyhow::ensure!(
                config.config_version == broker.session_config_version
                    && config.diagnostics.is_empty(),
                "execution unavailable"
            );
            anyhow::ensure!(
                crate::sessions::load_session_behavior(&broker.store_path, &broker.session_id)?
                    != crate::sessions::SessionBehavior::Orchestrator
                    && crate::store::load_traditional_child(
                        &broker.store_path,
                        &broker.session_id
                    )?
                    .is_none(),
                "execution unavailable"
            );
            Ok(())
        })
        .await?
    }

    /// Metadata handoff grants no model authorization. A new human input
    /// capability must still honor deterministic target Deny; Ask is skipped
    /// only for this private service-issued, invocation-only capability.
    pub(crate) fn authorize_submitted_terminal_control(
        &self,
        submission: &crate::session_service::SubmittedTerminalControl,
    ) -> anyhow::Result<()> {
        let decision = self
            .policy
            .evaluate(&submission.permission_resources(), &[]);
        if decision.effect == PermissionEffect::Deny {
            return Err(anyhow::anyhow!(decision.hard_denial.unwrap_or_else(|| {
                "configured permission rules deny human terminal input control".into()
            })));
        }
        Ok(())
    }

    pub(crate) fn session_config_version(&self) -> i64 {
        self.session_config_version
    }

    pub(crate) fn new(
        store_path: PathBuf,
        session_id: String,
        backend: PermissionBackend,
        session_config_version: i64,
        configured_rules: impl IntoIterator<Item = PermissionRule>,
    ) -> Self {
        Self {
            policy: PermissionPolicy::for_backend(backend, configured_rules),
            store_path,
            session_id,
            backend: match backend {
                PermissionBackend::Local => "local",
                PermissionBackend::Podman => "podman",
                PermissionBackend::Ssh => "ssh",
            },
            session_config_version,
            event_bus: StdMutex::new(None),
            state: StdMutex::new(PermissionBrokerState::default()),
            approval_observer: tokio::sync::Mutex::new(PermissionApprovalObserver::default()),
            reviewer: StdMutex::new(None),
            review: StdMutex::new(ReviewMemory::default()),
            review_deadline: StdMutex::new(REVIEW_DEADLINE),
            command_environment: StdMutex::new(None),
            review_backend: StdMutex::new(review::ReviewBackendSource::Fixed(backend.into())),
            caller_project: std::sync::OnceLock::new(),
        }
    }

    pub(crate) fn remember_caller_project(&self, project_id: &str) {
        let _ = self.caller_project.set(project_id.to_owned());
    }

    pub(crate) fn caller_project(&self) -> Option<&str> {
        self.caller_project.get().map(String::as_str)
    }

    pub(crate) fn attach_event_bus(&self, bus: crate::events::SessionEventBus) {
        *self
            .event_bus
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(bus);
    }

    pub fn pending(&self) -> Vec<PermissionRequest> {
        let mut requests = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .values()
            .map(|pending| pending.request.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| {
            left.created_at_epoch_ms
                .cmp(&right.created_at_epoch_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        requests
    }

    pub async fn approval_mode(&self) -> anyhow::Result<PermissionApprovalMode> {
        self.load_approval_state()
            .await
            .map(|(mode, _, _)| mode)
            .map_err(anyhow::Error::msg)
    }

    /// Durably changes this session's answer policy. Enabling auto-approval
    /// claims the process-local waiters that existed when the transition
    /// started. The durable generation lets later or independently attached
    /// waiters observe the transition without a stale enable claiming work
    /// admitted after a completed disable.
    pub async fn set_approval_mode(&self, mode: PermissionApprovalMode) -> anyhow::Result<()> {
        self.set_approval_mode_with_hooks(mode, || async {}, || async {})
            .await
    }

    pub(super) async fn set_approval_mode_with_hooks<
        BeforeUpdate,
        BeforeUpdateFuture,
        AfterCommit,
        AfterCommitFuture,
    >(
        &self,
        mode: PermissionApprovalMode,
        before_update: BeforeUpdate,
        after_commit: AfterCommit,
    ) -> anyhow::Result<()>
    where
        BeforeUpdate: FnOnce() -> BeforeUpdateFuture,
        BeforeUpdateFuture: std::future::Future<Output = ()>,
        AfterCommit: FnOnce() -> AfterCommitFuture,
        AfterCommitFuture: std::future::Future<Output = ()>,
    {
        if mode == PermissionApprovalMode::Review {
            let available = match self.reviewer() {
                Some(reviewer) => tokio::task::spawn_blocking(move || reviewer.check_available())
                    .await
                    .unwrap_or_else(|error| {
                        Err(format!(
                            "automatic permission review could not be checked: {error}"
                        ))
                    }),
                None => {
                    Err("automatic permission review is not available in this session".to_string())
                }
            };
            if let Err(message) = available {
                return Err(PermissionApprovalModeUpdateError::ReviewerUnavailable(message).into());
            }
            // Selecting Approve for me again changes nothing. Reserving a
            // transition would move the revision and discard reviews in
            // flight, so it is a no-op.
            if matches!(
                self.load_approval_state().await,
                Ok((PermissionApprovalMode::Review, _, _))
            ) {
                return Ok(());
            }
        }
        let store_path = self.store_path.clone();
        let session_id = self.session_id.clone();
        let revision = crate::store::spawn_blocking_store_caller(move || {
            crate::sessions::reserve_permission_approval_transition(&store_path, &session_id)
        })
        .await
        .map_err(|error| {
            anyhow::anyhow!("permission approval mode reservation task failed: {error}")
        })??;
        let auto_approval_candidates = if mode == PermissionApprovalMode::AutoApprove {
            self.state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .pending
                .keys()
                .cloned()
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        before_update().await;
        let store_path = self.store_path.clone();
        let session_id = self.session_id.clone();
        let updated = crate::store::spawn_blocking_store_caller(move || {
            crate::sessions::compare_and_update_permission_approval_state(
                &store_path,
                &session_id,
                revision,
                mode,
            )
        })
        .await
        .map_err(|error| {
            anyhow::anyhow!("permission approval mode update task failed: {error}")
        })??;
        if !updated {
            return Err(PermissionApprovalModeUpdateError::ConcurrentChange.into());
        }

        // Publish immediately after the durable transition. Test hooks and
        // process-local waiter delivery must not let an older mode event trail
        // a later completed transition.
        self.emit_async(crate::events::SessionEvent::PermissionApprovalModeChanged { mode })
            .await;
        after_commit().await;
        let replies = if mode == PermissionApprovalMode::AutoApprove {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            auto_approval_candidates
                .into_iter()
                .filter_map(|request_id| {
                    state
                        .pending
                        .remove(&request_id)
                        .map(|pending| (request_id, pending))
                })
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        for (request_id, pending) in replies {
            if pending.reply.send(PermissionReply::Once).is_ok() {
                self.emit_async(crate::events::SessionEvent::PermissionReplied {
                    request_id,
                    reply: PermissionReply::Once,
                })
                .await;
            } else {
                self.emit_async(crate::events::SessionEvent::PermissionDismissed {
                    request_id,
                    reason:
                        "the operation awaiting automatic approval ended before the mode changed"
                            .to_string(),
                })
                .await;
            }
        }
        Ok(())
    }

    pub fn grants(&self) -> anyhow::Result<Vec<crate::store::PermissionGrantRecord>> {
        crate::store::list_permission_grants(&self.store_path, &self.session_id)
    }

    pub fn delete_grant(&self, grant_id: &str) -> anyhow::Result<()> {
        crate::store::delete_permission_grant(&self.store_path, &self.session_id, grant_id)
    }

    fn deliver_reply(&self, request_id: &str, reply: PermissionReply) -> anyhow::Result<()> {
        let pending = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .remove(request_id)
            .ok_or_else(|| anyhow::anyhow!("permission request '{request_id}' was not found"))?;
        pending.reply.send(reply).map_err(|_| {
            anyhow::anyhow!("permission request '{request_id}' is no longer active")
        })?;
        Ok(())
    }

    pub fn reply(&self, request_id: &str, reply: PermissionReply) -> anyhow::Result<()> {
        self.deliver_reply(request_id, reply)?;
        self.emit(crate::events::SessionEvent::PermissionReplied {
            request_id: request_id.to_owned(),
            reply,
        });
        Ok(())
    }

    async fn reply_async(&self, request_id: &str, reply: PermissionReply) -> anyhow::Result<()> {
        self.deliver_reply(request_id, reply)?;
        self.emit_async(crate::events::SessionEvent::PermissionReplied {
            request_id: request_id.to_owned(),
            reply,
        })
        .await;
        Ok(())
    }

    pub(crate) async fn authorize(
        self: &Arc<Self>,
        tool: &str,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
    ) -> AuthorizationOutcome {
        self.authorize_invocation(tool, resources, context, cancellation, false)
            .await
    }

    pub(crate) async fn authorize_submitted_shell(
        self: &Arc<Self>,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
        _submission: &crate::session_service::SubmittedShell,
    ) -> AuthorizationOutcome {
        self.authorize_invocation("exec_command", resources, context, cancellation, true)
            .await
    }

    pub(crate) async fn authorize_submitted_user_terminal(
        self: &Arc<Self>,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
        _submission: &crate::session_service::SubmittedUserTerminal,
    ) -> AuthorizationOutcome {
        self.authorize_invocation(
            crate::tools::user_terminal::OPEN_USER_TERMINAL,
            resources,
            context,
            cancellation,
            true,
        )
        .await
    }

    pub(crate) async fn authorize_submitted_heartbeat(
        self: &Arc<Self>,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
        _submission: &crate::session_service::SubmittedHeartbeat,
    ) -> AuthorizationOutcome {
        self.authorize_invocation(
            crate::tools::heartbeat::CONTROL_HEARTBEAT,
            resources,
            context,
            cancellation,
            true,
        )
        .await
    }

    async fn remembered_allows(
        &self,
        owner: Option<&Arc<crate::store::StoreCoordinator>>,
    ) -> anyhow::Result<Vec<PermissionRule>> {
        let grants = match owner {
            Some(owner) => {
                owner
                    .list_effective_permission_grants(
                        self.session_id.clone(),
                        self.backend.to_owned(),
                        self.session_config_version,
                    )
                    .await
            }
            None => crate::store::list_effective_permission_grants(
                &self.store_path,
                &self.session_id,
                self.backend,
                self.session_config_version,
            ),
        }?;
        Ok(grants
            .into_iter()
            .map(|grant| PermissionRule::new(grant.action, grant.resource, PermissionEffect::Allow))
            .collect())
    }

    /// Non-prompting policy snapshot for passive reads; `None` when grants are unreadable.
    pub(crate) async fn passive_read_filter(&self) -> Option<PassiveReadFilter> {
        let owner = crate::store::coordinator::owner_for(&self.store_path).ok()?;
        let remembered = self.remembered_allows(owner.as_ref()).await.ok()?;
        let auto_approve = matches!(
            self.load_approval_state().await,
            Ok((PermissionApprovalMode::AutoApprove, _, _))
        );
        Some(PassiveReadFilter {
            policy: self.policy.clone(),
            remembered,
            auto_approve,
        })
    }

    async fn authorize_invocation(
        self: &Arc<Self>,
        tool: &str,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
        human_submitted: bool,
    ) -> AuthorizationOutcome {
        let review_stop = self.review_run_stop();
        #[cfg(test)]
        pause_grant_read_for_test(&self.store_path).await;
        if resources.is_empty() {
            return AuthorizationOutcome::Denied(format!(
                "tool '{tool}' did not declare canonical permission resources"
            ));
        }
        let owner = match crate::store::coordinator::owner_for(&self.store_path) {
            Ok(owner) => owner,
            Err(error) => {
                return AuthorizationOutcome::Denied(format!(
                    "permission grants could not be read: {error}"
                ))
            }
        };
        let remembered = match self.remembered_allows(owner.as_ref()).await {
            Ok(remembered) => remembered,
            Err(error) => {
                return AuthorizationOutcome::Denied(format!(
                    "permission grants could not be read: {error}"
                ))
            }
        };
        let decision = self.policy.evaluate(resources, &remembered);
        match decision.effect {
            PermissionEffect::Allow => {
                return if cancellation.is_cancelled() {
                    AuthorizationOutcome::Denied(
                        "run was cancelled before authorization completed".to_string(),
                    )
                } else {
                    AuthorizationOutcome::Allowed
                };
            }
            PermissionEffect::Deny => {
                return AuthorizationOutcome::Denied(
                    decision
                        .hard_denial
                        .unwrap_or_else(|| format!("configured permission rules deny {tool}")),
                );
            }
            PermissionEffect::Ask => {}
        }

        if cancellation.is_cancelled() {
            return AuthorizationOutcome::Denied("run was cancelled before approval".to_string());
        }

        // Service-issued human intent supplies invocation-only authority after policy.
        // This path neither reads approval mode nor creates a remembered grant.
        if human_submitted {
            return AuthorizationOutcome::Allowed;
        }

        if review_stop.is_closed() {
            return Self::review_stopped_outcome(&review_stop).await;
        }
        let allowed = || async {
            if review_stop.is_closed() {
                Self::review_stopped_outcome(&review_stop).await
            } else {
                AuthorizationOutcome::Allowed
            }
        };

        // The durable mode is consulted only after ordered configured and hard
        // policy has produced Ask. It is never cached: independent managers and
        // processes may attach the same durable session.
        let (_, initial_auto_generation, _) = match self.load_approval_state().await {
            Ok((PermissionApprovalMode::AutoApprove, _, _)) => {
                return allowed().await;
            }
            Ok((PermissionApprovalMode::Review, generation, revision)) => {
                // Ineligible requests fall through to the manual path below,
                // which still fails closed without an interactive client.
                if let Some(outcome) = self
                    .review(
                        tool,
                        resources,
                        context,
                        cancellation,
                        &review_stop,
                        revision,
                    )
                    .await
                {
                    return outcome;
                }
                (PermissionApprovalMode::Review, generation, revision)
            }
            Ok(state) => state,
            Err(reason) => return AuthorizationOutcome::Denied(reason),
        };
        let interactive = self
            .event_bus
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
        let child = match &owner {
            Some(owner) => owner.load_traditional_child(self.session_id.clone()).await,
            None => crate::store::load_traditional_child(&self.store_path, &self.session_id),
        };
        let delegated_child = match child {
            Ok(child) => child.is_some(),
            Err(error) => {
                return AuthorizationOutcome::Denied(format!(
                    "delegated ownership could not be checked before approval: {error}"
                ));
            }
        };
        let request = PermissionRequest {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            call_id: context.call_id.clone(),
            tool: tool.to_string(),
            resources: resources
                .iter()
                .map(|resource| PermissionRequestResource {
                    action: resource.action.clone(),
                    resource: resource.resource.clone(),
                    display: resource.display.clone(),
                    save_resource: resource.save_resource.clone(),
                })
                .collect(),
            created_at_epoch_ms: epoch_millis_now(),
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let approval_generation = match self.load_approval_state().await {
            Ok((PermissionApprovalMode::AutoApprove, _, _)) => {
                return allowed().await;
            }
            Ok((
                PermissionApprovalMode::Manual | PermissionApprovalMode::Review,
                generation,
                _,
            )) if generation > initial_auto_generation => {
                // Auto-approve was enabled and then disabled while this Ask
                // was already resolving broker ownership. The enable still
                // owns this invocation even though it never became pending.
                return allowed().await;
            }
            Ok((
                PermissionApprovalMode::Manual | PermissionApprovalMode::Review,
                generation,
                _,
            )) => generation,
            Err(reason) => return AuthorizationOutcome::Denied(reason),
        };
        let admitted = {
            let _review = self
                .review
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if review_stop.is_closed() {
                None
            } else {
                Some((|| {
                    let mut state = self
                        .state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if !interactive && !delegated_child {
                        return Err(
                    "approval is required, but no interactive session client is connected; the operation was not executed"
                        .to_string(),
                );
                    }
                    state.pending.insert(
                        request.id.clone(),
                        PendingPermission {
                            request: request.clone(),
                            reply: sender,
                        },
                    );
                    Ok(())
                })())
            }
        };
        match admitted {
            None => return Self::review_stopped_outcome(&review_stop).await,
            Some(Err(reason)) => return AuthorizationOutcome::Denied(reason),
            Some(Ok(())) => {}
        }
        let _pending_guard = PendingPermissionGuard {
            broker: Arc::downgrade(self),
            request_id: request.id.clone(),
        };
        let waiter_live = Arc::new(crate::store::PermissionGrantWaiter::default());
        let _waiter_liveness = PermissionWaiterLiveness {
            live: Arc::clone(&waiter_live),
        };
        self.emit_async(crate::events::SessionEvent::PermissionAsked {
            request: request.clone(),
        })
        .await;

        tokio::pin!(receiver);
        let result = tokio::select! {
            biased;
            () = review_stop.cancelled() => {
                let outcome = Self::review_stopped_outcome(&review_stop).await;
                let _ = self.dismiss_pending_async(
                    &request.id,
                    blocked_message(PermissionReviewCode::ReviewStopped, None),
                ).await;
                outcome
            },
            reply = &mut receiver => self.reply_outcome(reply, &request, &waiter_live, &review_stop).await,
            () = cancellation.cancelled() => {
                let reason = "run was cancelled while awaiting approval".to_string();
                if self.dismiss_pending_async(&request.id, reason.clone()).await {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live, &review_stop).await
                }
            },
            () = self.auto_approval_after(approval_generation) => {
                // A local manual reply or cancellation may have claimed the
                // request after the durable generation was read. Whichever
                // removes it first owns the sole reply.
                let _ = self.reply_async(&request.id, PermissionReply::Once).await;
                self.reply_outcome(receiver.await, &request, &waiter_live, &review_stop).await
            },
            reason = self.interactive_subscriber_unavailable(interactive) => {
                if self.dismiss_pending_async(&request.id, reason.clone()).await {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live, &review_stop).await
                }
            },
            () = tokio::time::sleep(APPROVAL_TIMEOUT) => {
                let reason = "permission request timed out without a reply".to_string();
                if self.dismiss_pending_async(&request.id, reason.clone()).await {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live, &review_stop).await
                }
            },
        };
        // A reply owns the request by removing it and successfully delivering
        // to this exact waiter. Grants are written only after receipt. At the
        // final commit boundary, waiter abort and human-grant admission race
        // once; an abort cannot authorize a writer that has not yet won.
        if review_stop.is_closed() {
            Self::review_stopped_outcome(&review_stop).await
        } else {
            result
        }
    }

    async fn reply_outcome(
        &self,
        reply: Result<PermissionReply, tokio::sync::oneshot::error::RecvError>,
        request: &PermissionRequest,
        waiter_live: &Arc<crate::store::PermissionGrantWaiter>,
        review_stop: &super::review::ReviewRunPermit,
    ) -> AuthorizationOutcome {
        if review_stop.is_closed() {
            return Self::review_stopped_outcome(review_stop).await;
        }
        match reply {
            Ok(PermissionReply::Once) => AuthorizationOutcome::Allowed,
            Ok(PermissionReply::Always) => {
                let grants = request
                    .resources
                    .iter()
                    .filter_map(|resource| {
                        resource
                            .save_resource
                            .as_ref()
                            .map(|save| (resource.action.clone(), save.clone()))
                    })
                    .collect::<Vec<_>>();
                if grants.is_empty() {
                    AuthorizationOutcome::Allowed
                } else {
                    let store_path = self.store_path.clone();
                    let session_id = self.session_id.clone();
                    let backend = self.backend;
                    let session_config_version = self.session_config_version;
                    let waiter_live = Arc::clone(waiter_live);
                    let run_fence = review_stop.grant_fence();
                    let save = crate::store::spawn_blocking_store_caller(move || {
                        crate::store::insert_permission_grant_set_if_waiter_live(
                            &store_path,
                            &session_id,
                            &grants,
                            backend,
                            session_config_version,
                            &waiter_live,
                            &run_fence,
                        )
                    });
                    // Closure fences the store transaction itself. Drain any
                    // already-admitted commit before reporting a terminal stop.
                    let saved = tokio::select! {
                        biased;
                        () = review_stop.cancelled() => {
                            return Self::review_stopped_outcome(review_stop).await;
                        },
                        saved = save => saved,
                    };
                    match saved {
                        Ok(Ok(Some(_))) => AuthorizationOutcome::Allowed,
                        Ok(Ok(None)) => AuthorizationOutcome::Denied(
                            "the permission waiter ended before the approved grant could be saved; the operation was not executed"
                                .to_string(),
                        ),
                        Ok(Err(error)) => AuthorizationOutcome::Denied(format!(
                            "the approved permission grant could not be saved; the operation was not executed: {error}"
                        )),
                        Err(error) => AuthorizationOutcome::Denied(format!(
                            "the approved permission grant task failed; the operation was not executed: {error}"
                        )),
                    }
                }
            }
            Ok(PermissionReply::Reject) => AuthorizationOutcome::Denied(
                "the user rejected this permission request".to_string(),
            ),
            Err(_) => AuthorizationOutcome::Denied(
                "the permission request ended before a reply".to_string(),
            ),
        }
    }

    fn remove_pending(&self, request_id: &str) -> bool {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .remove(request_id)
            .is_some()
    }

    async fn dismiss_pending_async(&self, request_id: &str, reason: String) -> bool {
        let dismissed = self.remove_pending(request_id);
        if dismissed {
            self.emit_async(crate::events::SessionEvent::PermissionDismissed {
                request_id: request_id.to_owned(),
                reason,
            })
            .await;
        }
        dismissed
    }

    // Drop cannot await. Remove authority immediately, then let a bounded owned
    // caller publish the dismissal without parking the runtime on another event.
    pub(super) fn dismiss_pending(&self, request_id: &str, reason: String) -> bool {
        let dismissed = self.remove_pending(request_id);
        if dismissed {
            let event = crate::events::SessionEvent::PermissionDismissed {
                request_id: request_id.to_owned(),
                reason,
            };
            if crate::store::coordinator::owner_for(&self.store_path)
                .is_ok_and(|owner| owner.is_some())
            {
                let bus = self
                    .event_bus
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .clone();
                if let Some(bus) = bus {
                    let publisher = bus.clone();
                    if let Err(error) = crate::store::spawn_blocking_store_caller(move || {
                        publisher.emit(event);
                    })
                    .detach()
                    {
                        bus.record_publication_failure();
                        eprintln!("nac: permission dismissal publication rejected: {error}");
                    }
                }
            } else {
                self.emit(event);
            }
        }
        dismissed
    }

    pub(super) async fn load_approval_state(
        &self,
    ) -> Result<(PermissionApprovalMode, i64, i64), String> {
        let store_path = self.store_path.clone();
        let session_id = self.session_id.clone();
        crate::store::spawn_blocking_store_caller(move || {
            crate::sessions::load_effective_permission_approval_state(&store_path, &session_id)
        })
        .await
        .map_err(|error| format!("permission approval mode read task failed: {error}"))?
        .map_err(|error| format!("permission approval mode could not be read: {error}"))
    }

    async fn observed_auto_generation(&self) -> Result<i64, String> {
        let mut observer = self.approval_observer.lock().await;
        if let (Some(checked), Some(observation)) =
            (observer.last_checked, observer.observed_generation.as_ref())
        {
            if checked.elapsed() < APPROVAL_MODE_POLL_INTERVAL {
                return observation.clone();
            }
        }
        let observation = self
            .load_approval_state()
            .await
            .map(|(_, generation, _)| generation);
        observer.last_checked = Some(Instant::now());
        observer.observed_generation = Some(observation.clone());
        observation
    }

    async fn auto_approval_after(&self, generation: i64) {
        loop {
            tokio::time::sleep(APPROVAL_MODE_POLL_INTERVAL).await;
            // Read failures are fail-closed observations, not permission
            // answers. Keep the waiter live and retry on the bounded broker
            // cadence so one transient timeout cannot dismiss every Ask.
            if self
                .observed_auto_generation()
                .await
                .is_ok_and(|observed_generation| observed_generation > generation)
            {
                return;
            }
        }
    }

    async fn interactive_subscriber_lost(&self) {
        loop {
            tokio::time::sleep(APPROVAL_SUBSCRIBER_POLL_INTERVAL).await;
            let interactive = self
                .event_bus
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
                .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
            if !interactive {
                return;
            }
        }
    }

    async fn interactive_subscriber_unavailable(&self, initially_connected: bool) -> String {
        if !initially_connected {
            let connected = tokio::time::timeout(DELEGATED_APPROVAL_CONNECT_TIMEOUT, async {
                loop {
                    tokio::time::sleep(APPROVAL_SUBSCRIBER_POLL_INTERVAL).await;
                    let interactive = self
                        .event_bus
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .as_ref()
                        .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
                    if interactive {
                        return;
                    }
                }
            })
            .await;
            if connected.is_err() {
                return "approval is required, but no interactive parent session client connected; the operation was not executed"
                    .to_string();
            }
        }
        self.interactive_subscriber_lost().await;
        "the interactive session client disconnected while approval was pending".to_string()
    }

    pub(super) async fn emit_async(&self, event: crate::events::SessionEvent) {
        if crate::store::coordinator::owner_for(&self.store_path).is_ok_and(|owner| owner.is_some())
        {
            let bus = self
                .event_bus
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            if let Some(bus) = bus {
                if let Err(error) = bus.emit_with_context_async(event, None, None).await {
                    eprintln!("nac: permission event publication failed: {error}");
                }
            }
        } else {
            self.emit(event);
        }
    }

    fn emit(&self, event: crate::events::SessionEvent) {
        if let Some(bus) = self
            .event_bus
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            bus.emit(event);
        }
    }
}

pub(super) fn epoch_millis_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
type GrantReadGate = (
    tokio::sync::oneshot::Sender<()>,
    tokio::sync::oneshot::Receiver<()>,
);
#[cfg(test)]
static GRANT_READ_GATES: std::sync::LazyLock<StdMutex<HashMap<PathBuf, GrantReadGate>>> =
    std::sync::LazyLock::new(|| StdMutex::new(HashMap::new()));
#[cfg(test)]
pub(super) fn gate_grant_read_for_test(
    path: PathBuf,
) -> (
    tokio::sync::oneshot::Receiver<()>,
    tokio::sync::oneshot::Sender<()>,
) {
    let (entered, reached) = tokio::sync::oneshot::channel();
    let (release, resume) = tokio::sync::oneshot::channel();
    assert!(GRANT_READ_GATES
        .lock()
        .unwrap()
        .insert(path, (entered, resume))
        .is_none());
    (reached, release)
}
#[cfg(test)]
async fn pause_grant_read_for_test(path: &Path) {
    let gate = GRANT_READ_GATES.lock().unwrap().remove(path);
    if let Some((entered, resume)) = gate {
        let _ = entered.send(());
        let _ = resume.await;
    }
}

/// Allows only what policy and grants allow, or Ask under auto-approve.
#[derive(Clone)]
pub(crate) struct PassiveReadFilter {
    policy: PermissionPolicy,
    remembered: Vec<PermissionRule>,
    auto_approve: bool,
}

impl PassiveReadFilter {
    pub(crate) fn allows(&self, resources: &[PermissionResource]) -> bool {
        match self.policy.evaluate(resources, &self.remembered).effect {
            PermissionEffect::Allow => true,
            PermissionEffect::Deny => false,
            PermissionEffect::Ask => self.auto_approve,
        }
    }
}
