import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export type ExaDoubleRequest = {
  path: string;
  apiKey: string | undefined;
  body: unknown;
};

export class ExaDouble {
  readonly requests: ExaDoubleRequest[] = [];
  readonly hangingRequestAccepted: Promise<void>;
  readonly hangingRequestClosed: Promise<void>;
  readonly proxyUrl: string;
  readonly caCertificatePath: string;

  private readonly accepted = deferred();
  private readonly closed = deferred();
  private readonly hangingResponses = new Set<ServerResponse>();

  private constructor(
    private readonly tlsServer: https.Server,
    private readonly proxyServer: http.Server,
    proxyPort: number,
    caCertificatePath: string,
  ) {
    this.proxyUrl = `http://127.0.0.1:${proxyPort}`;
    this.caCertificatePath = caCertificatePath;
    this.hangingRequestAccepted = this.accepted.promise;
    this.hangingRequestClosed = this.closed.promise;
  }

  static async start(root: string): Promise<ExaDouble> {
    const tlsRoot = path.join(root, "exa-tls");
    await fs.mkdir(tlsRoot, { recursive: true });
    const caConfig = path.join(tlsRoot, "ca.cnf");
    const serverConfig = path.join(tlsRoot, "server.cnf");
    const caKey = path.join(tlsRoot, "ca-key.pem");
    const caCertificate = path.join(tlsRoot, "ca.pem");
    const serverKey = path.join(tlsRoot, "server-key.pem");
    const serverRequest = path.join(tlsRoot, "server.csr");
    const serverCertificate = path.join(tlsRoot, "server.pem");
    await fs.writeFile(
      caConfig,
      "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=NAC local Exa E2E CA\n[v3_ca]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\n",
    );
    await fs.writeFile(
      serverConfig,
      "[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3_req\n[dn]\nCN=api.exa.ai\n[v3_req]\nsubjectAltName=DNS:api.exa.ai\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
    );
    await execFileAsync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      caKey,
      "-out",
      caCertificate,
      "-days",
      "1",
      "-sha256",
      "-config",
      caConfig,
    ]);
    await execFileAsync("openssl", [
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      serverKey,
      "-out",
      serverRequest,
      "-config",
      serverConfig,
    ]);
    await execFileAsync("openssl", [
      "x509",
      "-req",
      "-in",
      serverRequest,
      "-CA",
      caCertificate,
      "-CAkey",
      caKey,
      "-CAcreateserial",
      "-out",
      serverCertificate,
      "-days",
      "1",
      "-sha256",
      "-extfile",
      serverConfig,
      "-extensions",
      "v3_req",
    ]);

    const state: { instance?: ExaDouble } = {};
    const tlsServer = https.createServer(
      {
        key: await fs.readFile(serverKey),
        cert: await fs.readFile(serverCertificate),
      },
      (request, response) => {
        void state.instance!.handle(request, response);
      },
    );
    await listen(tlsServer);
    const tlsPort = addressPort(tlsServer);

    const proxyServer = http.createServer((_request, response) => {
      response.writeHead(400).end();
    });
    proxyServer.on("connect", (request, client, head) => {
      if (request.url !== "api.exa.ai:443") {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const upstream = net.connect(tlsPort, "127.0.0.1");
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.once("error", () => client.destroy());
      client.once("error", () => upstream.destroy());
    });
    await listen(proxyServer);
    const instance = new ExaDouble(tlsServer, proxyServer, addressPort(proxyServer), caCertificate);
    state.instance = instance;
    await Promise.all([
      fs.rm(caKey, { force: true }),
      fs.rm(serverRequest, { force: true }),
      fs.rm(serverKey, { force: true }),
      fs.rm(serverCertificate, { force: true }),
      fs.rm(path.join(tlsRoot, "ca.srl"), { force: true }),
      fs.rm(`${caCertificate}.srl`, { force: true }),
      fs.rm(caConfig, { force: true }),
      fs.rm(serverConfig, { force: true }),
    ]);
    return instance;
  }

  async waitForRequestCount(count: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (this.requests.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.requests.length < count) {
      throw new Error(`timed out waiting for ${count} Exa requests; saw ${this.requests.length}`);
    }
  }

  async stop(): Promise<void> {
    for (const response of this.hangingResponses) response.destroy();
    this.hangingResponses.clear();
    this.tlsServer.closeAllConnections();
    this.proxyServer.closeAllConnections();
    await Promise.all([close(this.tlsServer), close(this.proxyServer)]);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400).end();
      return;
    }
    const apiKey = headerValue(request.headers["x-api-key"]);
    this.requests.push({ path: request.url ?? "", apiKey, body });

    if (request.url === "/search" && hasString(body, "query", "E2E_HANGING_EXA")) {
      this.hangingResponses.add(response);
      this.accepted.resolve();
      response.on("close", () => {
        this.hangingResponses.delete(response);
        this.closed.resolve();
      });
      return;
    }
    if (request.url === "/search" && hasString(body, "query", "E2E_MALFORMED_EXA")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"results":[');
      return;
    }
    if (request.url === "/search") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          autopromptString: "local TLS Exa double",
          results: [
            {
              url: "https://www.rust-lang.org/learn?provider-detail=removed",
              title: `Search result ${apiKey ?? "missing-key"}`,
              highlights: ["Bounded search result from the local TLS double"],
              score: 0.95,
            },
          ],
        }),
      );
      return;
    }
    if (request.url === "/contents") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          results: [
            {
              url: "https://www.rust-lang.org/learn?provider-detail=removed",
              title: "Fetched result",
              text: `Fetched through local TLS. Credential ${apiKey ?? "missing-key"}`,
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404).end();
  }
}

function hasString(body: unknown, key: string, expected: string): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    key in body &&
    (body as Record<string, unknown>)[key] === expected
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function listen(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function addressPort(server: net.Server): number {
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("server has no TCP address");
  return address.port;
}

async function close(server: net.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error == null ? resolve() : reject(error)));
  });
}
