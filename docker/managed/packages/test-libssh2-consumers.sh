#!/bin/sh
set -eu
# Benign transfers with the exact staged library/curl bytes later packaged.
# Upstream's public fixture keys are test data, never runtime credentials.
cd /work/libssh2
key=/work/libssh2/tests/key_ed25519
hostkey=/work/libssh2/tests/openssh_server/ssh_host_ed25519_key
chmod 0600 "$key" "$hostkey"
export LD_LIBRARY_PATH=/packages/libssh2/usr/lib:/packages/libcurl-openssl4/usr/lib
curl=/packages/curl/usr/bin/curl
printf 'managed-ssh-transfer-ok\n' > /work/libssh2/transfer.txt
server_pid=
cleanup() {
    if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT HUP INT TERM
for cipher in aes128-gcm@openssh.com aes128-ctr; do
    cat > /work/libssh2/consumer-sshd.conf <<EOF
ListenAddress 127.0.0.1
Port 4712
HostKey $hostkey
AuthorizedKeysFile $key.pub
StrictModes no
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
Subsystem sftp internal-sftp
Ciphers $cipher
MACs hmac-sha2-256-etm@openssh.com
PidFile /work/libssh2/consumer-sshd.pid
EOF
    /usr/sbin/sshd -D -e -f /work/libssh2/consumer-sshd.conf > /work/libssh2/consumer-sshd.log 2>&1 &
    server_pid=$!
    # Bounded startup wait also proves ordinary SSH command compatibility.
    ready=0
    for attempt in 1 2 3 4 5; do
        if ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2 -i "$key" -p 4712 root@127.0.0.1 true; then
            ready=1; break
        fi
        printf 'waiting for isolated sshd (attempt %s/5)\n' "$attempt"
        sleep 1
    done
    if [ "$ready" != 1 ]; then cat /work/libssh2/consumer-sshd.log; exit 1; fi
    for protocol in scp sftp; do
        "$curl" --fail --silent --show-error --insecure --max-time 15 \
            --key "$key" --pubkey "$key.pub" --user root \
            "$protocol://127.0.0.1:4712/work/libssh2/transfer.txt" > /work/libssh2/received.txt
        cmp /work/libssh2/transfer.txt /work/libssh2/received.txt
        "$curl" --fail --silent --show-error --insecure --max-time 15 \
            --key "$key" --pubkey "$key.pub" --user root \
            --upload-file /work/libssh2/transfer.txt "$protocol://127.0.0.1:4712/work/libssh2/upload.txt"
        cmp /work/libssh2/transfer.txt /work/libssh2/upload.txt
    done
    cleanup
    server_pid=
    printf 'exact staged libssh2/curl SSH/SFTP/SCP compatibility passed: %s\n' "$cipher"
done
