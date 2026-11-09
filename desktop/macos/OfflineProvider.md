# Supported local-provider offline qualification

`offline-api-key` is a separate `PREVIEW_SMOKE` scenario in the canonical
`smoke-build` app. It uses the ordinary production Rust engine, embedded web
client, configuration/credential owners and Responses transport. It does not use
the restricted `native-auth-fixture-v1` engine or alter normal app source lists.

This fixture is source preparation until its exact clean candidate/build has
passed a separately admitted hosted episode. It is not evidence that a current
PR, the whole Native stack, or an arbitrary provider works offline.

The existing loopback `FixtureProvider` never forwards requests. This scenario
adds bounded canary/rejection accounting and requires the expected dummy API
key on model/response requests. It refuses missing/wrong keys and records only
counts, never credentials, headers or arbitrary destinations. The initial
project has a selected disposable working directory but no seeded model/key;
the production provider setup form saves the configuration and credential.

Three different networking owners are measured:

- The fresh product `WKWebsiteDataStore` receives a public proxy configuration
  before its first network load, with direct failover disabled. Bridge-free
  probe views share that exact store; a separate baseline store is never used
  by the product. Product CSP/delegate refusal cannot stand in for a matched
  proxy rejection.
- The actual native bootstrap `URLSession` receives its own configuration.
  Native readiness remains restricted to the verified literal loopback origin
  without redirects.
- The ordinary Rust child's HTTP(S) clients receive exact child-only proxy
  variables. The Rust negative sends a real Responses prompt through the
  selected ordinary provider; a generic helper client is insufficient.

Only literal `127.0.0.1` bypasses the proxy. An owned `localhost` endpoint is
reachable in separate baseline controls, but must be rejected through the
fenced clients. HTTPS controls require observed CONNECT rejection; DNS failure
alone is not evidence. Fresh nonce labels, exact receipts and repeated controls
after reload prevent cache/error-only successes. The policy is never hot-swapped
or retried without its fence. Any external opener attempt is recorded and
refused before `NSWorkspace`, and fails qualification.

The positive journey uses the real configuration form, Create chat, streaming
response and persistent transcript/configuration readback after reload. Every
continuation checks the ready engine, current document/view/launch and store.
Normal exact-owned stop/reap and private-profile cleanup remain required; unknown
custody retains evidence rather than authorizing deletion.

The declared result concerns HTTP(S) used by this one supported local workflow.
It does not establish whole-machine network isolation, DNS silence, arbitrary
raw sockets/tools/SSH/Podman, real-vendor authentication or inference, signing,
minimum-OS behavior or trusted physical input. It grants no product offline
mode, new permission, backend selection or native bridge operation.

After source review and separate runtime admission, the existing hosted
controller may build the exact clean source using `preview.sh smoke-build` and
call `offline_provider_smoke.py APP OUTPUT --console-observer OBSERVER` under its
original action/cleanup clocks. The driver requires source-bound ordinary build
receipts and the isolated hosted-console contract. It does not configure host
network settings or launch a new browser. `fixture60` in the separate AppKit CI
lane remains a whole-stack readiness gate; this distinct qualification does not
waive or extend it. No runtime is implied by compiling or testing these sources.
