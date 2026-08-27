import http, { type IncomingMessage, type ServerResponse } from "node:http";

export type ScriptedResponse =
  | { kind: "text"; text: string; stream?: boolean }
  | {
      kind: "function_call";
      name: string;
      callId: string;
      arguments: Record<string, unknown>;
      stream?: boolean;
    }
  | { kind: "http_error"; status: number; body: string };

export type ScriptMatch = {
  token?: string;
  functionOutputCallId?: string;
  requiredTools?: string[];
  forbiddenTools?: string[];
  /** Match only after the named step was consumed, for repeated model inputs. */
  afterStep?: string;
};

export type ProviderRequest = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  matchedStep?: string;
  receivedAt: string;
};

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

export class ScriptGate {
  readonly accepted: Promise<void>;
  private readonly acceptedSignal = deferred();
  private readonly releaseSignal = deferred();

  constructor() {
    this.accepted = this.acceptedSignal.promise;
  }

  markAccepted(): void {
    this.acceptedSignal.resolve();
  }

  release(): void {
    this.releaseSignal.resolve();
  }

  waitForRelease(): Promise<void> {
    return this.releaseSignal.promise;
  }
}

type ScriptedStep = {
  id: string;
  match: ScriptMatch;
  response: ScriptedResponse;
  gate?: ScriptGate;
  consumed: boolean;
};

export class ScriptedProvider {
  private readonly server = http.createServer((request, response) => {
    void this.handle(request, response);
  });
  private readonly steps: ScriptedStep[] = [];
  private readonly requestWaiters = new Set<() => void>();
  readonly requests: ProviderRequest[] = [];
  baseUrl = "";

  enqueue(id: string, match: ScriptMatch, response: ScriptedResponse, gate?: ScriptGate): void {
    this.steps.push({ id, match, response, gate, consumed: false });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (address == null || typeof address === "string") {
      throw new Error("scripted provider did not bind a TCP address");
    }
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    for (const step of this.steps) step.gate?.release();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  async waitForRequestCount(count: number, timeoutMs = 10_000): Promise<void> {
    if (this.requests.length >= count) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestWaiters.delete(onRequest);
        reject(new Error(`expected ${count} provider requests, saw ${this.requests.length}`));
      }, timeoutMs);
      const onRequest = () => {
        if (this.requests.length < count) return;
        clearTimeout(timeout);
        this.requestWaiters.delete(onRequest);
        resolve();
      };
      this.requestWaiters.add(onRequest);
    });
  }

  assertConsumed(): void {
    const pending = this.steps.filter((step) => !step.consumed).map((step) => step.id);
    if (pending.length > 0) {
      throw new Error(`unconsumed scripted provider steps: ${pending.join(", ")}`);
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const path = request.url ?? "/";
    if (method === "GET" && path === "/models") {
      this.writeJson(response, 200, {
        object: "list",
        data: [{ id: "gpt-5.6-sol", object: "model", owned_by: "nac-e2e" }],
      });
      return;
    }
    if (method === "GET" && path.startsWith("/models-dev")) {
      response.writeHead(304).end();
      return;
    }
    if (method !== "POST" || path !== "/responses") {
      this.writeJson(response, 404, { error: `unexpected provider route ${method} ${path}` });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await this.readBody(request));
    } catch (error) {
      this.writeJson(response, 400, { error: `invalid JSON: ${String(error)}` });
      return;
    }
    const matching = this.steps.filter((step) => !step.consumed && this.matches(step.match, body));
    const record: ProviderRequest = {
      method,
      path,
      headers: request.headers,
      body,
      receivedAt: new Date().toISOString(),
    };
    this.requests.push(record);
    for (const waiter of this.requestWaiters) waiter();
    if (matching.length !== 1) {
      this.writeJson(response, 400, {
        error: `expected exactly one script match, found ${matching.length}`,
      });
      return;
    }

    const step = matching[0];
    step.consumed = true;
    record.matchedStep = step.id;
    step.gate?.markAccepted();
    // A barrier models a slow model, not an unreachable one. Flush SSE
    // headers before waiting so the production client does not classify the
    // deliberate body delay as a connection failure and retry the request.
    if (step.gate != null && step.response.kind !== "http_error" && step.response.stream === true) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.flushHeaders();
    }
    if (step.gate != null) await step.gate.waitForRelease();
    this.respond(response, step.response);
  }

  private matches(match: ScriptMatch, body: unknown): boolean {
    if (
      match.afterStep != null &&
      !this.steps.some((step) => step.id === match.afterStep && step.consumed)
    ) {
      return false;
    }
    const serialized = JSON.stringify(body);
    if (match.token != null && !serialized.includes(match.token)) return false;
    if (
      match.functionOutputCallId != null &&
      !serialized.includes(`"call_id":"${match.functionOutputCallId}"`)
    ) {
      return false;
    }
    if (match.requiredTools != null) {
      const tools = this.asRecord(body)?.tools;
      const toolNames = new Set(
        tools instanceof Array
          ? tools
              .map((tool) => this.asRecord(tool)?.name)
              .filter((name): name is string => typeof name === "string")
          : [],
      );
      if (match.requiredTools.some((name) => !toolNames.has(name))) return false;
      if (match.forbiddenTools?.some((name) => toolNames.has(name))) return false;
    } else if (match.forbiddenTools != null) {
      const tools = this.asRecord(body)?.tools;
      const toolNames = new Set(
        tools instanceof Array
          ? tools
              .map((tool) => this.asRecord(tool)?.name)
              .filter((name): name is string => typeof name === "string")
          : [],
      );
      if (match.forbiddenTools.some((name) => toolNames.has(name))) return false;
    }
    return true;
  }

  private respond(response: ServerResponse, scripted: ScriptedResponse): void {
    if (scripted.kind === "http_error") {
      this.writeJson(response, scripted.status, { error: scripted.body });
      return;
    }
    const item =
      scripted.kind === "text"
        ? {
            id: "msg-e2e",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: scripted.text, annotations: [] }],
          }
        : {
            id: `fc-${scripted.callId}`,
            type: "function_call",
            status: "completed",
            call_id: scripted.callId,
            name: scripted.name,
            arguments: JSON.stringify(scripted.arguments),
          };
    const envelope = {
      id: "resp-e2e",
      object: "response",
      status: "completed",
      model: "gpt-5.6-sol",
      output: [item],
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    };
    if (scripted.stream === true) {
      if (!response.headersSent) {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
      }
      response.write(
        `data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({ type: "response.completed", response: envelope })}\n\n`,
      );
    } else {
      this.writeJson(response, 200, envelope);
    }
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", reject);
    });
  }

  private writeJson(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value != null
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
