# Explicit managed private fact listener

Ordinary startup creates no private fact listener. A managed deployment can
explicitly select mediation with:

```sh
nac-web --managed-config /etc/nac/managed.toml \
  --managed-fact-listener-config /etc/nac/facts.json --no-open
```

The additional document is JSON with these required fields:

```json
{
  "version": 1,
  "mode": "mediated",
  "bind": "0.0.0.0:3212",
  "serving_chain_der_files": ["/etc/nac/trust/native-serving.der"],
  "serving_pkcs8_der_file": "/etc/nac/private/native-serving-key.der",
  "d_client_ca_der_file": "/etc/nac/trust/d-client-ca.der",
  "d_service_leaf_sha256": "<64 lowercase hex characters for the enrolled D leaf>"
}
```

The example pin is a placeholder and fails validation. Operators supply the
actual enrolled native serving chain, PKCS#8 DER private key, D client CA, and
current D service certificate pin. NAC never generates, enrolls, or discovers
production trust. Paths must be absolute regular files. On Unix, input files
must be owned by root or the serving user and must not be group/other writable;
the private key must have no group/other access. Leaf symlinks are refused.
Each input is bounded to 1 MiB and the serving chain to eight certificates.
Changing the configuration or pin requires restart.

The fact listener has its own address, separate from the public and managed
maintenance listeners. Startup checks the existing manager's managed identity
and readiness, validates TLS inputs, and binds all listeners before accepting a
managed replacement or reporting that the server is listening. Failed startup
does not activate a partial fact service. Migration recovery keeps the existing
diagnostic surface and creates no fact listener; restart is required after
repair.

In explicit mediated mode, the ordinary plaintext runtime listener serves only
its health/readiness probes. The separately authenticated maintenance listener
keeps its existing admission. The private fact endpoint is never mounted on
either ordinary router. Omitting the new flag preserves standalone behavior.

The private listener uses the same `SessionManager`, store, readiness owner,
and complete shutdown watchdog as the existing server. Shutdown stops public,
maintenance, and private acceptance before cancelling local runs. All HTTP/TLS
requests drain before persistence callers quiesce and the executor drains.
An unexpected private serving failure also initiates this shutdown sequence.

The only private route is `POST /internal/v1/managed-location-facts`, purpose
`working-location-facts.v1`. It requires the actual CA-verified, pinned D TLS
peer, exact current native target, one correlation header and the original
bounded `X-NAC-Expires-At-Epoch-Ms` deadline. D remains responsible for fresh
machine verification, persisted operation lookup, current resource/Ready
checks, the durable POST claim, and deadline derivation. The native receiver
accepts no forwarded product credentials or user/operation authority marker.
An HTTP filesystem fact conveys data; it creates no public reference, retained
file descriptor, lease, authorization, or mutation grant.

Native running release identity remains independent of the product registry
release ID. Deployment owners must qualify the artifact, OCI/platform digest,
current serving assignment and peer against the actual native running tuple.
This launcher does not infer registry or Kubernetes PVC identity from native
paths, stat values, or a configuration assertion.
