use std::{io::{Read, Write}, os::{fd::FromRawFd, unix::net::UnixStream}};
fn main() {
    // Exact adapter used by desktop_launch.rs; pipe(2) is not sufficient.
    let mut channel = unsafe { UnixStream::from_raw_fd(3) };
    channel.peer_addr().expect("connected Unix socket");
    channel.write_all(b"connected\n").unwrap();
    let mut received=Vec::new();
    channel.read_to_end(&mut received).unwrap();
    std::fs::write(std::env::args().nth(1).unwrap(),received).unwrap();
}
