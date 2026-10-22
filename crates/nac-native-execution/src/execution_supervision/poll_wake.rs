//! Keep arbitrary caller waker callbacks outside Native/Tokio notification locks.
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
};

#[derive(Default)]
struct Forward {
    caller: Mutex<Option<Arc<Waker>>>,
}
impl Wake for Forward {
    fn wake(self: Arc<Self>) {
        self.wake_by_ref();
    }
    fn wake_by_ref(self: &Arc<Self>) {
        let caller = self
            .caller
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .map(Arc::clone);
        if let Some(caller) = caller {
            caller.wake_by_ref();
        }
    }
}

pub(super) struct PollWake {
    forward: Arc<Forward>,
    waker: Waker,
}
impl PollWake {
    pub(super) fn new() -> Self {
        let forward = Arc::new(Forward::default());
        let waker = Waker::from(Arc::clone(&forward));
        Self { forward, waker }
    }
    pub(super) fn context<'a>(&'a self, cx: &Context<'_>) -> Context<'a> {
        // Clone, allocation and the displaced caller's Drop are all outside
        // locks. Internal registration sees only standard Arc waker callbacks.
        let caller = Arc::new(cx.waker().clone());
        let old = self
            .forward
            .caller
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replace(caller);
        drop(old);
        self.current_context()
    }
    pub(super) fn current_context(&self) -> Context<'_> {
        Context::from_waker(&self.waker)
    }
}

struct ForwardFuture<F> {
    // Drop the actual future/notification registrations before the last local
    // forwarding waker, whose final Drop may run arbitrary caller code.
    future: Pin<Box<F>>,
    wake: PollWake,
}
impl<F: Future> Future for ForwardFuture<F> {
    type Output = F::Output;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.get_mut();
        let mut safe = this.wake.context(cx);
        this.future.as_mut().poll(&mut safe)
    }
}
pub(super) fn future<'a, F: Future + Send + 'a>(
    future: F,
) -> Pin<Box<dyn Future<Output = F::Output> + Send + 'a>> {
    Box::pin(ForwardFuture {
        future: Box::pin(future),
        wake: PollWake::new(),
    })
}
