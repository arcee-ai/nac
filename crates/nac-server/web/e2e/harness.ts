import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { ExaDouble } from "./exa-double";
import { ScriptedProvider } from "./scripted-provider";

type SessionBehavior = "orchestrator" | "direct" | "direct-with-orchestrator";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "../../../..");
const cleanupMarkers = new WeakMap<ChildProcess, string>();
const cleanupMarkerEnvironment = "NAC_E2E_CLEANUP_ID";
const execute = promisify(execFile);

/** Keep production snapshots inside this fixture, even when Playwright's output
 * directory is nested in the source checkout. Restarts preserve owned changes.
 */
export async function initializeHarnessWorkspace(workspace: string): Promise<void> {
  await fs.mkdir(workspace, { recursive: true });
  const git = (...args: string[]) => execute("git", ["-C", workspace, ...args]);
  await git("init", "--quiet", "--initial-branch=main");
  const { stdout } = await git("rev-parse", "--show-toplevel");
  if ((await fs.realpath(stdout.trim())) !== (await fs.realpath(workspace))) {
    throw new Error("E2E workspace must own its Git repository boundary");
  }
  try {
    await git("rev-parse", "--verify", "HEAD");
  } catch {
    await git(
      "-c",
      "user.name=Disposable NAC fixture",
      "-c",
      "user.email=nac-fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "fixture baseline",
    );
  }
}

export type EmbeddedHarness = {
  baseUrl: string;
  binaryPath: string;
  exa: ExaDouble | undefined;
  output: string[];
  provider: ScriptedProvider;
  runRoot: string;
  waitForNoWorkerProcesses: () => Promise<void>;
  restart: (
    orchestration: string | null,
    nativeCredential?: string | null,
    preserveOrigin?: boolean,
  ) => Promise<void>;
};

type RunningHarness = Omit<EmbeddedHarness, "restart"> & {
  stopServer: () => Promise<void>;
  server: ChildProcess;
  output: string[];
  stop: () => Promise<void>;
};

type Fixtures = {
  harness: EmbeddedHarness;
  browserDiagnostics: void;
};

type Options = {
  exaCredential: string | undefined;
  orchestration: string | null;
  /** Extra server environment for fixture-only builds, such as a scripted reviewer. */
  serverEnvironment: Record<string, string>;
  managedNativeWeb: boolean;
  codexCatalogFixture: boolean;
};

export const test = base.extend<Fixtures & Options>({
  exaCredential: [undefined, { option: true }],
  orchestration: ["1", { option: true }],
  serverEnvironment: [{}, { option: true }],
  managedNativeWeb: [true, { option: true }],
  codexCatalogFixture: [false, { option: true }],
  harness: async (
    {
      request,
      exaCredential,
      orchestration,
      serverEnvironment,
      managedNativeWeb,
      codexCatalogFixture,
    },
    use,
    testInfo,
  ) => {
    void request;
    let running = await startHarness(
      testInfo,
      exaCredential,
      orchestration,
      serverEnvironment,
      undefined,
      managedNativeWeb,
      undefined,
      undefined,
      codexCatalogFixture,
    );
    const harness: EmbeddedHarness = {
      ...running,
      restart: async (nextGate, nativeCredential, preserveOrigin = false) => {
        const previousOutput = running.output;
        await running.stopServer();
        running = await startHarness(
          testInfo,
          nativeCredential === undefined ? exaCredential : (nativeCredential ?? undefined),
          nextGate,
          serverEnvironment,
          running.provider,
          managedNativeWeb,
          running.exa,
          preserveOrigin ? new URL(running.baseUrl).host : undefined,
          codexCatalogFixture,
        );
        running.output.unshift(...previousOutput);
        Object.assign(harness, running);
      },
    };
    let useError: unknown;
    try {
      await use(harness);
    } catch (error) {
      useError = error;
    }
    let cleanupError: unknown;
    try {
      await running.stop();
    } catch (error) {
      cleanupError = error;
    }
    const serverLog = path.join(running.runRoot, "nac-web.log");
    const providerLog = path.join(running.runRoot, "provider-requests.json");
    const diagnosticFailures: unknown[] = [];
    const writes = await Promise.allSettled([
      fs.writeFile(serverLog, running.output.join("")),
      fs.writeFile(
        providerLog,
        JSON.stringify(
          running.provider.requests.map((entry) => ({
            ...entry,
            headers: redactHeaders(entry.headers),
          })),
          null,
          2,
        ),
      ),
    ]);
    diagnosticFailures.push(
      ...writes
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
    );
    const failed = testInfo.status !== testInfo.expectedStatus || useError !== undefined;
    if (failed) {
      const attachments = await Promise.allSettled([
        attachIfPresent(testInfo, "nac-web log", serverLog, "text/plain"),
        attachIfPresent(testInfo, "scripted provider journal", providerLog, "application/json"),
        attachIfPresent(
          testInfo,
          "isolated SQLite store",
          path.join(running.runRoot, "store.db"),
          "application/vnd.sqlite3",
        ),
        attachIfPresent(
          testInfo,
          "process status",
          path.join(running.runRoot, "process.json"),
          "application/json",
        ),
      ]);
      diagnosticFailures.push(
        ...attachments
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason),
      );
    } else if (process.env.KEEP_E2E !== "1") {
      try {
        await fs.rm(running.runRoot, { recursive: true, force: true });
      } catch (error) {
        diagnosticFailures.push(error);
      }
    }
    const failures = [useError, cleanupError, ...diagnosticFailures].filter(
      (error) => error !== undefined,
    );
    if (failures.length > 1) {
      throw new AggregateError(failures, "E2E test, cleanup, or diagnostics failed");
    }
    if (failures.length === 1) throw failures[0];
  },
  browserDiagnostics: [
    async ({ harness, page }, use, testInfo) => {
      const events: Array<Record<string, unknown>> = [];
      page.on("console", (message) => {
        events.push({ kind: "console", type: message.type(), text: message.text() });
      });
      page.on("pageerror", (error) => {
        events.push({ kind: "pageerror", message: error.message, stack: error.stack });
      });
      page.on("requestfailed", (request) => {
        events.push({
          kind: "requestfailed",
          method: request.method(),
          url: request.url(),
          error: request.failure()?.errorText,
        });
      });
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;

      const consoleLog = path.join(harness.runRoot, "browser-events.json");
      const domSnapshot = path.join(harness.runRoot, "page.html");
      await fs.writeFile(consoleLog, JSON.stringify(events, null, 2));
      await fs.writeFile(domSnapshot, await page.content());
      await testInfo.attach("browser console and request failures", {
        path: consoleLog,
        contentType: "application/json",
      });
      await testInfo.attach("DOM snapshot", { path: domSnapshot, contentType: "text/html" });
    },
    { auto: true },
  ],
});

export { expect };

export async function createDirectSession(
  request: APIRequestContext,
  harness: EmbeddedHarness,
): Promise<string> {
  return createSession(request, harness, "direct");
}

export async function createSession(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  behavior: SessionBehavior,
  projectId?: string,
): Promise<string> {
  const response = await request.post(`${harness.baseUrl}/sessions`, {
    data:
      projectId == null
        ? {
            behavior,
            cwd: path.join(harness.runRoot, "workspace"),
            backend: "openai-responses",
            model: "gpt-5.6-sol",
            base_url: harness.provider.baseUrl,
            reasoning_effort: "high",
            api_key_env: "NAC_E2E_API_KEY",
            extra_headers: {},
            orchestrator_compaction_threshold: 0,
          }
        : { behavior, project_id: projectId },
  });
  if (!response.ok()) {
    throw new Error(`session creation failed (${response.status()}): ${await response.text()}`);
  }
  const body = (await response.json()) as { metadata?: { session_id?: string } };
  const sessionId = body.metadata?.session_id;
  if (sessionId == null || sessionId === "") {
    throw new Error(`session creation returned no id: ${JSON.stringify(body)}`);
  }
  return sessionId;
}

export async function createProject(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  options: {
    name?: string;
    cwd?: string;
    lightModel?: {
      model: string;
      backend: "openai-responses";
      base_url: string;
      api_key_env: string;
      reasoning_effort: "low";
    };
  } = {},
): Promise<string> {
  const cwd = options.cwd ?? path.join(harness.runRoot, "workspace");
  await fs.mkdir(cwd, { recursive: true });
  const configuration = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: options.name ? `${options.name} scripted provider` : "E2E scripted provider",
      backend: "openai-responses",
      model: "gpt-5.6-sol",
      base_url: harness.provider.baseUrl,
      api_key: "nac-e2e-dummy-only",
      reasoning_effort: "high",
      extra_headers: {},
      orchestrator_compaction_threshold: 0,
      light_model: options.lightModel,
    },
  });
  if (!configuration.ok()) {
    throw new Error(
      `model configuration creation failed (${configuration.status()}): ${await configuration.text()}`,
    );
  }
  const configId = ((await configuration.json()) as { config_id?: string }).config_id;
  if (!configId) throw new Error("model configuration creation returned no id");

  const project = await request.post(`${harness.baseUrl}/projects`, {
    data: {
      name: options.name ?? "Embedded E2E project",
      cwd,
      default_model_config_id: configId,
    },
  });
  if (!project.ok()) {
    throw new Error(`project creation failed (${project.status()}): ${await project.text()}`);
  }
  const projectId = ((await project.json()) as { project_id?: string }).project_id;
  if (!projectId) throw new Error("project creation returned no id");
  return projectId;
}

export async function waitForRunIdle(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  sessionId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}`);
        if (!response.ok()) return `http-${response.status()}`;
        const body = (await response.json()) as { active_run?: unknown };
        return body.active_run == null ? "idle" : "running";
      },
      { timeout: 15_000, intervals: [25, 50, 100, 250] },
    )
    .toBe("idle");
}

async function startHarness(
  testInfo: TestInfo,
  exaCredential: string | undefined,
  orchestration: string | null,
  serverEnvironment: Record<string, string>,
  existingProvider?: ScriptedProvider,
  managedNativeWeb = true,
  existingExa?: ExaDouble,
  bindAddress = "127.0.0.1:0",
  codexCatalogFixture = false,
): Promise<RunningHarness> {
  if (process.platform === "win32") {
    throw new Error(
      "production E2E requires POSIX process groups so descendant cleanup can be verified",
    );
  }
  const runRoot = testInfo.outputPath("run");
  const workspace = path.join(runRoot, "workspace");
  const nacHome = path.join(runRoot, "nac-home");
  const home = path.join(runRoot, "home");
  const xdg = path.join(runRoot, "xdg");
  const tmp = path.join(runRoot, "tmp");
  await Promise.all(
    [runRoot, nacHome, home, xdg, tmp].map((directory) => fs.mkdir(directory, { recursive: true })),
  );
  await initializeHarnessWorkspace(workspace);
  if (codexCatalogFixture) {
    const account = "codex-e2e-account";
    const fingerprint = createHash("sha256").update(account).digest("hex");
    const catalogDir = path.join(nacHome, "model-catalog");
    await fs.mkdir(catalogDir, { recursive: true });
    const cache = {
      account_fingerprint: fingerprint,
      fetched_at_unix: Math.floor(Date.now() / 1000),
      models: [
        {
          id: "gpt-6.1-sol",
          display_name: "GPT-6.1-Sol",
          context_window: 500_000,
          max_context_window: 872_000,
          auto_compact_token_limit: null,
          image_input: true,
        },
      ],
    };
    await fs.writeFile(path.join(catalogDir, `codex-${fingerprint}.json`), JSON.stringify(cache), {
      mode: 0o600,
    });
    await fs.writeFile(
      path.join(nacHome, "auth.json"),
      JSON.stringify({
        type: "chatgpt-codex",
        access: "e2e-only",
        refresh: "e2e-only",
        expires_at_ms: 8_000_000_000_000,
        account_id: account,
      }),
      { mode: 0o600 },
    );
  }

  const binaryPath = path.resolve(
    process.env.NAC_E2E_BINARY ?? path.join(repoRoot, "target/debug/nac-web"),
  );
  await fs.access(binaryPath);
  const provider = existingProvider ?? new ScriptedProvider();
  if (!existingProvider) await provider.start();
  let exa = existingExa;
  try {
    if (exaCredential != null && exa == null) exa = await ExaDouble.start(runRoot);
  } catch (error) {
    await provider.stop();
    throw error;
  }
  const managedConfig =
    exa == null || !managedNativeWeb
      ? undefined
      : await writeManagedConfiguration(runRoot, workspace, home);
  const output: string[] = [];
  let resolveAddress!: (url: string) => void;
  let rejectAddress!: (error: Error) => void;
  const address = new Promise<string>((resolve, reject) => {
    resolveAddress = resolve;
    rejectAddress = reject;
  });
  // A focused runner can also settle detached fixtures after Playwright itself
  // is interrupted. Each harness retains a distinct suffix for normal teardown.
  const cleanupMarker = [process.env.NAC_E2E_CLEANUP_ID, randomUUID()].filter(Boolean).join("-");
  const server = spawn(
    binaryPath,
    [
      "--bind",
      bindAddress,
      "--directory",
      workspace,
      "--store-path",
      path.join(runRoot, "store.db"),
      "--worker-executable",
      binaryPath,
      ...(managedConfig == null ? [] : ["--managed-config", managedConfig]),
      "--no-open",
    ],
    {
      cwd: workspace,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        XDG_CONFIG_HOME: xdg,
        NAC_HOME: nacHome,
        TMPDIR: tmp,
        LANG: "C.UTF-8",
        BROWSER: "none",
        RUST_BACKTRACE: "1",
        ...(orchestration === null ? {} : { NAC_ORCHESTRATION: orchestration }),
        NAC_E2E_API_KEY: "nac-e2e-dummy-only",
        // Conventional selectors make two independent provider routes
        // available to the unified model picker without placing either value
        // in browser state. The scripted tests never send model traffic to
        // these public endpoints.
        OPENAI_API_KEY: "nac-e2e-openai-dummy-only",
        DEEPSEEK_API_KEY: "nac-e2e-deepseek-dummy-only",
        MODELS_DEV_URL: `${provider.baseUrl}/models-dev`,
        ...serverEnvironment,
        [cleanupMarkerEnvironment]: cleanupMarker,
        ...(exaCredential == null
          ? {}
          : {
              EXA_API_KEY: exaCredential,
            }),
        ...(exa == null
          ? {}
          : {
              NAC_E2E_EXA_CA_CERT: exa.caCertificatePath,
              NAC_E2E_EXA_HTTPS_PROXY: exa.proxyUrl,
            }),
      },
    },
  );
  cleanupMarkers.set(server, cleanupMarker);

  const parseReadiness = (chunk: Buffer, buffered: string): string => {
    const text = chunk.toString("utf8");
    output.push(text);
    const combined = buffered + text;
    for (const line of combined.split("\n").slice(0, -1)) {
      const match = line.match(/nac-web listening on (http:\/\/\S+)/);
      if (match?.[1] != null) resolveAddress(match[1].replace(/\/$/, ""));
    }
    return combined.includes("\n") ? combined.slice(combined.lastIndexOf("\n") + 1) : combined;
  };
  let stdoutBuffer = "";
  let stderrBuffer = "";
  server.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer = parseReadiness(chunk, stdoutBuffer);
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer = parseReadiness(chunk, stderrBuffer);
  });
  server.once("error", (error) => rejectAddress(error));
  server.once("exit", (code, signal) => {
    rejectAddress(new Error(`nac-web exited before readiness: code=${code} signal=${signal}`));
  });

  let baseUrl: string;
  try {
    baseUrl = await withTimeout(address, 15_000, "nac-web readiness line");
    await waitForHealth(baseUrl);
  } catch (error) {
    const cleanup = await Promise.allSettled([
      terminateProcessGroup(server),
      provider.stop(),
      ...(exa == null ? [] : [exa.stop()]),
    ]);
    const startupLog = path.join(runRoot, "nac-web.log");
    const diagnosticFailures: unknown[] = [];
    try {
      await fs.writeFile(startupLog, output.join(""));
    } catch (diagnosticError) {
      diagnosticFailures.push(diagnosticError);
    }
    try {
      await attachIfPresent(testInfo, "nac-web startup log", startupLog, "text/plain");
    } catch (diagnosticError) {
      diagnosticFailures.push(diagnosticError);
    }
    const failures = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason)
      .concat(diagnosticFailures);
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        "nac-web startup, cleanup, or diagnostics failed",
        { cause: error },
      );
    }
    throw error;
  }

  await runStartupStepWithCleanup(
    () =>
      fs.writeFile(
        path.join(runRoot, "process.json"),
        JSON.stringify(
          { pid: server.pid, binaryPath, baseUrl, provider: provider.baseUrl },
          null,
          2,
        ),
      ),
    [() => terminateProcessGroup(server), () => provider.stop()],
    "E2E startup bookkeeping",
  );
  return {
    baseUrl,
    binaryPath,
    exa,
    provider,
    runRoot,
    waitForNoWorkerProcesses: async () => {
      const pid = server.pid;
      if (pid == null) throw new Error("nac-web has no process ID");
      const deadline = Date.now() + 10_000;
      let descendants = await processDescendants(pid, cleanupMarker);
      while (descendants.length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        descendants = await processDescendants(pid, cleanupMarker);
      }
      if (descendants.length > 0) {
        throw new Error(`managed worker descendants remained after cancellation: ${descendants}`);
      }
    },
    server,
    output,
    stopServer: () => terminateProcessGroup(server),
    stop: async () => {
      const pid = server.pid;
      const cleanup = await Promise.allSettled([
        terminateProcessGroup(server),
        provider.stop(),
        ...(exa == null ? [] : [exa.stop()]),
      ]);
      const processRecord = fs.writeFile(
        path.join(runRoot, "process.json"),
        JSON.stringify(
          {
            pid,
            binaryPath,
            baseUrl,
            provider: provider.baseUrl,
            exitCode: server.exitCode,
            signalCode: server.signalCode,
          },
          null,
          2,
        ),
      );
      const failures = cleanup
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      try {
        await processRecord;
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) throw new AggregateError(failures, "E2E cleanup failed");
    },
  };
}

async function writeManagedConfiguration(
  runRoot: string,
  repositoryRoot: string,
  homeRoot: string,
): Promise<string> {
  const stateRoot = path.join(runRoot, "managed-state");
  const modelCredential = path.join(runRoot, "managed-model-key");
  const configPath = path.join(runRoot, "managed.toml");
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(modelCredential, "managed-e2e-model-key\n", { mode: 0o600 });
  const quoted = (value: string): string => JSON.stringify(value);
  await fs.writeFile(
    configPath,
    [
      "version = 1",
      'logical_host_id = "00000000-0000-4000-8000-000000000035"',
      'owner = "managed-e2e@example.test"',
      'public_hostname = "managed-e2e.example.test"',
      `repository_root = ${quoted(repositoryRoot)}`,
      `state_root = ${quoted(stateRoot)}`,
      `home_root = ${quoted(homeRoot)}`,
      'github_client_id = "Iv1.managed-e2e"',
      'model_backend = "openai-responses"',
      'model_id = "gpt-5.6-sol"',
      'model_endpoint = "https://models.example.test/v1"',
      `model_credential_file = ${quoted(modelCredential)}`,
      "",
    ].join("\n"),
  );
  return configPath;
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError = "health did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(lastError);
}

function redactHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      /authorization|api-key|cookie/i.test(name) ? "<redacted>" : value,
    ]),
  );
}

async function attachIfPresent(
  testInfo: TestInfo,
  name: string,
  file: string,
  contentType: string,
): Promise<void> {
  try {
    await fs.access(file);
    await testInfo.attach(name, { path: file, contentType });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

type TerminationTiming = {
  graceMs?: number;
  killMs?: number;
  pollMs?: number;
  marker?: string;
};

export async function terminateProcessGroup(
  child: ChildProcess,
  timing: TerminationTiming = {},
): Promise<void> {
  if (child.pid == null) return;
  if (process.platform === "win32") {
    await terminateWindowsProcessTree(child);
    return;
  }

  const pid = child.pid;
  const graceMs = timing.graceMs ?? 3_000;
  const killMs = timing.killMs ?? 3_000;
  const pollMs = timing.pollMs ?? 25;
  const marker = timing.marker ?? cleanupMarkers.get(child);
  const tracked = new Set<number>([pid, ...(await processDescendants(pid, marker))]);
  const signalGroup = (name: NodeJS.Signals): void => {
    try {
      process.kill(-pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };

  if (!processGroupExists(pid) && ![...tracked].some(processExists)) return;
  signalTrackedProcesses(tracked, "SIGTERM", signalGroup);
  try {
    await waitForTrackedProcessExit(
      pid,
      tracked,
      graceMs,
      pollMs,
      "nac-web process-tree termination",
      marker,
    );
  } catch {
    await refreshTrackedDescendants(tracked, marker);
    signalTrackedProcesses(tracked, "SIGKILL", signalGroup);
    await waitForTrackedProcessExit(
      pid,
      tracked,
      killMs,
      pollMs,
      "nac-web forced process-tree termination",
      marker,
    );
  }
}

export async function runStartupStepWithCleanup<T>(
  operation: () => Promise<T>,
  cleanups: Array<() => Promise<void>>,
  label: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const cleanup = await Promise.allSettled(cleanups.map((cleanupStep) => cleanupStep()));
    const cleanupFailures = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], `${label} and cleanup failed`, {
        cause: error,
      });
    }
    throw error;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function signalTrackedProcesses(
  tracked: Set<number>,
  signal: NodeJS.Signals,
  signalLeaderGroup: (signal: NodeJS.Signals) => void,
): void {
  signalLeaderGroup(signal);
  for (const pid of tracked) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function processTable(): Promise<Array<{ pid: number; ppid: number; command: string }>> {
  const args =
    process.platform === "darwin"
      ? ["eww", "-axo", "pid=,ppid=,command="]
      : ["eww", "-e", "-o", "pid=,ppid=,command="];
  const ps = spawn("ps", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  ps.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  ps.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    ps.once("error", reject);
    ps.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`ps failed while inspecting E2E process tree: ${stderr.trim()}`);
  return stdout
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => match != null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? "" }));
}

async function processDescendants(rootPid: number, marker?: string): Promise<number[]> {
  const table = await processTable();
  const markerText = marker == null ? undefined : `${cleanupMarkerEnvironment}=${marker}`;
  const descendants = new Set<number>(
    table
      .filter((process) => markerText != null && process.command.includes(markerText))
      .map((process) => process.pid),
  );
  descendants.delete(rootPid);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of table) {
      if (
        process.pid !== rootPid &&
        (process.ppid === rootPid || descendants.has(process.ppid)) &&
        !descendants.has(process.pid)
      ) {
        descendants.add(process.pid);
        changed = true;
      }
    }
  }
  return [...descendants];
}

async function refreshTrackedDescendants(tracked: Set<number>, marker?: string): Promise<void> {
  const table = await processTable();
  const markerText = marker == null ? undefined : `${cleanupMarkerEnvironment}=${marker}`;
  for (const process of table) {
    if (markerText != null && process.command.includes(markerText)) tracked.add(process.pid);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of table) {
      if (tracked.has(process.ppid) && !tracked.has(process.pid)) {
        tracked.add(process.pid);
        changed = true;
      }
    }
  }
}

async function waitForTrackedProcessExit(
  pid: number,
  tracked: Set<number>,
  timeoutMs: number,
  pollMs: number,
  label: string,
  marker?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    await refreshTrackedDescendants(tracked, marker);
    if (!processGroupExists(pid) && ![...tracked].some(processExists)) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

async function terminateWindowsProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return;
  const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    taskkill.once("error", reject);
    taskkill.once("exit", (code) => resolve(code));
  });
  if (exitCode !== 0 && child.exitCode == null && child.signalCode == null) {
    throw new Error(`taskkill failed for E2E process tree ${child.pid} with exit code ${exitCode}`);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

const PANEL_LABELS: Record<string, string> = {
  sessions: "Sessions",
  insights: "Insights",
  threads: "Threads",
  delegated: "Subagents",
  files: "Files",
  terminal: "Terminal",
  heartbeats: "Heartbeats",
  worksets: "Worksets",
  history: "History",
};

/** The panel the session route names (`#/session/<id>/<panel>`), as its tab label. */
function routePanelLabel(url: string): string | null {
  const match = /#\/session\/[^/?#]+\/([a-z]+)/.exec(url);
  return match ? (PANEL_LABELS[match[1]] ?? null) : null;
}

/** The app's ⌘/⌃ modifier: it follows the page's user agent, not the host OS. */
export async function appModifier(page: Page): Promise<"Meta" | "Control"> {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  return mac ? "Meta" : "Control";
}

/** Whether the page lays out as a phone (the client's `useIsMobile` breakpoint). */
export async function isPhoneLayout(page: Page): Promise<boolean> {
  return (await page.evaluate("matchMedia('(max-width: 767.98px)').matches")) === true;
}

/**
 * The drawer slides in (and docks with a width tween) a couple of frames after
 * it mounts. Geometry and hit tests must wait for the surface to come to rest
 * inside the viewport rather than read a half-entered sheet.
 */
export async function waitForPanelSettled(surface: Locator) {
  await expect
    .poll(() =>
      surface.evaluate((element) => {
        const view = element.ownerDocument.defaultView!;
        const root = element.closest('[role="dialog"], aside') ?? element;
        const rect = root.getBoundingClientRect();
        const resting = root
          .getAnimations()
          .every((animation: { playState: string }) => animation.playState !== "running");
        return (
          resting &&
          rect.width > 0 &&
          rect.left >= -1 &&
          rect.right <= view.innerWidth + 1 &&
          rect.bottom <= view.innerHeight + 1
        );
      }),
    )
    .toBe(true);
}

/**
 * Focus has no permanent right column: a session's panels live in one drawer
 * whose tabs are the "Session panels" tablist. The drawer starts closed, and a
 * saved open preference can open it after the first paint, so every attempt
 * first re-observes the tablist. Where the drawer can dock (≥1280px) the
 * documented ⌘\ docks it beside the chat on the route's own panel — the
 * equivalent of the old column, leaving the conversation usable. Narrower, the
 * header's one control, the Session menu, lists the panels: its row for the
 * route's panel opens the floating drawer on it directly; a panel the menu
 * does not list (it lists only those with something to say) is reached through
 * its Insights row and then the drawer's tab. No path ever closes an open
 * drawer. `dock: false` always takes the floating drawer — for journeys that
 * resize across the docking width, where the app moves the panel between
 * surfaces.
 */
export async function showSidePanel(page: Page, { dock = true }: { dock?: boolean } = {}) {
  const open = page.getByRole("tablist", { name: "Session panels", exact: true });
  const menu = page.getByRole("button", { name: "Session menu", exact: true });
  const details = page.getByRole("dialog", { name: "Session", exact: true });
  await expect(menu.or(open).first()).toBeVisible();
  const label = routePanelLabel(page.url());
  await expect(async () => {
    const { state, detail } = await drawerDiagnosis(open);
    // A drawer that is sliding in or out decides nothing yet.
    if (state === "moving") throw new Error(`The session drawer is still moving: ${detail}`);
    if (state === "open") return;
    const dockable =
      dock && (await page.evaluate("matchMedia('(min-width: 1280px)').matches")) === true;
    if (dockable) {
      await page.keyboard.press(`${await appModifier(page)}+Backslash`);
    } else {
      // Hydrating an open preference may detach the menu between the read and
      // click; yield to the outer retry so it can observe the open drawer.
      if (!(await details.isVisible())) await menu.click({ timeout: 1_000 });
      await expect(details).toBeVisible({ timeout: 1_000 });
      const row = sessionMenuPanel(details, label ?? "Insights");
      const direct = label != null && (await row.count()) > 0;
      await (direct ? row : sessionMenuPanel(details, "Insights")).click({ timeout: 1_000 });
      await expect(open).toBeVisible({ timeout: 2_000 });
      const tab = open.getByRole("tab", { name: label ?? "Insights", exact: true });
      if (!direct && label && label !== "Insights" && (await tab.count()) > 0)
        await tab.click({ timeout: 1_000 });
    }
    await expect.poll(() => drawerState(open), { timeout: 2_000 }).toBe("open");
  }).toPass();
}

/**
 * The Session menu's row for a panel. Rows are named by the panel, with its
 * live fact after the name ("Files +12 −3", "Subagents 2, 1 running").
 */
function sessionMenuPanel(menu: Locator, label: string): Locator {
  return menu.getByRole("button", { name: new RegExp(`^${label}(?![A-Za-z])`) }).first();
}

/**
 * Whether the drawer holding the "Session panels" tabs is open and at rest,
 * closed (unmounted), or moving. Closing keeps the drawer mounted while it
 * slides away (and a docked column shrinks to nothing), and a dock/float
 * switch briefly mounts both surfaces, so visibility of the tabs alone is not
 * an open drawer.
 */
async function drawerState(tablist: Locator): Promise<"open" | "closed" | "moving"> {
  return (await drawerDiagnosis(tablist)).state;
}

async function drawerDiagnosis(
  tablist: Locator,
): Promise<{ state: "open" | "closed" | "moving"; detail: string }> {
  const count = await tablist.count();
  if (count === 0) return { state: "closed", detail: "no tabs" };
  if (count > 1) return { state: "moving", detail: `${count} drawers mounted` };
  // Mounted but not shown is a drawer on its way out; it unmounts shortly.
  if (!(await tablist.isVisible())) return { state: "moving", detail: "tabs hidden" };
  return await tablist
    .evaluate((element) => {
      const view = element.ownerDocument.defaultView!;
      const root = element.closest('[role="dialog"], aside') ?? element;
      const running = root
        .getAnimations()
        .filter((animation: { playState: string }) => animation.playState === "running")
        .map((animation: { playState: string }) => animation.constructor.name);
      const rect = root.getBoundingClientRect();
      const detail = JSON.stringify({
        root: root.tagName,
        state: root.getAttribute("data-state"),
        running,
        rect: [rect.left, rect.right, rect.bottom, rect.width],
        viewport: [view.innerWidth, view.innerHeight],
      });
      if (running.length > 0) return { state: "moving" as const, detail };
      const resting =
        root.getAttribute("data-state") !== "closed" &&
        rect.width > 0 &&
        rect.left >= -1 &&
        rect.right <= view.innerWidth + 1 &&
        rect.bottom <= view.innerHeight + 1;
      // A mounted drawer that is not at rest in view is leaving: closing keeps
      // it mounted off-screen (or a docked column at no width) until it
      // unmounts, and only an unmounted drawer may be opened again — a second
      // ⌘\ on a live drawer would toggle its docking instead.
      return { state: resting ? ("open" as const) : ("moving" as const), detail };
    })
    .catch((error: Error) => ({ state: "moving" as const, detail: error.message }));
}

/**
 * Lets the drawer fill the window. Full width belongs to the floating drawer,
 * so a docked one (the wide default of `showSidePanel`) is floated first.
 */
export async function expandSidePanel(page: Page) {
  await showSidePanel(page);
  const float = page.getByRole("button", { name: "Float drawer", exact: true });
  if (await float.isVisible()) await float.click();
  await page.getByRole("button", { name: "Full width", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit full width", exact: true })).toBeVisible();
  await waitForPanelSettled(page.getByRole("tablist", { name: "Session panels", exact: true }));
}

/**
 * A phone has one "Open panel" button: its sheet lists the session's panels as
 * rows, and a row opens that panel as a bottom sheet (a dialog named for it).
 */
export async function showPhonePanel(page: Page, label: string) {
  const sheet = page.getByRole("dialog", { name: label, exact: true });
  if (await sheet.isVisible()) return sheet;
  // One panel sheet at a time: leave another panel before picking this one.
  for (const other of new Set(Object.values(PANEL_LABELS).concat("Goal"))) {
    const open = page.getByRole("dialog", { name: other, exact: true });
    if (other === label || !(await open.isVisible())) continue;
    await page.keyboard.press("Escape");
    await expect(open).toHaveCount(0);
  }
  const details = page.getByRole("dialog", { name: "Session", exact: true });
  if (!(await details.isVisible()))
    await page.getByRole("button", { name: "Open panel", exact: true }).click();
  // A row's name carries its count ("Subagents 2, 1 running").
  await sessionMenuPanel(details, label).click();
  await expect(sheet).toBeVisible();
  await waitForPanelSettled(sheet);
  return sheet;
}

/**
 * Opens the panel the route names (`#/session/<id>/<panel>`) at any width: the
 * drawer on a wide screen, that panel's sheet on a phone. Returns the scope that
 * holds it (the sheet on a phone, the page otherwise).
 */
export async function showRoutePanel(page: Page) {
  if (await isPhoneLayout(page)) {
    const label = routePanelLabel(page.url());
    if (!label) throw new Error(`The route names no session panel: ${page.url()}`);
    return await showPhonePanel(page, label);
  }
  await showSidePanel(page);
  return page.locator("body");
}

/** Opens one session panel at any width: a drawer tab, or a phone sheet. */
export async function showSessionPanel(page: Page, label: string) {
  if (await isPhoneLayout(page)) return await showPhonePanel(page, label);
  await showSidePanel(page);
  const tab = page
    .getByRole("tablist", { name: "Session panels", exact: true })
    .getByRole("tab", { name: label, exact: true });
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return page.locator("body");
}

/** Starts a foreground child the way the parent's subagent tool does; the reply waits for its outcome. */
export function startForegroundChild(
  request: APIRequestContext,
  harness: { baseUrl: string },
  sessionId: string,
  description: string,
  prompt: string,
) {
  return request.post(`${harness.baseUrl}/sessions/${sessionId}/children`, {
    data: { profile: "general", description, prompt, background: false },
  });
}

/** Opens the Subagents panel at any width; on a phone it is a sheet over the chat. */
export async function showSubagents(page: Page, mobile: boolean) {
  if (mobile) await showPhonePanel(page, "Subagents");
  else await showSessionPanel(page, "Subagents");
}
