import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { RemoteTarget } from "./remote-config";

const execFileAsync = promisify(execFile);
const ownerCookieName = "__Host-nac_session";

export class RemoteGatewayDouble {
  readonly baseUrl: string;
  readonly wrongHostUrl: string;

  private readonly launchTicket = runtimeSecret();
  private readonly sessionCookie = runtimeSecret();
  private readonly basicUsername = runtimeSecret();
  private readonly basicPassword = runtimeSecret();
  private readonly runtimeSecrets = [
    this.launchTicket,
    this.sessionCookie,
    this.basicUsername,
    this.basicPassword,
  ];
  private launchConsumed = false;
  private launchCount = 0;
  private replayDenialCount = 0;
  private launchReferrerObserved = false;

  private constructor(
    private readonly server: https.Server,
    private readonly expectedHost: string,
    port: number,
  ) {
    this.baseUrl = `https://127.0.0.1:${port}`;
    this.wrongHostUrl = `https://localhost:${port}`;
  }

  static async start(): Promise<RemoteGatewayDouble> {
    const tlsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nac-remote-auth-"));
    const configPath = path.join(tlsRoot, "server.cnf");
    const keyPath = path.join(tlsRoot, "server-key.pem");
    const certificatePath = path.join(tlsRoot, "server.pem");
    try {
      await fs.writeFile(
        configPath,
        "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_req\n[dn]\nCN=127.0.0.1\n[v3_req]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
      );
      await execFileAsync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
        "-days",
        "1",
        "-sha256",
        "-config",
        configPath,
      ]);

      const state: { instance?: RemoteGatewayDouble } = {};
      const server = https.createServer(
        {
          key: await fs.readFile(keyPath),
          cert: await fs.readFile(certificatePath),
        },
        (request, response) => state.instance!.handle(request, response),
      );
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "::", resolve);
      });
      const address = server.address();
      if (address == null || typeof address === "string") {
        throw new Error("local remote-auth gateway did not acquire a TCP port");
      }
      const instance = new RemoteGatewayDouble(server, `127.0.0.1:${address.port}`, address.port);
      state.instance = instance;
      return instance;
    } finally {
      await fs.rm(tlsRoot, { recursive: true, force: true });
    }
  }

  portalTarget(): RemoteTarget {
    return {
      baseUrl: this.baseUrl,
      authentication: {
        mode: "portal-launch",
        launchUrl: `${this.baseUrl}/__managed/launch?ticket=${this.launchTicket}`,
      },
      environmentName: "local-gateway-double",
    };
  }

  invalidPortalTarget(): RemoteTarget {
    const invalidTicket = runtimeSecret();
    this.runtimeSecrets.push(invalidTicket);
    return {
      ...this.portalTarget(),
      authentication: {
        mode: "portal-launch",
        launchUrl: `${this.baseUrl}/__managed/launch?ticket=${invalidTicket}`,
      },
    };
  }

  basicTarget(): RemoteTarget {
    return {
      baseUrl: this.baseUrl,
      authentication: {
        mode: "basic",
        username: this.basicUsername,
        password: this.basicPassword,
      },
      environmentName: "local-gateway-double",
    };
  }

  assertSanitizedError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "portal launch redemption failed without retaining authentication details") {
      throw new Error("portal redemption did not return its fixed sanitized failure");
    }
    this.assertSecretsAbsent(message);
  }

  assertPortalExchange(): void {
    if (
      !this.launchConsumed ||
      this.launchCount !== 1 ||
      this.replayDenialCount !== 1 ||
      this.launchReferrerObserved
    ) {
      throw new Error("local gateway did not observe the bounded portal exchange contract");
    }
  }

  async assertSecretsAbsentFromFiles(root: string): Promise<void> {
    for (const file of await regularFiles(root)) {
      const contents = await fs.readFile(file);
      for (const secret of this.runtimeSecrets) {
        if (contents.includes(secret)) {
          throw new Error("runtime authentication material entered a Playwright artifact");
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error == null ? resolve() : reject(error)));
    });
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const requestUrl = new URL(request.url ?? "/", this.baseUrl);
    if (requestUrl.pathname === "/__managed/launch") {
      this.handleLaunch(request, response, requestUrl);
      return;
    }
    if (request.headers.host !== this.expectedHost || !this.authenticated(request)) {
      response.writeHead(401, {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "www-authenticate": 'Basic realm="managed-nac"',
      });
      response.end();
      return;
    }
    if (requestUrl.pathname === "/") {
      this.launchReferrerObserved ||= request.headers.referer != null;
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<!doctype html><html><head><title>NAC</title></head><body><button aria-label="Open the menu">Menu</button></body></html>',
      );
      return;
    }
    if (requestUrl.pathname === "/healthz") {
      json(response, { status: "ok" });
      return;
    }
    if (requestUrl.pathname === "/readyz") {
      json(response, { status: "ok", managed: true, ...releaseIdentity() });
      return;
    }
    if (requestUrl.pathname === "/managed/status") {
      json(response, { managed: true, ready: true, model_ready: true, ...releaseIdentity() });
      return;
    }
    response.writeHead(404).end();
  }

  private handleLaunch(request: IncomingMessage, response: ServerResponse, requestUrl: URL): void {
    const ticket = requestUrl.searchParams.get("ticket");
    if (
      request.method !== "GET" ||
      request.headers.host !== this.expectedHost ||
      ticket !== this.launchTicket ||
      this.launchConsumed
    ) {
      if (ticket === this.launchTicket && this.launchConsumed) this.replayDenialCount += 1;
      response.writeHead(401, {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      response.end();
      return;
    }
    this.launchConsumed = true;
    this.launchCount += 1;
    response.writeHead(303, {
      location: "/",
      "set-cookie": `${ownerCookieName}=${this.sessionCookie}; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Lax`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    response.end();
  }

  private authenticated(request: IncomingMessage): boolean {
    const cookies = (request.headers.cookie ?? "").split(/;\s*/);
    if (cookies.includes(`${ownerCookieName}=${this.sessionCookie}`)) return true;
    const expected = `Basic ${Buffer.from(`${this.basicUsername}:${this.basicPassword}`).toString("base64")}`;
    return request.headers.authorization === expected;
  }

  private assertSecretsAbsent(value: string): void {
    for (const secret of this.runtimeSecrets) {
      if (value.includes(secret)) {
        throw new Error("runtime authentication material entered a diagnostic");
      }
    }
  }
}

function releaseIdentity() {
  return {
    version: "0.2.0",
    schema_version: 27,
    product_version: "0.2.0",
    build_id: "beta-local-gateway-double",
    build_track: "beta",
    source_revision: "a".repeat(40),
    supported_schema_version: 27,
    minimum_migratable_schema_version: 24,
    opened_schema_version: 27,
    migration_state: "current",
    migration_failure: null,
    maintenance_state: "serving",
  };
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function runtimeSecret(): string {
  return randomBytes(32).toString("base64url");
}

async function regularFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}
