import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(webDir, "../../..");
const packageName = "@arcee-ai/nac-client-all-121";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

async function pack(destination) {
  await mkdir(destination, { recursive: true });
  const output = run(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--cache",
      path.join(temporaryDirectory, "npm-cache"),
      "--pack-destination",
      destination,
    ],
    repositoryRoot,
  );
  const reports = JSON.parse(output);
  assert.equal(reports.length, 1);
  const report = reports[0];
  const files = new Set(report.files.map((file) => file.path));
  for (const required of [
    "crates/nac-server/web/packages/nac-client/README.md",
    "crates/nac-server/web/packages/nac-client/dist/index.d.ts",
    "crates/nac-server/web/packages/nac-client/dist/index.js",
  ]) {
    assert(files.has(required), `packed artifact is missing ${required}`);
  }
  return { report, tarball: path.join(destination, report.filename) };
}

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "nac-client-package-"));
try {
  const first = await pack(path.join(temporaryDirectory, "first"));
  const second = await pack(path.join(temporaryDirectory, "second"));
  assert.equal(first.report.integrity, second.report.integrity, "npm pack output must be stable");

  const consumer = path.join(temporaryDirectory, "consumer");
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "nac-client-artifact-contract-test",
        private: true,
        type: "module",
        dependencies: { [packageName]: `file:${first.tarball}` },
      },
      null,
      2,
    )}\n`,
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(temporaryDirectory, "npm-cache"),
    ],
    consumer,
  );

  await writeFile(
    path.join(consumer, "runtime.mjs"),
    `import assert from "node:assert/strict";
import { NAC_HTTP_CLIENT_VERSION, createNacClient, createNacApi, NAC_API_SURFACE, UserTerminalConnection, UserTerminalInputPump, NAC_TERMINAL_PROTOCOL_VERSION, createExecutionConnection } from ${JSON.stringify(packageName)};

assert.equal(NAC_HTTP_CLIENT_VERSION, 1);
assert.equal(NAC_TERMINAL_PROTOCOL_VERSION, 1);
assert.equal(typeof UserTerminalConnection, "function");
assert.equal(typeof createExecutionConnection, "function");
assert.equal(typeof UserTerminalInputPump, "function");
const client = createNacClient({
  endpoint: "https://nac.example/runtime/v1",
  credentials: "omit",
  authorization: { kind: "bearer", token: "gateway-token" },
  headers: { "X-NAC-Launch": "launch-1" },
  requestId: () => "artifact-contract-request",
});
const api = createNacApi(client);
assert.equal(Object.keys(NAC_API_SURFACE).length, 156);
for (const owner of Object.values(NAC_API_SURFACE)) {
  if (owner.startsWith("api.")) assert.equal(typeof api[owner.slice(4)], "function", owner);
  if (owner.startsWith("client.")) assert.equal(typeof client[owner.slice(7)], "function", owner);
}
for (const [method, owner] of [
  ["GET /product-context", "api.getProductContext"],
  ["POST /product-destinations/resolve", "api.resolveProductDestination"],
  ["GET /sessions/{session_id}/executions/{execution_id}/input-control", "api.getTerminalInputControl"],
  ["POST /sessions/{session_id}/executions/{execution_id}/input-control", "api.transferTerminalInputControl"],
  ["POST /sessions/{session_id}/executions/{execution_id}/input", "api.inputControlledTerminal"],
]) assert.equal(NAC_API_SURFACE[method], owner);
const productCalls = [];
const productApi = createNacApi(createNacClient({
  endpoint: "https://nac.example/runtime/v1",
  credentials: "omit",
  fetch: async (url, init) => {
    productCalls.push({ url: String(url), method: init.method, body: init.body });
    return Response.json({});
  },
}));
await productApi.getProductContext("session /scope");
await productApi.resolveProductDestination({ destination: "mcp-settings", session_id: "session /scope", expected_build_id: "build" });
assert.equal(productCalls[0].url, "https://nac.example/runtime/v1/product-context?session_id=session%20%2Fscope");
assert.equal(productCalls[0].method, "GET");
assert.equal(productCalls[1].url, "https://nac.example/runtime/v1/product-destinations/resolve");
assert.equal(productCalls[1].method, "POST");
assert.deepEqual(JSON.parse(productCalls[1].body), { destination: "mcp-settings", session_id: "session /scope", expected_build_id: "build" });
assert.equal("getManagedUpgrade" in api, false);
assert.equal("startTaskLaunch" in api, false);
assert.equal(NAC_API_SURFACE["POST /task-launches"], "private:standalone Local retained task launch");
const context = await client.transport.streamContext();
assert.deepEqual(context, {
  credentials: "omit",
  headers: {
    authorization: "Bearer gateway-token",
    "x-nac-launch": "launch-1",
    "x-nac-request-id": "artifact-contract-request",
  },
  requestId: "artifact-contract-request",
});
`,
  );
  run(process.execPath, ["runtime.mjs"], consumer);

  await writeFile(
    path.join(consumer, "types.ts"),
    `import {
  createNacClient,
  createNacApi,
  type ProjectRecord,
  type SessionGoalRecord,
  type PermissionStateResponse,
  subscribeToSessionEvents,
  type CommandAdmission,
  type EventSourceFactory,
  type SessionEventEnvelope,
  UserTerminalConnection,
  UserTerminalInputPump,
  type UserTerminalRenderer,
  type UserTerminalResponse,
  type TerminalSelectionPreviewResponse,
  type TerminalSelectionSubmissionResponse,
  type ShellCommandSnapshot,
  type InputControlStatus,
  type InputDeliveryReceipt,
  type ExecutionHistoryResponse,
} from ${JSON.stringify(packageName)};

const client = createNacClient({ endpoint: "/nac", credentials: "same-origin" });
const api = createNacApi(client);
const projects: Promise<ProjectRecord> = api.createProject({ name: "typed", cwd: "/repo" });
const goal: Promise<SessionGoalRecord | null> = api.getGoal("session");
const permissions: Promise<PermissionStateResponse> = api.getPermissions("session");
const command: Promise<ShellCommandSnapshot> = api.submitShellCommand("session", { request_id: "command", command: "printf evidence" });
void command;
const history: Promise<ExecutionHistoryResponse> = api.listExecutionHistory("session");
void history;
void projects; void goal; void permissions;
const terminal: Promise<UserTerminalResponse> = api.openUserTerminal("session", { protocol_version: 1, launch_id: "launch", cols: 80, rows: 24 });
const renderer: UserTerminalRenderer = { write: async (_bytes, signal) => signal.throwIfAborted(), reset: async (_reason, signal) => signal.throwIfAborted() };
const observer = new UserTerminalConnection(api, "session", "terminal", renderer);
const input: Promise<void> = new UserTerminalInputPump(observer).send(Uint8Array.of(3));
const preview: Promise<TerminalSelectionPreviewResponse> = api.previewUserTerminalSelection("session", "terminal", { protocol_version: 1, capture_id: "capture", selected_text: "selected" });
const selection: Promise<TerminalSelectionSubmissionResponse> = api.submitUserTerminalSelection("session", "terminal", {protocol_version: 1, admission_id: "admission", capture_id: "capture", expected_owner_instance_id: "owner", original_selected_text: "original", expected_selection_text: "canonical", delivery: "queue"});
const control: Promise<InputControlStatus> = api.getTerminalInputControl("session", "execution");
const transfer: Promise<InputControlStatus> = api.transferTerminalInputControl("session", "execution", { protocol_version: 1, expected_revision: "9007199254740993", controller: "human", acknowledge_uncertainty: false });
const delivery: Promise<InputDeliveryReceipt> = api.inputControlledTerminal("session", "execution", { protocol_version: 1, expected_revision: "9007199254740994", bytes: [60,82,69,84,62] });
void control; void transfer; void delivery;
// @ts-expect-error controller revisions remain decimal strings
void api.inputControlledTerminal("session", "execution", { protocol_version: 1, expected_revision: 9007199254740993, bytes: [13] });
// @ts-expect-error input ownership is a closed public vocabulary
void api.transferTerminalInputControl("session", "execution", { protocol_version: 1, expected_revision: "1", controller: "worker" });
void observer; void terminal; void input; void preview; void selection;
// @ts-expect-error byte cursors remain decimal strings
void api.pullUserTerminal("session", "terminal", "observer", { protocol_version: 1, acknowledge_offset: 9007199254740993, acknowledge_reset: false, wait_ms: 1000 });
// @ts-expect-error expected_version remains required by Rust
void api.updateGoal("session", "goal", { status: "paused" });
// @ts-expect-error immutable public session vocabulary
void api.createSession({ behavior: "worker" });
const adapter: EventSourceFactory = (_url, _init, context) => {
  context.headers satisfies Readonly<Record<string, string>>;
  return {} as EventSource;
};
const dispose = subscribeToSessionEvents(
  "session-id",
  { onEnvelope: (event: SessionEventEnvelope) => void event.sequence_id },
  { client, eventSource: adapter },
);
declare const admission: CommandAdmission<unknown>;
void admission;
dispose();
`,
  );
  const compiler = path.join(webDir, "node_modules/.bin/tsc");
  run(
    compiler,
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      "types.ts",
    ],
    consumer,
  );

  const lock = JSON.parse(await readFile(path.join(consumer, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@arcee-ai/nac-client-all-121"].version, "0.0.0-all-121");
  console.log(`verified reproducible ${packageName} artifact ${first.report.integrity}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
