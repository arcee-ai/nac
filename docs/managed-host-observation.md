# Private managed-host observation

The existing private fact-service listener additionally serves
`POST /internal/v1/managed-host-observation`. Its existing operator selection,
enrolled service peer, connection handling and shutdown owner remain required.
The ordinary native router, public OpenAPI and maintenance controller router do
not expose this operation. No new listener or trust verifier is installed.

This is metadata for the platform's existing mediated access producer. It does
not admit a user, return an access grant, expose a credential, start work or
issue a revocation epoch. ALL-121/ALL-284 owns current principal/profile/host
admission, the semantic read-only operation set, the mediated HTTP/SSE transport
and its original access lifetime. Already-Ready access does not repeat initial
import. This source addition does not qualify a deployed serving tuple.

The request uses the existing fact-service JSON/header/deadline conventions,
with a request ID matching its header and a deadline no more than 60 seconds
ahead. A deadline limits this observation only; it cannot become a session
access lifetime. The closed JSON body is:

```json
{
  "schema": "managed-host-observation.v1",
  "purpose": "managed-host-observation.v1",
  "request_id": "caller-correlation",
  "target": {
    "logical_host_id": "expected-host",
    "host_incarnation_id": "expected-incarnation"
  }
}
```

The expected target is only compared to native configuration. It is never
returned as proof. The response has `schema`, `purpose`, `request_id`, `binding`,
`store_ready`, `maintenance_state`, `migration_state`, `opened_schema_version`
and `replacement_state`. `binding` is the existing `ManagedLocationBinding` data shape: `logical_host_id`,
`host_incarnation_id`, `configured_owner`, `release_id`, `product_version`,
`build_id`, `source_revision`, `build_track`, `supported_schema_version`.
It contains no filesystem paths, directory identities or secret values.
`configured_owner` is the configured label, not a verified platform principal.

`replacement_state` is `configured` before an accepted replacement is recorded,
and `accepted` only when the exact original running identity is durably present.
A different accepted identity, or disappearance of a previously accepted
identity, refuses observation. `store_ready` observes only a current migrated
store in serving state, outside recovery. It does not report full runtime Ready. The operation never invokes
filesystem-write or command readiness probes. The platform retains its actual
already-Ready host decision; it must not promote `store_ready` into that decision.
Schema observations must still be compared with the producer's qualified
client/release tuple.

The operation uses bounded read-only probe capacity. It retains the original
cross-process shared replacement guard while reading and serializing the
response, so replacement acceptance cannot cross that interval. The guard does
not escape in response bytes, and ends after response construction. The result
can become stale after emission. It is neither a continuing lease nor an
immediate revocation subscription. The platform must retain and enforce its own
currentness and cutoff for each admitted HTTP/SSE lifetime.

Stale host/incarnation returns 409; malformed shape, purpose, correlation,
headers or deadline returns 403; unavailable identity/probe capacity, stale
accepted replacement or timeout returns 503. Errors contain no supplied binding
or internal diagnostics. Unsupported/legacy configuration with no native
replacement identity refuses rather than inventing one. The existing private
upgrade-status operation remains separate and retains its audit/write behavior.
