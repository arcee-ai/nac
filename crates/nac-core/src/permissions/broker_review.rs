//! Automatic permission review on the broker: reviewer and secret wiring,
//! the review of one eligible Ask request, and blocked-action retry
//! authorization. The request/reply lifecycle stays in `broker.rs`.

use super::*;

impl PermissionBroker {
    /// Refines the backend reviews describe and judge, for example a Podman
    /// sandbox, which is classified again at every review.
    pub(crate) fn set_review_backend(&self, backend: super::review::ReviewBackendSource) {
        *self
            .review_backend
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = backend;
    }

    /// Managed command-environment secrets are removed exactly from anything
    /// sent to the reviewer.
    pub(crate) fn set_command_environment(
        &self,
        provider: Option<Arc<dyn nac_contracts::CommandEnvironmentProvider>>,
    ) {
        *self
            .command_environment
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = provider;
    }

    #[cfg(test)]
    pub(crate) fn set_review_deadline(&self, deadline: Duration) {
        *self
            .review_deadline
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = deadline;
    }

    /// Installs the automatic reviewer used when the effective mode is
    /// review. Without one, review mode cannot be selected and reviews are
    /// unavailable.
    pub(crate) fn set_reviewer(&self, reviewer: Arc<dyn PermissionReviewer>) {
        *self
            .reviewer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(reviewer);
    }

    pub(super) fn reviewer(&self) -> Option<Arc<dyn PermissionReviewer>> {
        self.reviewer
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn review_memory(&self) -> std::sync::MutexGuard<'_, ReviewMemory> {
        self.review
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Resets the per-run review limits. Called at the start of each run.
    pub(crate) fn begin_review_run(&self) {
        self.review_memory().begin_run();
    }

    /// Returns why automatic review stopped the current run, once.
    pub(crate) fn take_review_stop(&self) -> Option<String> {
        self.review_memory().run.take_stop()
    }

    /// Recently blocked reviews the user may authorize for one retry,
    /// newest first.
    pub fn blocked_reviews(&self) -> Vec<PermissionReview> {
        self.review_memory().blocked()
    }

    /// Records the user's explicit authorization to retry one blocked action.
    /// The retry is a new invocation: policy runs again and the reviewer
    /// reviews it afresh with this authorization as user intent. Nothing is
    /// bypassed and no grant is created.
    pub fn authorize_review_retry(&self, review_id: &str) -> anyhow::Result<PermissionReview> {
        self.review_memory()
            .authorize_retry(review_id)
            .ok_or_else(|| anyhow::anyhow!("blocked review '{review_id}' was not found"))
    }

    /// Seeds a blocked review for delivery-layer tests.
    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_blocked_review_for_test(&self, review: PermissionReview) {
        let resources = review
            .resources
            .iter()
            .map(|resource| PermissionResource::new(&resource.action, &resource.resource))
            .collect::<Vec<_>>();
        let fingerprint = invocation_fingerprint(&review.tool, &resources);
        let mut memory = self.review_memory();
        memory.record(&review);
        memory.remember_blocked(BlockedReview {
            review,
            fingerprint,
        });
    }

    /// Number of live retry authorizations, for delivery-layer tests.
    #[cfg(any(test, feature = "test-support"))]
    pub fn pending_retry_authorizations_for_test(&self) -> usize {
        self.review_memory().pending_authorizations()
    }

    /// Withdraws a retry authorization whose retry request could not be
    /// delivered, returning the action to the blocked list.
    pub fn revoke_review_retry(&self, review_id: &str) -> bool {
        self.review_memory().revoke_retry(review_id)
    }

    /// Recent automatic reviews in every state, newest first.
    pub fn recent_reviews(&self) -> Vec<PermissionReview> {
        self.review_memory().recent()
    }

    /// Reviews one eligible Ask request. `None` means the request is not
    /// eligible and keeps the manual path. Every other result is final for
    /// this invocation: an allow once, or an unexecuted denial for the model.
    pub(super) async fn review(
        &self,
        tool: &str,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
        mode_revision: i64,
    ) -> Option<AuthorizationOutcome> {
        let source = self
            .review_backend
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        // Classifying a sandbox reads its workspace.
        let backend = tokio::task::spawn_blocking(move || source.current())
            .await
            .ok()?;
        review_eligibility(resources, backend).ok()?;
        if self.review_memory().run.stopped() {
            return Some(AuthorizationOutcome::Denied(blocked_message(
                PermissionReviewCode::ReviewStopped,
                None,
            )));
        }
        // Without the person's messages the reviewer cannot judge scope, so
        // the request keeps the manual path: no person has typed input for
        // this tree yet (for example an MCP-driven session), the task
        // outgrew what is kept, or the intent could not be read.
        let crate::sessions::ReviewIntent::Accepted(intent) =
            crate::sessions::reviewable_intent(self.store_path.clone(), self.session_id.clone())
                .await
        else {
            return None;
        };
        let fingerprint = invocation_fingerprint(tool, resources);
        let provider = self
            .command_environment
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        // Secret discovery reads credential files and the environment.
        let secrets =
            tokio::task::spawn_blocking(move || ExactSecrets::current(provider.as_deref()))
                .await
                .ok()?
                .ok()?;
        let mut request =
            review_request(tool, resources, backend, &intent, false, &secrets).ok()?;
        // A retry authorization is taken only once a review that carries it
        // is certain to run. It is spent only by a verdict that settles the
        // action; otherwise it goes back with its original expiry.
        let authorization = HeldAuthorization {
            memory: &self.review,
            authorization: self.review_memory().take_authorization(&fingerprint),
        };
        let authorized = authorization.authorization.is_some();
        request.user_authorized_retry = authorized;
        let reviewer = self.reviewer();
        let mut review = PermissionReview {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            call_id: context.call_id.clone(),
            tool: tool.to_owned(),
            backend: request.backend.to_owned(),
            resources: request.resources.clone(),
            user_authorized_retry: authorized,
            outcome: None,
            code: None,
            category: None,
            duration_ms: None,
            reviewer: reviewer
                .as_ref()
                .map_or_else(|| "none".to_string(), |reviewer| reviewer.identity()),
            created_at_epoch_ms: super::broker::epoch_millis_now(),
        };
        self.review_memory().record(&review);
        self.emit_async(crate::events::SessionEvent::PermissionReviewStarted {
            review: Box::new(review.clone()),
        })
        .await;

        let deadline = *self
            .review_deadline
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let started = Instant::now();
        let verdict = match reviewer {
            None => Err(ReviewUnavailable(
                "no automatic reviewer is configured".to_string(),
            )),
            Some(reviewer) => {
                tokio::select! {
                    biased;
                    () = cancellation.cancelled() => {
                        review.outcome = Some(PermissionReviewOutcome::Unavailable);
                        review.code = Some(PermissionReviewCode::ReviewUnavailable);
                        self.review_memory().record(&review);
                        self.emit_async(crate::events::SessionEvent::PermissionReviewed {
                            review: Box::new(review),
                        })
                        .await;
                        return Some(AuthorizationOutcome::Denied(
                            "run was cancelled during automatic review".to_string(),
                        ));
                    }
                    verdict = tokio::time::timeout(deadline, reviewer.review(&request)) => {
                        verdict.unwrap_or_else(|_| Err(ReviewUnavailable(
                            "automatic review timed out".to_string(),
                        )))
                    }
                }
            }
        };
        review.duration_ms = Some(u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX));
        // A verdict only answers the mode it was requested under. If the user
        // changed the answer policy while the reviewer ran, even to another
        // mode and back, discard it and let the current mode decide; a
        // superseded review has no outcome. Selecting the current mode again
        // does not move the revision.
        match self.load_approval_state().await {
            Ok((PermissionApprovalMode::Review, _, revision)) if revision == mode_revision => {}
            _ => {
                self.review_memory().forget(&review.id);
                self.emit_async(crate::events::SessionEvent::PermissionReviewed {
                    review: Box::new(review),
                })
                .await;
                return None;
            }
        }
        let (outcome, code, category) = match verdict {
            Ok(ReviewVerdict::ApproveOnce) => (PermissionReviewOutcome::Approved, None, None),
            Ok(ReviewVerdict::Reject(category)) => (
                PermissionReviewOutcome::Rejected,
                Some(PermissionReviewCode::ReviewRejected),
                Some(category),
            ),
            Ok(ReviewVerdict::Uncertain(category)) => (
                PermissionReviewOutcome::Uncertain,
                Some(PermissionReviewCode::ReviewUncertain),
                category,
            ),
            Err(ReviewUnavailable(reason)) => {
                eprintln!("nac: automatic permission review unavailable: {reason}");
                (
                    PermissionReviewOutcome::Unavailable,
                    Some(PermissionReviewCode::ReviewUnavailable),
                    None,
                )
            }
        };
        review.outcome = Some(outcome);
        review.code = code;
        review.category = category;
        {
            let mut memory = self.review_memory();
            memory.run.record(outcome);
            memory.record(&review);
            if matches!(
                outcome,
                PermissionReviewOutcome::Rejected | PermissionReviewOutcome::Uncertain
            ) {
                memory.remember_blocked(BlockedReview {
                    review: review.clone(),
                    fingerprint,
                });
            }
        }
        self.emit_async(crate::events::SessionEvent::PermissionReviewed {
            review: Box::new(review.clone()),
        })
        .await;
        // An approval that runs, or a rejection that blocks the action again,
        // spends the authorization. An unavailable review judged nothing,
        // and a cancelled approval runs nothing, so both give it back.
        Some(match code {
            None if cancellation.is_cancelled() => AuthorizationOutcome::Denied(
                "run was cancelled before authorization completed".to_string(),
            ),
            None => {
                authorization.spend();
                AuthorizationOutcome::Allowed
            }
            Some(code) => {
                if code != PermissionReviewCode::ReviewUnavailable {
                    authorization.spend();
                }
                AuthorizationOutcome::Denied(blocked_message(code, category))
            }
        })
    }
}

/// A retry authorization taken for one review. Unless the review spends it,
/// dropping it, including when the review is cancelled, superseded or
/// abandoned midway, returns it with its original expiry.
struct HeldAuthorization<'a> {
    memory: &'a std::sync::Mutex<ReviewMemory>,
    authorization: Option<super::review::RetryAuthorization>,
}

impl HeldAuthorization<'_> {
    fn spend(mut self) {
        self.authorization = None;
    }
}

impl Drop for HeldAuthorization<'_> {
    fn drop(&mut self) {
        if let Some(authorization) = self.authorization.take() {
            self.memory
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .restore_authorization(authorization);
        }
    }
}
