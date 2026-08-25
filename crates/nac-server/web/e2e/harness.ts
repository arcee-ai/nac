import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type APIRequestContext, type TestInfo } from "@playwright/test";

import { ScriptedProvider } from "./scripted-provider";

type SessionBehavior = "orchestrator" | "direct" | "direct-with-orchestrator";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "../../../..");

export type EmbeddedHarness = {
  baseUrl: string;
  binaryPath: string;
  provider: ScriptedProvider;
  runRoot: string;
};

type RunningHarness = EmbeddedHarness & {
  server: ChildProcess;
  output: string[];
  stop: () => Promise<void>;
};

type Fixtures = {
  harness: EmbeddedHarness;
  browserDiagnostics: void;
};

export const test = base.extend<Fixtures>({
  harness: async ({ request }, use, testInfo) => {
    void request;
    const running = await startHarness(testInfo);
    let useError: unknown;
    try {
      await use(running);
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
    await fs.writeFile(serverLog, running.output.join(""));
    await fs.writeFile(
      providerLog,
      JSON.stringify(
        running.provider.requests.map((entry) => ({
          ...entry,
          headers: redactHeaders(entry.headers),
        })),
        null,
        2,
      ),
    );
    const failed = testInfo.status !== testInfo.expectedStatus || useError !== undefined;
    if (failed) {
      await testInfo.attach("nac-web log", { path: serverLog, contentType: "text/plain" });
      await testInfo.attach("scripted provider journal", {
        path: providerLog,
        contentType: "application/json",
      });
      await attachIfPresent(
        testInfo,
        "isolated SQLite store",
        path.join(running.runRoot, "store.db"),
        "application/vnd.sqlite3",
      );
      await attachIfPresent(
        testInfo,
        "process status",
        path.join(running.runRoot, "process.json"),
        "application/json",
      );
    } else if (process.env.KEEP_E2E !== "1") {
      await fs.rm(running.runRoot, { recursive: true, force: true });
    }
    if (useError !== undefined && cleanupError !== undefined) {
      throw new AggregateError([useError, cleanupError], "E2E test and cleanup failed");
    }
    if (useError !== undefined) throw useError;
    if (cleanupError !== undefined) throw cleanupError;
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
): Promise<string> {
  const configuration = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "E2E scripted provider",
      backend: "openai-responses",
      model: "gpt-5.6-sol",
      base_url: harness.provider.baseUrl,
      api_key: "nac-e2e-dummy-only",
      reasoning_effort: "high",
      extra_headers: {},
      orchestrator_compaction_threshold: 0,
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
      name: "Embedded E2E project",
      cwd: path.join(harness.runRoot, "workspace"),
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

async function startHarness(testInfo: TestInfo): Promise<RunningHarness> {
  const runRoot = testInfo.outputPath("run");
  const workspace = path.join(runRoot, "workspace");
  const nacHome = path.join(runRoot, "nac-home");
  const home = path.join(runRoot, "home");
  const xdg = path.join(runRoot, "xdg");
  const tmp = path.join(runRoot, "tmp");
  await Promise.all(
    [runRoot, workspace, nacHome, home, xdg, tmp].map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  );

  const binaryPath = path.resolve(
    process.env.NAC_E2E_BINARY ?? path.join(repoRoot, "target/debug/nac-web"),
  );
  await fs.access(binaryPath);
  const provider = new ScriptedProvider();
  await provider.start();
  const output: string[] = [];
  let resolveAddress!: (url: string) => void;
  let rejectAddress!: (error: Error) => void;
  const address = new Promise<string>((resolve, reject) => {
    resolveAddress = resolve;
    rejectAddress = reject;
  });
  const server = spawn(
    binaryPath,
    [
      "--bind",
      "127.0.0.1:0",
      "--directory",
      workspace,
      "--store-path",
      path.join(runRoot, "store.db"),
      "--worker-executable",
      binaryPath,
      "--no-open",
    ],
    {
      cwd: workspace,
      detached: process.platform !== "win32",
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
        NAC_E2E_API_KEY: "nac-e2e-dummy-only",
        MODELS_DEV_URL: `${provider.baseUrl}/models-dev`,
      },
    },
  );

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
    const cleanup = await Promise.allSettled([terminateProcessGroup(server), provider.stop()]);
    const startupLog = path.join(runRoot, "nac-web.log");
    await fs.writeFile(startupLog, output.join(""));
    await testInfo.attach("nac-web startup log", { path: startupLog, contentType: "text/plain" });
    const cleanupFailures = cleanup.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures.map((result) => result.reason)],
        "nac-web startup and cleanup failed",
        { cause: error },
      );
    }
    throw error;
  }

  await fs.writeFile(
    path.join(runRoot, "process.json"),
    JSON.stringify({ pid: server.pid, binaryPath, baseUrl, provider: provider.baseUrl }, null, 2),
  );
  return {
    baseUrl,
    binaryPath,
    provider,
    runRoot,
    server,
    output,
    stop: async () => {
      const pid = server.pid;
      const cleanup = await Promise.allSettled([terminateProcessGroup(server), provider.stop()]);
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

async function terminateProcessGroup(child: ChildProcess): Promise<void> {
  if (child.pid == null) return;
  const rootExited = child.exitCode != null || child.signalCode != null;
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid!, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  if (rootExited) {
    // The leader may exit while a detached descendant remains in the original
    // group. POSIX can still address that group; ESRCH means it is already gone.
    if (process.platform !== "win32") signal("SIGTERM");
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  signal("SIGTERM");
  try {
    await withTimeout(exited, 3_000, "nac-web graceful termination");
  } catch {
    signal("SIGKILL");
    await withTimeout(exited, 3_000, "nac-web forced termination");
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
