use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn read_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut expected_len = None;
    loop {
        let read = stream.read(&mut chunk).unwrap();
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if expected_len.is_none() {
            if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::parse::<usize>)
                    })
                    .transpose()
                    .unwrap()
                    .unwrap_or_default();
                expected_len = Some(header_end + 4 + content_length);
            }
        }
        if expected_len.is_some_and(|length| request.len() >= length) {
            break;
        }
    }
    String::from_utf8(request).unwrap()
}

fn spawn_server(responses: Vec<String>) -> (String, Receiver<String>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let (requests_tx, requests_rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        for response in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = requests_tx.send(read_request(&mut stream));
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    (endpoint, requests_rx, handle)
}

fn nac_command() -> Command {
    Command::new(env!("CARGO_BIN_EXE_nac"))
}

#[test]
fn stdin_json_mode_preserves_machine_readable_streams() {
    let create = response(
        "201 Created",
        r#"{"metadata":{"session_id":"integration-session"}}"#,
    );
    let run = response(
        "202 Accepted",
        r#"{"run_id":"integration-run","client_id":null,"display_prompt":"hello from stdin\n"}"#,
    );
    let (endpoint, requests, server) = spawn_server(vec![create, run]);
    let endpoint = format!("{endpoint}/proxy");

    let mut child = nac_command()
        .args(["--stdin", "--json", "--nac-endpoint", &endpoint])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"hello from stdin\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    server.join().unwrap();

    assert_eq!(
        output.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["session_id"], "integration-session");
    assert_eq!(json["run_id"], "integration-run");
    assert_eq!(json["display_prompt"], "hello from stdin\n");

    let create_request = requests.recv().unwrap();
    let run_request = requests.recv().unwrap();
    assert!(create_request.starts_with("POST /proxy/sessions HTTP/1.1"));
    assert!(run_request.starts_with("POST /proxy/sessions/integration-session/runs HTTP/1.1"));
    assert!(run_request.contains(r#""prompt":"hello from stdin\n""#));
}

#[test]
fn usage_server_and_malformed_errors_use_documented_exit_codes() {
    let usage = nac_command()
        .args(["hello", "--nac-endpoint", "ftp://example.com"])
        .output()
        .unwrap();
    assert_eq!(usage.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&usage.stderr).contains("invalid --nac-endpoint"));

    let (server_endpoint, _, server) = spawn_server(vec![response(
        "500 Internal Server Error",
        r#"{"error":"boom"}"#,
    )]);
    let server_error = nac_command()
        .args(["hello", "--nac-endpoint", &server_endpoint])
        .output()
        .unwrap();
    server.join().unwrap();
    assert_eq!(server_error.status.code(), Some(3));
    assert!(String::from_utf8_lossy(&server_error.stderr).contains("HTTP 500"));

    let (malformed_endpoint, _, server) = spawn_server(vec![response("201 Created", "not json")]);
    let malformed = nac_command()
        .args(["hello", "--nac-endpoint", &malformed_endpoint])
        .output()
        .unwrap();
    server.join().unwrap();
    assert_eq!(malformed.status.code(), Some(4));
    assert!(String::from_utf8_lossy(&malformed.stderr).contains("malformed response"));
}
