use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) struct ScriptedResponse {
    status: &'static str,
    headers: BTreeMap<String, String>,
    body: String,
    send_response: bool,
}

impl ScriptedResponse {
    pub(crate) fn json(status: &'static str, body: impl Into<String>) -> Self {
        Self {
            status,
            headers: BTreeMap::new(),
            body: body.into(),
            send_response: true,
        }
    }

    pub(crate) fn redirect(
        status: &'static str,
        location: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            status,
            headers: BTreeMap::from([("Location".to_string(), location.into())]),
            body: body.into(),
            send_response: true,
        }
    }

    pub(crate) fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.insert(name.into(), value.into());
        self
    }

    pub(crate) fn drop_connection(mut self) -> Self {
        self.send_response = false;
        self
    }
}

#[derive(Debug)]
pub(crate) struct CapturedRequest {
    pub(crate) method: String,
    pub(crate) path: String,
    pub(crate) headers: BTreeMap<String, String>,
    pub(crate) header_counts: BTreeMap<String, usize>,
    pub(crate) body: Vec<u8>,
}

pub(crate) struct ScriptedServer {
    pub(crate) base_url: String,
    handle: thread::JoinHandle<Vec<CapturedRequest>>,
    stop: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

impl ScriptedServer {
    pub(crate) fn start(responses: Vec<ScriptedResponse>) -> Self {
        Self::start_observed(responses, |_index, _request| {})
    }

    pub(crate) fn start_observed<F>(responses: Vec<ScriptedResponse>, observer: F) -> Self
    where
        F: Fn(usize, &CapturedRequest) + Send + 'static,
    {
        Self::start_observed_with_timeout(responses, Duration::from_secs(5), observer)
    }

    /// Construction has its own bounded wait; responses use the caller's one
    /// original deadline, shared with the lifecycle settlement being measured.
    pub(crate) fn start_observed_armed<F>(
        responses: Vec<ScriptedResponse>,
        observer: F,
    ) -> (Self, std::sync::mpsc::SyncSender<Instant>)
    where
        F: Fn(usize, &CapturedRequest) + Send + 'static,
    {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        (
            Self::start_observed_with_start(
                responses,
                Duration::from_secs(5),
                Some(receiver),
                observer,
            ),
            sender,
        )
    }

    pub(crate) fn start_observed_with_timeout<F>(
        responses: Vec<ScriptedResponse>,
        timeout: Duration,
        observer: F,
    ) -> Self
    where
        F: Fn(usize, &CapturedRequest) + Send + 'static,
    {
        Self::start_observed_with_start(responses, timeout, None, observer)
    }

    fn start_observed_with_start<F>(
        responses: Vec<ScriptedResponse>,
        timeout: Duration,
        start: Option<std::sync::mpsc::Receiver<Instant>>,
        observer: F,
    ) -> Self
    where
        F: Fn(usize, &CapturedRequest) + Send + 'static,
    {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind scripted HTTP server");
        listener
            .set_nonblocking(true)
            .expect("set scripted HTTP listener nonblocking");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopped = stop.clone();
        let handle = thread::spawn(move || {
            let armed = start.is_some();
            let deadline = match start {
                Some(receiver) => match receiver.recv_timeout(timeout) {
                    Ok(deadline) => deadline,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Vec::new(),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        panic!("scripted HTTP construction was not armed within its budget")
                    }
                },
                None => Instant::now() + timeout,
            };
            let mut requests = Vec::with_capacity(responses.len());
            for (index, response) in responses.into_iter().enumerate() {
                if armed {
                    assert!(
                        Instant::now() < deadline,
                        "scripted HTTP response budget expired before request {}",
                        index + 1
                    );
                }
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            if armed {
                                assert!(
                                    Instant::now() < deadline,
                                    "scripted HTTP response budget expired before request {}",
                                    index + 1
                                );
                            }
                            break stream;
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            if stopped.load(std::sync::atomic::Ordering::Acquire) {
                                return requests;
                            }
                            assert!(
                                Instant::now() < deadline,
                                "timed out waiting for scripted HTTP request {}",
                                requests.len() + 1
                            );
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("accept scripted HTTP request: {error}"),
                    }
                };
                let request = read_request(&mut stream);
                observer(index, &request);
                requests.push(request);
                if response.send_response {
                    write_response(&mut stream, &response);
                }
            }
            requests
        });
        Self {
            base_url,
            handle,
            stop: Some(stop),
        }
    }

    pub(crate) fn start_same_origin_redirect(
        status: &'static str,
        redirect_path: &str,
        body: impl Into<String>,
    ) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect HTTP server");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let response =
            ScriptedResponse::redirect(status, format!("{base_url}{redirect_path}"), body);
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept initial redirect request");
            let mut requests = vec![read_request(&mut stream)];
            write_response(&mut stream, &response);

            listener
                .set_nonblocking(true)
                .expect("observe redirected requests nonblocking");
            let deadline = Instant::now() + Duration::from_millis(250);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        requests.push(read_request(&mut stream));
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("observe redirected request: {error}"),
                }
            }
            requests
        });
        Self {
            base_url,
            handle,
            stop: None,
        }
    }

    /// Binds a listener that treats every connection as unexpected: for
    /// `window`, it captures any request and answers 500, then stops.
    /// `finish()` returns whatever arrived — the zero-network assertion is
    /// `finish().is_empty()`.
    pub(crate) fn start_unexpected_request_server(window: Duration) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind unexpected-request server");
        listener
            .set_nonblocking(true)
            .expect("set unexpected-request listener nonblocking");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + window;
            let mut requests = Vec::new();
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let request = read_request(&mut stream);
                        write_response(
                            &mut stream,
                            &ScriptedResponse::json("500 Internal Server Error", "{}"),
                        );
                        requests.push(request);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("accept unexpected request: {error}"),
                }
            }
            requests
        });
        Self {
            base_url,
            handle,
            stop: None,
        }
    }

    /// Test-only bounded cleanup after an intentionally missing successor.
    /// No request is manufactured and ordinary finish remains strict.
    pub(crate) fn stop_and_finish(self) -> Vec<CapturedRequest> {
        self.stop
            .as_ref()
            .expect("observed server has a stop handle")
            .store(true, std::sync::atomic::Ordering::Release);
        self.handle.join().expect("scripted HTTP server thread")
    }

    pub(crate) fn finish(self) -> Vec<CapturedRequest> {
        self.handle.join().expect("scripted HTTP server thread")
    }
}

fn read_request(stream: &mut TcpStream) -> CapturedRequest {
    stream
        .set_nonblocking(false)
        .expect("make scripted HTTP request blocking");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set scripted HTTP request timeout");
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).expect("read scripted HTTP request");
        assert!(read > 0, "scripted HTTP request ended before headers");
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            break position;
        }
        assert!(bytes.len() < 64 * 1024, "scripted HTTP headers too large");
    };

    let header_text = std::str::from_utf8(&bytes[..header_end]).expect("HTTP headers are UTF-8");
    let mut lines = header_text.lines();
    let request_line = lines.next().expect("HTTP request line");
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().expect("HTTP method").to_string();
    let path = request_parts.next().expect("HTTP path").to_string();
    let mut headers = BTreeMap::new();
    let mut header_counts = BTreeMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').expect("valid HTTP header");
        let name = name.to_ascii_lowercase();
        *header_counts.entry(name.clone()).or_insert(0) += 1;
        headers.insert(name, value.trim().to_string());
    }
    let content_length = headers
        .get("content-length")
        .map(|value| value.parse::<usize>().expect("numeric Content-Length"))
        .unwrap_or(0);
    let body_start = header_end + 4;
    while bytes.len() < body_start + content_length {
        let read = stream
            .read(&mut chunk)
            .expect("read scripted HTTP request body");
        assert!(read > 0, "scripted HTTP request body ended early");
        bytes.extend_from_slice(&chunk[..read]);
    }

    CapturedRequest {
        method,
        path,
        headers,
        header_counts,
        body: bytes[body_start..body_start + content_length].to_vec(),
    }
}

fn write_response(stream: &mut TcpStream, response: &ScriptedResponse) {
    let extra_headers = response
        .headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    let wire = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\n{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
        response.status,
        extra_headers,
        response.body.len(),
        response.body
    );
    if let Err(error) = stream.write_all(wire.as_bytes()) {
        if matches!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
        ) {
            return;
        }
        panic!("write scripted HTTP response: {error}");
    }
    if let Err(error) = stream.flush() {
        if !matches!(
            error.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
        ) {
            panic!("flush scripted HTTP response: {error}");
        }
    }
}

#[cfg(test)]
mod armed_response_tests {
    use super::*;

    #[test]
    fn a_queued_request_waits_for_the_explicit_response_budget() {
        let (server, arm) = ScriptedServer::start_observed_armed(
            vec![ScriptedResponse::json("200 OK", "{}")],
            |_, _| {},
        );
        let mut stream = TcpStream::connect(server.base_url.trim_start_matches("http://")).unwrap();
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        stream.set_nonblocking(true).unwrap();
        assert_eq!(
            stream.read(&mut [0u8; 1]).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        arm.send(Instant::now() + Duration::from_secs(5)).unwrap();
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert_eq!(server.finish().len(), 1);
    }

    #[test]
    fn an_expired_original_response_budget_accepts_no_request() {
        let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (server, arm) =
            ScriptedServer::start_observed_armed(vec![ScriptedResponse::json("200 OK", "{}")], {
                let requests = requests.clone();
                move |_, _| {
                    requests.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            });
        arm.send(Instant::now() - Duration::from_secs(1)).unwrap();
        assert!(server.handle.join().is_err());
        assert_eq!(requests.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
