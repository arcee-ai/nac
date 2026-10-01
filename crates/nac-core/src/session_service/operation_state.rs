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
