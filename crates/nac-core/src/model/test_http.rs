use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

pub(super) struct ScriptedResponse {
    status: &'static str,
    headers: BTreeMap<String, String>,
    body: String,
}

impl ScriptedResponse {
    pub(super) fn json(status: &'static str, body: impl Into<String>) -> Self {
        Self {
            status,
            headers: BTreeMap::new(),
            body: body.into(),
        }
    }

    pub(super) fn redirect(
        status: &'static str,
        location: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            status,
            headers: BTreeMap::from([("Location".to_string(), location.into())]),
            body: body.into(),
        }
    }
}

#[derive(Debug)]
pub(super) struct CapturedRequest {
    pub(super) method: String,
    pub(super) path: String,
    pub(super) headers: BTreeMap<String, String>,
    pub(super) body: Vec<u8>,
}

pub(super) struct ScriptedServer {
    pub(super) base_url: String,
    handle: thread::JoinHandle<Vec<CapturedRequest>>,
}

impl ScriptedServer {
    pub(super) fn start(responses: Vec<ScriptedResponse>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind scripted HTTP server");
        listener
            .set_nonblocking(true)
            .expect("set scripted HTTP listener nonblocking");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut requests = Vec::with_capacity(responses.len());
            for response in responses {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
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
                requests.push(read_request(&mut stream));
                write_response(&mut stream, &response);
            }
            requests
        });
        Self { base_url, handle }
    }

    pub(super) fn start_same_origin_redirect(
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
        Self { base_url, handle }
    }

    pub(super) fn finish(self) -> Vec<CapturedRequest> {
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
    for line in lines {
        let (name, value) = line.split_once(':').expect("valid HTTP header");
        headers.insert(name.to_ascii_lowercase(), value.trim().to_string());
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
    stream
        .write_all(wire.as_bytes())
        .expect("write scripted HTTP response");
    stream.flush().expect("flush scripted HTTP response");
}
