use crate::{state::ConnectionState, AuthenticatedPeer};
use std::{
    io,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::TcpStream,
};
use tokio_rustls::server::TlsStream;

/// The original accepted I/O owns connection lifetime. A cloned peer view or
/// pending invalidation future cannot keep a dropped/closed stream authentic.
pub struct AuthenticatedStream {
    pub(crate) stream: TlsStream<TcpStream>,
    pub(crate) state: Arc<ConnectionState>,
}
impl AuthenticatedStream {
    pub fn peer(&self) -> AuthenticatedPeer {
        AuthenticatedPeer(Arc::downgrade(&self.state))
    }
    /// Existing dedicated transport adapters may inspect the real handshake
    /// and use its channel exporter. No raw I/O or lifetime owner is moved out.
    pub fn tls_connection(&self) -> &tokio_rustls::rustls::ServerConnection {
        self.stream.get_ref().1
    }
}
impl Drop for AuthenticatedStream {
    fn drop(&mut self) {
        self.state.close();
    }
}
impl AsyncRead for AuthenticatedStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        let this = self.get_mut();
        let before = buf.filled().len();
        let capacity = buf.remaining();
        let result = Pin::new(&mut this.stream).poll_read(cx, buf);
        if matches!(&result, Poll::Ready(Err(_)))
            || (matches!(&result, Poll::Ready(Ok(())))
                && capacity != 0
                && buf.filled().len() == before)
        {
            this.state.close();
        }
        result
    }
}
impl AsyncWrite for AuthenticatedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let result = Pin::new(&mut this.stream).poll_write(cx, buf);
        if matches!(&result, Poll::Ready(Err(_)))
            || (matches!(&result, Poll::Ready(Ok(0))) && !buf.is_empty())
        {
            this.state.close();
        }
        result
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        let result = Pin::new(&mut this.stream).poll_flush(cx);
        if matches!(&result, Poll::Ready(Err(_))) {
            this.state.close();
        }
        result
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        this.state.close();
        Pin::new(&mut this.stream).poll_shutdown(cx)
    }
}
