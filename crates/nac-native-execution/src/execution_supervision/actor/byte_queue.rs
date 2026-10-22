//! One-way finite byte queue. Caller waker clone/drop/wake never runs under its lock.
use std::{
    collections::VecDeque,
    io,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

struct State {
    bytes: VecDeque<u8>,
    limit: usize,
    writer_closed: bool,
    reader_closed: bool,
    read: Option<Waker>,
    write: Option<Waker>,
}
pub(super) struct Reader(Arc<Mutex<State>>);
pub(super) struct Writer(Arc<Mutex<State>>);

pub(super) fn pair(limit: usize) -> io::Result<(Writer, Reader)> {
    if limit == 0 {
        return Err(io::Error::other("Native byte queue window is zero"));
    }
    let mut bytes = VecDeque::new();
    bytes.try_reserve_exact(limit).map_err(io::Error::other)?;
    let state = Arc::new(Mutex::new(State {
        bytes,
        limit,
        writer_closed: false,
        reader_closed: false,
        read: None,
        write: None,
    }));
    Ok((Writer(Arc::clone(&state)), Reader(state)))
}
impl AsyncRead for Reader {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        out: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if out.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        let mut candidate = Some(cx.waker().clone());
        let (result, wake, old) = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if !state.bytes.is_empty() {
                let count = state.bytes.len().min(out.remaining());
                let (one, two) = state.bytes.as_slices();
                let first = count.min(one.len());
                out.put_slice(&one[..first]);
                out.put_slice(&two[..count - first]);
                state.bytes.drain(..count);
                (Poll::Ready(Ok(())), state.write.take(), None)
            } else if state.writer_closed {
                (Poll::Ready(Ok(())), None, None)
            } else {
                let old = std::mem::replace(&mut state.read, candidate.take());
                (Poll::Pending, None, old)
            }
        };
        drop(candidate);
        drop(old);
        if let Some(waker) = wake {
            waker.wake();
        }
        result
    }
}
impl AsyncWrite for Writer {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let mut candidate = Some(cx.waker().clone());
        let (result, wake, old) = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if state.reader_closed || state.writer_closed {
                (
                    Poll::Ready(Err(io::ErrorKind::BrokenPipe.into())),
                    None,
                    None,
                )
            } else if data.is_empty() {
                (Poll::Ready(Ok(0)), None, None)
            } else {
                let count = (state.limit - state.bytes.len()).min(data.len());
                if count == 0 {
                    let old = std::mem::replace(&mut state.write, candidate.take());
                    (Poll::Pending, None, old)
                } else {
                    state.bytes.extend(&data[..count]);
                    (Poll::Ready(Ok(count)), state.read.take(), None)
                }
            }
        };
        drop(candidate);
        drop(old);
        if let Some(waker) = wake {
            waker.wake();
        }
        result
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.close();
        Poll::Ready(Ok(()))
    }
}
impl Writer {
    fn close(&self) {
        let (read, write) = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.writer_closed = true;
            (state.read.take(), state.write.take())
        };
        drop(write);
        if let Some(waker) = read {
            waker.wake();
        }
    }
}
impl Drop for Writer {
    fn drop(&mut self) {
        self.close();
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        let (read, write) = {
            let mut state = self
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.reader_closed = true;
            (state.read.take(), state.write.take())
        };
        drop(read);
        if let Some(waker) = write {
            waker.wake();
        }
    }
}
#[cfg(test)]
mod tests;
