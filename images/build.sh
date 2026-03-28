#!/bin/bash
set -e
cargo build --release -p nac --target x86_64-unknown-linux-gnu
cp target/x86_64-unknown-linux-gnu/release/nac images/nac

for variant in base python; do
  podman build -t nac:$variant -f images/Dockerfile.$variant images/
done

rm images/nac
echo "Built: nac:base nac:python"
