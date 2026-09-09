use super::*;

impl PermissionBroker {
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
        }
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
        let store_path = self.store_path.clone();
        let session_id = self.session_id.clone();
        let revision = tokio::task::spawn_blocking(move || {
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
        let updated = tokio::task::spawn_blocking(move || {
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
        self.emit(crate::events::SessionEvent::PermissionApprovalModeChanged { mode });
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
                self.emit(crate::events::SessionEvent::PermissionReplied {
                    request_id,
                    reply: PermissionReply::Once,
                });
            } else {
                self.emit(crate::events::SessionEvent::PermissionDismissed {
                    request_id,
                    reason:
                        "the operation awaiting automatic approval ended before the mode changed"
                            .to_string(),
                });
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

    pub fn reply(&self, request_id: &str, reply: PermissionReply) -> anyhow::Result<()> {
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
        self.emit(crate::events::SessionEvent::PermissionReplied {
            request_id: request_id.to_string(),
            reply,
        });
        Ok(())
    }

    pub(crate) async fn authorize(
        self: &Arc<Self>,
        tool: &str,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
    ) -> AuthorizationOutcome {
        if resources.is_empty() {
            return AuthorizationOutcome::Denied(format!(
                "tool '{tool}' did not declare canonical permission resources"
            ));
        }
        let remembered = match crate::store::list_effective_permission_grants(
            &self.store_path,
            &self.session_id,
            self.backend,
            self.session_config_version,
        ) {
            Ok(grants) => grants
                .into_iter()
                .map(|grant| {
                    PermissionRule::new(grant.action, grant.resource, PermissionEffect::Allow)
                })
                .collect::<Vec<_>>(),
            Err(error) => {
                return AuthorizationOutcome::Denied(format!(
                    "permission grants could not be read: {error}"
                ));
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

        // The durable mode is consulted only after ordered configured and hard
        // policy has produced Ask. It is never cached: independent managers and
        // processes may attach the same durable session.
        let (_, initial_auto_generation, _) = match self.load_approval_state().await {
            Ok((PermissionApprovalMode::AutoApprove, _, _)) => {
                return AuthorizationOutcome::Allowed;
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
        let delegated_child =
            match crate::store::load_traditional_child(&self.store_path, &self.session_id) {
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
                return AuthorizationOutcome::Allowed;
            }
            Ok((PermissionApprovalMode::Manual, generation, _))
                if generation > initial_auto_generation =>
            {
                // Auto-approve was enabled and then disabled while this Ask
                // was already resolving broker ownership. The enable still
                // owns this invocation even though it never became pending.
                return AuthorizationOutcome::Allowed;
            }
            Ok((PermissionApprovalMode::Manual, generation, _)) => generation,
            Err(reason) => return AuthorizationOutcome::Denied(reason),
        };
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if !interactive && !delegated_child {
                return AuthorizationOutcome::Denied(
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
        }
        let _pending_guard = PendingPermissionGuard {
            broker: Arc::downgrade(self),
            request_id: request.id.clone(),
        };
        let waiter_live = Arc::new(StdMutex::new(true));
        let _waiter_liveness = PermissionWaiterLiveness {
            live: Arc::clone(&waiter_live),
        };
        self.emit(crate::events::SessionEvent::PermissionAsked {
            request: request.clone(),
        });

        tokio::pin!(receiver);
        let result = tokio::select! {
            biased;
            reply = &mut receiver => self.reply_outcome(reply, &request, &waiter_live).await,
            () = cancellation.cancelled() => {
                let reason = "run was cancelled while awaiting approval".to_string();
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
            () = self.auto_approval_after(approval_generation) => {
                // A local manual reply or cancellation may have claimed the
                // request after the durable generation was read. Whichever
                // removes it first owns the sole reply.
                let _ = self.reply(&request.id, PermissionReply::Once);
                self.reply_outcome(receiver.await, &request, &waiter_live).await
            },
            reason = self.interactive_subscriber_unavailable(interactive) => {
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
            () = tokio::time::sleep(APPROVAL_TIMEOUT) => {
                let reason = "permission request timed out without a reply".to_string();
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
        };
        // A reply owns the request by removing it and successfully delivering
        // to this exact waiter. Durable grants are written only after receipt,
        // so a dropped receiver can never leave authority behind.
        result
    }

    async fn reply_outcome(
        &self,
        reply: Result<PermissionReply, tokio::sync::oneshot::error::RecvError>,
        request: &PermissionRequest,
        waiter_live: &Arc<StdMutex<bool>>,
    ) -> AuthorizationOutcome {
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
                    match tokio::task::spawn_blocking(move || {
                        crate::store::insert_permission_grant_set_if_waiter_live(
                            &store_path,
                            &session_id,
                            &grants,
                            backend,
                            session_config_version,
                            &waiter_live,
                        )
                    })
                    .await
                    {
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

    pub(super) fn dismiss_pending(&self, request_id: &str, reason: String) -> bool {
        let dismissed = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending
            .remove(request_id)
            .is_some();
        if dismissed {
            self.emit(crate::events::SessionEvent::PermissionDismissed {
                request_id: request_id.to_string(),
                reason,
            });
        }
        dismissed
    }

    async fn load_approval_state(&self) -> Result<(PermissionApprovalMode, i64, i64), String> {
        let store_path = self.store_path.clone();
        let session_id = self.session_id.clone();
        tokio::task::spawn_blocking(move || {
            crate::sessions::load_permission_approval_state(&store_path, &session_id)
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

fn epoch_millis_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
