use std::{io, net::SocketAddr};

use axum::serve::Listener;
use tokio::net::{TcpListener, TcpStream};

/// Disable Nagle buffering before serving each interactive HTTP connection.
/// A peer that resets before accept can make this socket-local policy fail.
/// Refuse that socket while leaving listener ownership and shutdown unchanged.
pub(super) struct HttpListener(pub(super) TcpListener);

impl HttpListener {
    async fn accept_with_policy(
        &mut self,
        mut configure: impl FnMut(&TcpStream) -> io::Result<()>,
    ) -> (TcpStream, SocketAddr) {
        loop {
            // Retain axum's handling of listener accept errors and backoff.
            let (socket, address) = Listener::accept(&mut self.0).await;
            match configure(&socket) {
                Ok(()) => return (socket, address),
                Err(error) => {
                    eprintln!("nac: refusing HTTP connection: failed to set TCP_NODELAY: {error}");
                    drop(socket);
                }
            }
        }
    }
}

impl Listener for HttpListener {
    type Io = TcpStream;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        self.accept_with_policy(|socket| socket.set_nodelay(true))
            .await
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.0.local_addr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn policy_failures_refuse_only_the_failed_sockets_and_continue_accepting() {
        let mut listener = HttpListener(TcpListener::bind("127.0.0.1:0").await.unwrap());
        let address = listener.local_addr().unwrap();
        let mut rejected = TcpStream::connect(address).await.unwrap();
        let mut also_rejected = TcpStream::connect(address).await.unwrap();
        let mut healthy = TcpStream::connect(address).await.unwrap();
        let mut calls = 0;
        let (mut accepted, peer) = listener
            .accept_with_policy(|socket| {
                calls += 1;
                if calls <= 2 {
                    Err(io::Error::from(io::ErrorKind::InvalidInput))
                } else {
                    socket.set_nodelay(true)
                }
            })
            .await;
        assert_eq!(calls, 3);
        assert_eq!(peer, healthy.local_addr().unwrap());
        assert_eq!(accepted.local_addr().unwrap(), address);
        assert!(accepted.nodelay().unwrap());
        let mut byte = [0];
        assert_eq!(rejected.read(&mut byte).await.unwrap(), 0);
        assert_eq!(also_rejected.read(&mut byte).await.unwrap(), 0);
        accepted.write_all(b"healthy").await.unwrap();
        let mut response = [0; 7];
        healthy.read_exact(&mut response).await.unwrap();
        assert_eq!(&response, b"healthy");
    }

    #[tokio::test]
    async fn accept_remains_cancellable_after_refusing_a_socket() {
        let mut listener = HttpListener(TcpListener::bind("127.0.0.1:0").await.unwrap());
        let address = listener.local_addr().unwrap();
        let _rejected = TcpStream::connect(address).await.unwrap();
        let (refused_tx, refused_rx) = tokio::sync::oneshot::channel();
        let mut refused_tx = Some(refused_tx);
        {
            let accepting = listener.accept_with_policy(|_| {
                refused_tx.take().unwrap().send(()).unwrap();
                Err(io::Error::from(io::ErrorKind::InvalidInput))
            });
            tokio::pin!(accepting);
            tokio::select! {
                _ = &mut accepting => panic!("failed socket must never be returned"),
                _ = refused_rx => {}
            }
        }
        // Cancelling the pending accept leaves the same listener usable.
        let healthy = TcpStream::connect(address).await.unwrap();
        let (accepted, peer) = Listener::accept(&mut listener).await;
        assert_eq!(peer, healthy.local_addr().unwrap());
        assert!(accepted.nodelay().unwrap());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn darwin_reset_before_accept_reproduces_policy_error_and_accepts_next_peer() {
        use std::os::fd::AsRawFd;
        let mut listener = HttpListener(TcpListener::bind("127.0.0.1:0").await.unwrap());
        let address = listener.local_addr().unwrap();
        let reset = std::net::TcpStream::connect(address).unwrap();
        let linger = libc::linger {
            l_onoff: 1,
            l_linger: 0,
        };
        // SAFETY: a live owned TCP descriptor and the exact SO_LINGER layout.
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    reset.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_LINGER,
                    (&linger as *const libc::linger).cast(),
                    std::mem::size_of_val(&linger) as libc::socklen_t,
                )
            },
            0
        );
        drop(reset);
        let healthy = TcpStream::connect(address).await.unwrap();
        let mut errors = Vec::new();
        let (accepted, peer) = listener
            .accept_with_policy(|socket| {
                let result = socket.set_nodelay(true);
                if let Err(error) = &result {
                    errors.push(error.kind());
                }
                result
            })
            .await;
        assert_eq!(errors, [io::ErrorKind::InvalidInput]);
        assert_eq!(peer, healthy.local_addr().unwrap());
        assert!(accepted.nodelay().unwrap());
    }
}
