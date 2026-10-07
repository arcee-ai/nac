//! Native connection lifetime, independent of canonical bytes and product policy.
use super::*;
use std::{
    pin::Pin,
    sync::atomic::{AtomicBool, Ordering},
    task::{Context as TaskContext, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

#[derive(Debug)]
pub(super) struct IssuerChannel {
    id: Uuid,
    leaf_sha256: [u8; 32],
    open: AtomicBool,
    dialog_claimed: AtomicBool,
    closed: tokio::sync::Notify,
}

impl IssuerChannel {
    pub(super) fn id(&self) -> Uuid {
        self.id
    }

    pub(super) fn leaf_sha256(&self) -> [u8; 32] {
        self.leaf_sha256
    }

    pub(super) fn check_live(&self) -> Result<()> {
        if !self.open.load(Ordering::Acquire) {
            bail!("issuer control channel unavailable");
        }
        Ok(())
    }

    pub(super) fn close(&self) {
        if self.open.swap(false, Ordering::AcqRel) {
            self.closed.notify_waiters();
        }
    }

    pub(super) fn claim_dialog(&self) -> Result<()> {
        self.check_live()?;
        if self
            .dialog_claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            bail!("issuer control dialog already claimed");
        }
        self.check_live()
    }

    pub(super) async fn wait_for_close(&self) {
        loop {
            let changed = self.closed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.check_live().is_err() {
                return;
            }
            changed.await;
        }
    }
}

/// Only the separately enrolled listener constructs this stream and marker.
pub(crate) struct IssuerControlStream {
    stream: TlsStream<TcpStream>,
    channel: Arc<IssuerChannel>,
}

impl IssuerControlStream {
    #[expect(
        clippy::expect_used,
        reason = "purpose listener returns only CA-verified exact-pinned TLS connections"
    )]
    pub(super) fn from_verified_tls(stream: TlsStream<TcpStream>) -> Self {
        let leaf = stream
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|chain| chain.first())
            .expect("issuer transport verifies its configured peer before wrapping");
        let channel = Arc::new(IssuerChannel {
            id: Uuid::new_v4(),
            leaf_sha256: Sha256::digest(leaf.as_ref()).into(),
            open: AtomicBool::new(true),
            dialog_claimed: AtomicBool::new(false),
            closed: tokio::sync::Notify::new(),
        });
        Self { stream, channel }
    }

    pub(super) fn peer(&self) -> AuthenticatedIssuerControlPeer {
        AuthenticatedIssuerControlPeer {
            channel: Arc::clone(&self.channel),
        }
    }
}

impl AsyncRead for IssuerControlStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let remaining = buf.remaining();
        if remaining == 0 {
            return Poll::Ready(Ok(()));
        }
        let filled = buf.filled().len();
        let result = Pin::new(&mut self.stream).poll_read(cx, buf);
        if matches!(&result, Poll::Ready(Err(_)))
            || (matches!(&result, Poll::Ready(Ok(()))) && buf.filled().len() == filled)
        {
            self.channel.close();
        }
        result
    }
}

impl AsyncWrite for IssuerControlStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let result = Pin::new(&mut self.stream).poll_write(cx, bytes);
        if matches!(&result, Poll::Ready(Err(_))) {
            self.channel.close();
        }
        result
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<std::io::Result<()>> {
        let result = Pin::new(&mut self.stream).poll_flush(cx);
        if matches!(&result, Poll::Ready(Err(_))) {
            self.channel.close();
        }
        result
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        cx: &mut TaskContext<'_>,
    ) -> Poll<std::io::Result<()>> {
        self.channel.close();
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

impl Drop for IssuerControlStream {
    fn drop(&mut self) {
        self.channel.close();
    }
}
