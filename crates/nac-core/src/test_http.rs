//! Shared raw-HTTP test scaffolding for in-process fake servers (fake model
//! server, fake MCP server): a minimal request reader, response writer, and
//! a scripted fake chat-completions server.

use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

pub(crate) struct HttpRequest {
    pub method: String,
    pub body: Option<Value>,
}

/// Read one HTTP request (headers plus Content-Length body) from `stream`.
/// Returns `None` on read failure or connection close before a full request.
pub(crate) fn read_http_request(stream: &mut TcpStream) -> Option<HttpRequest> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..read]);
        let Some(header_end) = buf.windows(4).position(|window| window == b"\r\n\r\n") else {
            continue;
        };
        let header_text = String::from_utf8_lossy(&buf[..header_end]);
        let method = header_text
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().next())
            .unwrap_or("")
            .to_string();
        let content_length = header_text
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        let body_start = header_end + 4;
        while buf.len() < body_start + content_length {
            let read = stream.read(&mut chunk).ok()?;
            if read == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..read]);
        }
        let body = if content_length == 0 {
            None
        } else {
            serde_json::from_slice(&buf[body_start..body_start + content_length]).ok()
        };
        return Some(HttpRequest { method, body });
    }
}

pub(crate) fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: Option<&str>,
    body: &str,
) {
    let content_type = content_type
        .map(|value| format!("Content-Type: {value}\r\n"))
        .unwrap_or_default();
    let response = format!(
        "HTTP/1.1 {status}\r\n{content_type}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Minimal fake chat-completions server: serves the given JSON bodies to
/// sequential requests. Before serving the last response it optionally
/// waits for `wait_file_before_last` to exist, so a background command
/// started by a tool call is guaranteed to be running when the turn ends.
pub(crate) fn spawn_fake_model_server(
    responses: Vec<String>,
    wait_file_before_last: Option<PathBuf>,
) -> (String, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind fake model server");
    let url = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let total = responses.len();
        for (index, body) in responses.into_iter().enumerate() {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            // Drain the request (best effort) before responding.
            let _ = read_http_request(&mut stream);

            if index + 1 == total {
                if let Some(path) = &wait_file_before_last {
                    let deadline = std::time::Instant::now() + Duration::from_secs(10);
                    while !path.exists() && std::time::Instant::now() < deadline {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
            }

            write_http_response(&mut stream, "200 OK", Some("application/json"), &body);
        }
    });
    (url, handle)
}
