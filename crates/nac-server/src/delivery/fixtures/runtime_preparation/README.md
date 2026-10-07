# Frozen canonical preparation fixtures

`vectors.compact.json` is a verbatim B-owned generated companion from local
`arcee-ai/ArceeFM` commit `b9a0e1fa6cdcae0d0c8deebc09ff29d5c4e0ab26`, path
`docs/clerk/managed-runtime-preparation-v1-vectors.compact.json`. SHA256:
`00b1f67e11494409c5e238cd4eecdfcbab4b4e8bba9775be8703ade0cd9cbe70`.

Only B's `local-scripts/clerk-runtime-preparation-v1/generate_vectors.py` writes
values and canonical payloads. Native freezes exact output without regenerating
or reformatting it, verifies its hash and all 88 positive/negative vectors, and
independently implements byte/digest/comparison behavior. No external checkout
or implementation is imported as a build input.

These pure fixture comparisons establish no TLS purpose, fresh product policy,
nonce consumption, operation reservation, channel liveness or execution grant.
Keep this held-wire-derived slice LOCAL until the coordinator confirms actual
upstream publication clearance. Local parity is not final B review or activation.
