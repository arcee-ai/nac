//! Process-local run publication. Read projections never wait on the mutable
//! admission state while its owner waits for a durable precondition. The guard
//! publishes only the established operation on release; pending admission is
//! conservatively busy but never presented as an accepted run.
use super::*;
use std::ops::{Deref, DerefMut};

pub(super) struct ActiveOperationGuard<'a> {
    operation: std::sync::MutexGuard<'a, Option<ActiveSessionOperation>>,
    published: &'a StdMutex<Option<ActiveSessionOperationSnapshot>>,
}
impl<'a> ActiveOperationGuard<'a> {
    pub(super) fn new(service: &'a SessionService) -> Self {
        Self {
            operation: service
                .active_operation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            published: &service.published_operation,
        }
    }
}
impl Deref for ActiveOperationGuard<'_> {
    type Target = Option<ActiveSessionOperation>;
    fn deref(&self) -> &Self::Target {
        &self.operation
    }
}
impl DerefMut for ActiveOperationGuard<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.operation
    }
}
impl Drop for ActiveOperationGuard<'_> {
    fn drop(&mut self) {
        *self
            .published
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = self
            .operation
            .as_ref()
            .map(ActiveSessionOperation::snapshot);
    }
}

impl SessionService {
    /// Internal lifecycle coordination owns one bounded obligation per active
    /// operation. Only definite caller rejection retries; the closure has no
    /// persistence executor authority and must contain local transitions only.
    pub(super) async fn coordinate_local<F, R>(&self, operation: F) -> anyhow::Result<R>
    where
        F: FnOnce(SessionService) -> R + Clone + Send + 'static,
        R: Send + 'static,
    {
        loop {
            let service = self.clone();
            let operation = operation.clone();
            let owned = crate::store::coordinator::owner_for(&self.metadata.store_path)
                .map(|owner| owner.is_some())
                .unwrap_or(true);
            let result = if owned {
                crate::store::spawn_blocking_store_caller(move || operation(service)).await
            } else {
                Ok(operation(service))
            };
            match result {
                Err(error)
                    if matches!(
                        error.downcast_ref::<crate::store::PersistenceAdmissionError>(),
                        Some(crate::store::PersistenceAdmissionError::CallerOverloaded)
                    ) =>
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                result => return result,
            }
        }
    }
}
