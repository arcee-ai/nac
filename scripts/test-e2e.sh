#!/bin/bash
set -e

echo "=== Prerequisites ==="
command -v podman >/dev/null || { echo "podman not found"; exit 1; }
command -v curl >/dev/null || { echo "curl not found"; exit 1; }
[ -n "$OPENAI_API_KEY" ] || { echo "OPENAI_API_KEY not set"; exit 1; }

echo "=== Building ==="
cargo build --workspace --release

echo "=== Building test image ==="
cp target/release/nac images/nac
podman build -t nac:base -f images/Dockerfile.base images/
rm images/nac

echo "=== Starting nacserver ==="
NAC_PORT=3123 ./target/release/nacserver &
SERVER_PID=$!
sleep 2
trap "kill $SERVER_PID 2>/dev/null; exit" EXIT

echo "=== Health check ==="
curl -sf http://localhost:3123/health | jq .

echo "=== Creating session ==="
SESSION=$(curl -sf -X POST http://localhost:3123/sessions \
  -H "Content-Type: application/json" \
  -d '{"image": "nac:base"}' | jq -r '.session_id')
echo "Session: $SESSION"

echo "=== Sending message ==="
curl -sf -X POST "http://localhost:3123/sessions/$SESSION/message" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a file called /workspace/hello.txt containing hello from nac"}' | jq .

echo "=== Verifying file was created ==="
podman exec "nac-${SESSION:0:8}" cat /workspace/hello.txt

echo "=== Deleting session ==="
curl -sf -X DELETE "http://localhost:3123/sessions/$SESSION"

echo "=== PASS ==="
