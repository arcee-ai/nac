# Initial-import compatibility vectors

These expired public-synthetic fixtures were emitted by Root from ArceeFM
commit `138724cc5a980a3ab2d62b11b7f48b396df40562`, tree
`130f979f0dbe9f36d1ff4461ff3a05f4870de650`. The generator file at that commit
was independently read and hashed before adoption; its SHA-256 matches
`provenance.json`. No producer implementation is copied into NAC.

`root-synthetic-vectors.json` is the exact generated output, SHA-256
`10b6889e62e7fd0b37c5c3726cd641ae2238ff5c18c50b17f6df8aa1ee693022`.
Its sole writer is Root's ignored
`managed_import_v2_root_synthetic_vector_emitter` test in the adopted
`afm-adapters` source. Regenerate there, verify the receiving contract and
provenance, and replace this file byte-for-byte; do not edit proof claims or
signatures manually. The fixture uses the public RFC 8032 Ed25519 test key and
its explicit historical clock. It contains no deployment credential.

The eight tokens qualify signer/verifier signature bytes, ordered claims,
phase roles, nonce and digest links, and delegated-subject representation.
They do not establish a real current-primary issue/consume transaction,
enrolled TLS channel, private import, Ready/runtime authority or acceptance.
