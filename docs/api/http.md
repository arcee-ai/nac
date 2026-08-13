# HTTP API

The HTTP contract is generated from the Rust handlers and types in the running `nac-web` process. To review the current state of the aPI, start the server, then use the live docs:

```sh
nac-web
```

With the default bind, that is [http://127.0.0.1:3210/docs](http://127.0.0.1:3210/docs) for the embedded Swagger UI and [http://127.0.0.1:3210/openapi.json](http://127.0.0.1:3210/openapi.json) for the OpenAPI 3.1 document (`GET /docs` and `GET /openapi.json` on whatever host and port you chose).

## Remote access

Remote access delegates the authority of the local user to every client that
can reach nac-web. The API has no client authentication. Prefer keeping nac-web
on loopback behind a proxy or private-network service that authenticates
callers and encrypts traffic.

Direct non-loopback binding is an advanced option and requires an explicit
acknowledgement. Bind to one private interface rather than every interface:

```sh
nac-web --bind 192.168.1.20:3210 --allow-remote --no-open
```

Before doing this, use a firewall, mutually authenticated VPN policy, or
equivalent control to restrict the exact identities and devices that can reach
the port. Treat compromise of any permitted client as compromise of nac-web.
Binding to `0.0.0.0` or `[::]` is especially risky because it listens on every
interface, including interfaces added after startup.

An IP-literal `Host` cannot be changed through DNS rebinding, so it needs no
DNS-name allowlist entry. This does not authenticate the client. DNS names
remain subject to the rebinding guard; list each expected name in the
comma-separated `NAC_ALLOWED_HOSTS` environment variable. For example:

```sh
NAC_ALLOWED_HOSTS=nac.internal.example \
  nac-web --bind 192.168.1.20:3210 --allow-remote --no-open
```

nac-web also rejects cross-origin browser mutations using Fetch Metadata and
Origin headers. That protects against hostile web pages; it is not a substitute
for authenticating network clients.
