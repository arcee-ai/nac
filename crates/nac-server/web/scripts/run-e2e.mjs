import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const markerSuffix = ".nac-e2e-owner.json";
const retainedFailures = 3;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function canonicalRoot(root) {
  try {
    const canonical = await fs.realpath(root);
    if (!(await fs.stat(canonical)).isDirectory())
      throw new Error("E2E artifacts must name a directory");
    return canonical;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      if ((await fs.lstat(root)).isSymbolicLink())
        throw new Error("E2E artifact root is a dangling link; inspect it before retrying");
    } catch (missing) {
      if (missing.code !== "ENOENT") throw missing;
    }
    await fs.mkdir(path.dirname(root), { recursive: true });
    return path.join(await fs.realpath(path.dirname(root)), path.basename(root));
  }
}

async function readMarker(marker) {
  const handle = await fs.open(marker, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid()))
      throw new Error("unrecognized E2E lease owner");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function hasLiveFixture(root, runId) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const run = path.join(root, entry.name, "run");
    try {
      if (!(await fs.lstat(run)).isDirectory()) continue;
      const fixture = await readMarker(path.join(run, "process.json"));
      if (fixture.artifactRunId === runId && Number.isInteger(fixture.pid) && alive(fixture.pid))
        return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return false;
}

async function releaseLease(marker, runId) {
  const actual = await readMarker(marker);
  if (actual.runId !== runId) throw new Error("E2E artifact lease ownership changed");
  await fs.unlink(marker);
}

// Prune only marked, completed/dead default runs in this checkout's namespace.
// Explicit roots, active runners and KEEP_E2E evidence are never candidates.
async function prune(namespace, current) {
  const candidates = [];
  for (const name of await fs.readdir(namespace)) {
    if (!/^run-[A-Za-z0-9_-]+\.nac-e2e-owner\.json$/.test(name)) continue;
    const marker = path.join(namespace, name);
    const root = marker.slice(0, -markerSuffix.length);
    try {
      const stat = await fs.lstat(marker);
      if (!stat.isFile() || (process.getuid && stat.uid !== process.getuid())) continue;
      const record = await readMarker(marker);
      if (record.kind !== "nac-e2e-default-v1" || record.root !== root || record.keep) continue;
      if (
        !Number.isInteger(record.pid) ||
        record.pid <= 0 ||
        !["active", "retained"].includes(record.state)
      )
        continue;
      if (record.state === "active" && alive(record.pid)) continue;
      if (!(await fs.lstat(root)).isDirectory()) continue;
      if (await hasLiveFixture(root, record.runId)) continue;
      candidates.push({ root, marker, time: root === current ? Infinity : stat.mtimeMs });
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  candidates.sort((left, right) => right.time - left.time);
  for (const candidate of candidates.slice(retainedFailures)) {
    await fs.rm(candidate.root, { recursive: true, force: true });
    await fs.rm(candidate.marker, { force: true });
  }
}

export async function runPlaywright(args, options = {}) {
  const environment = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? console.log;
  const cli =
    options.cliPath ??
    path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  const explicit =
    environment.NAC_E2E_ARTIFACTS &&
    environment.NAC_E2E_ARTIFACTS !== environment.NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS;
  const workspace = createHash("sha256")
    .update(await fs.realpath(cwd))
    .digest("hex")
    .slice(0, 16);
  let namespace = path.join(options.tempDirectory ?? os.tmpdir(), "nac-playwright", workspace);
  if (!explicit) {
    await fs.mkdir(namespace, { recursive: true });
    namespace = await fs.realpath(namespace);
    await prune(namespace);
  }
  const selected = explicit
    ? environment.NAC_E2E_ARTIFACTS
    : await fs.mkdtemp(path.join(namespace, "run-"));
  const root = await canonicalRoot(path.resolve(cwd, selected));
  const runId = randomUUID();
  const marker = root + markerSuffix;
  const record = {
    kind: explicit ? "nac-e2e-explicit-v1" : "nac-e2e-default-v1",
    root,
    runId,
    pid: process.pid,
    state: "active",
    keep: environment.KEEP_E2E === "1",
  };
  await fs.mkdir(path.dirname(marker), { recursive: true });
  try {
    await fs.writeFile(marker, JSON.stringify(record), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") {
      let held;
      try {
        held = await readMarker(marker);
      } catch {
        throw new Error(
          `Inspect the unrecognized E2E lease at ${marker}; evidence at ${root} was not changed`,
        );
      }
      if (
        held.kind !== record.kind ||
        held.root !== root ||
        !Number.isInteger(held.pid) ||
        held.pid <= 0
      ) {
        throw new Error(
          `Inspect the unrecognized E2E lease at ${marker}; evidence at ${root} was not changed`,
        );
      }
      if (!alive(held.pid)) {
        throw new Error(
          `E2E artifact lease has no live owner (PID ${held.pid}): ${marker}. Inspect and remove only that lease before retrying; evidence remains at ${root}`,
        );
      }
      throw new Error(
        `E2E artifact directory already has an owner (PID ${held.pid}): ${root} (lease: ${marker})`,
      );
    }
    throw error;
  }
  let child;
  let interrupted;
  const forward = (signal) => {
    if (interrupted) return;
    interrupted = signal;
    if (!child?.pid) return;
    // One graceful interrupt lets Playwright finish native fixture cleanup.
    if (process.platform === "win32") child.kill("SIGINT");
    else {
      try {
        process.kill(-child.pid, "SIGINT");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  let code = 1;
  try {
    log(
      `NAC E2E artifacts: ${root} (${explicit ? "caller-owned" : "invocation-owned"}; run ${runId})`,
    );
    if (interrupted) {
      code = interrupted === "SIGTERM" ? 143 : 130;
      return code;
    }
    child = spawn(process.execPath, [cli, "test", ...args], {
      cwd,
      detached: process.platform !== "win32",
      stdio: options.stdio ?? "inherit",
      env: {
        ...environment,
        NAC_E2E_ARTIFACTS: selected,
        NAC_E2E_RUN_ARTIFACT_ROOT: root,
        NAC_E2E_RUN_ID: runId,
        NAC_E2E_RUN_WRAPPER_PID: String(process.pid),
        NAC_E2E_RUN_CONFIG_PID: undefined,
        TEST_WORKER_INDEX: undefined,
        TEST_PARALLEL_INDEX: undefined,
        NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS: explicit ? "" : selected,
      },
    });
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode, signal) =>
        resolve(exitCode ?? (signal === "SIGINT" ? 130 : 1)),
      );
    });
    if (interrupted) code = interrupted === "SIGTERM" ? 143 : 130;
    return code;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    // Waited for the entire Playwright process, including reporter writes.
    if (explicit) {
      await releaseLease(marker, runId);
      log(`NAC E2E retained caller artifacts: ${root} (exit ${code})`);
    } else if (code === 0 && !record.keep) {
      await fs.rm(root, { recursive: true, force: true });
      await fs.unlink(marker);
      log(`NAC E2E removed owned artifacts: ${root}`);
    } else {
      record.state = "retained";
      const temporary = marker + `.${runId}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ ...record, exitCode: code }), { mode: 0o600 });
      await fs.rename(temporary, marker);
      log(`NAC E2E retained artifacts: ${root} (exit ${code})`);
      await prune(namespace, root);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runPlaywright(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
