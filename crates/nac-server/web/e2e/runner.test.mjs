import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runPlaywright } from "../scripts/run-e2e.mjs";

let fixture;
let cli;
const pending = [],
  gates = [],
  children = [];
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), "nac-runner-test-"));
  cli = path.join(fixture, "playwright-double.mjs");
  await fs.writeFile(
    cli,
    `
    import fs from "node:fs/promises";
    import path from "node:path";
    import {spawnSync} from "node:child_process";
    const root=path.resolve(process.env.NAC_E2E_ARTIFACTS);
    await fs.rm(root,{recursive:true,force:true}); await fs.mkdir(root,{recursive:true});
    await fs.writeFile(path.join(root,"store.db"),"live synthetic store");
    const worker=spawnSync(process.execPath,["-e","console.log(JSON.stringify({root:process.env.NAC_E2E_ARTIFACTS,absolute:process.env.NAC_E2E_RUN_ARTIFACT_ROOT,id:process.env.NAC_E2E_RUN_ID}))"],{encoding:"utf8"});
    await fs.writeFile(process.env.NAC_RUNNER_CAPTURE,JSON.stringify({root,selected:process.env.NAC_E2E_ARTIFACTS,id:process.env.NAC_E2E_RUN_ID,derived:process.env.NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS,worker:JSON.parse(worker.stdout),args:process.argv.slice(2)}));
    process.on("SIGINT",()=>process.exit(0));
    if(process.env.NAC_RUNNER_GATE) for(let n=0;n<500;n++) {
      try {await fs.access(process.env.NAC_RUNNER_GATE);break;}
      catch {await new Promise(resolve=>setTimeout(resolve,10));}
    }
    process.exit(Number(process.env.NAC_RUNNER_EXIT??0));
  `,
  );
});
afterEach(async () => {
  for (const gate of gates.splice(0)) await fs.writeFile(gate, "release");
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGINT");
  await Promise.allSettled(pending.splice(0));
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(fixture, { recursive: true, force: true });
});
async function observation(capture) {
  for (let n = 0; n < 200; n++) {
    try {
      return JSON.parse(await fs.readFile(capture, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("runner did not report its artifact root");
}
function start(name, overrides = {}, wait = false, args = []) {
  const capture = path.join(fixture, name + ".json"),
    gate = wait ? path.join(fixture, name + ".release") : undefined;
  if (gate) gates.push(gate);
  const log = [];
  const env = {
    ...process.env,
    NAC_E2E_ARTIFACTS: undefined,
    NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS: undefined,
    KEEP_E2E: undefined,
    NAC_RUNNER_CAPTURE: capture,
    NAC_RUNNER_GATE: gate,
    ...overrides,
  };
  const result = runPlaywright(args, {
    cwd: fixture,
    tempDirectory: fixture,
    cliPath: cli,
    env,
    stdio: "ignore",
    log: (line) => log.push(line),
  });
  pending.push(result);
  return { capture, gate, log, result };
}
const marker = (root) => path.join(root, "store.db");
describe("invocation-owned Playwright runner", () => {
  test("competing invocations preserve live fixtures and clean only their successful roots", async () => {
    const first = start("first", {}, true, ["packed-presentation.e2e.ts", "--grep", "desktop"]),
      second = start("second", {}, true);
    const a = await observation(first.capture),
      b = await observation(second.capture);
    expect(a.root).not.toBe(b.root);
    expect(await fs.readFile(marker(a.root), "utf8")).toBe("live synthetic store");
    expect(await fs.readFile(marker(b.root), "utf8")).toBe("live synthetic store");
    expect(a.worker).toEqual({ root: a.selected, absolute: a.root, id: a.id });
    expect(a.args).toEqual(["test", "packed-presentation.e2e.ts", "--grep", "desktop"]);
    await fs.writeFile(first.gate, "release");
    expect(await first.result).toBe(0);
    await expect(fs.access(a.root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(marker(b.root), "utf8")).toBe("live synthetic store");
    await fs.writeFile(second.gate, "release");
    expect(await second.result).toBe(0);
    await expect(fs.access(b.root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(first.log.join("\n")).toContain(a.root);
  });
  test("new top-level invocations do not adopt an inherited default", async () => {
    const first = start("parent", {}, true),
      a = await observation(first.capture);
    const next = start("nested", {
      NAC_E2E_ARTIFACTS: a.selected,
      NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS: a.derived,
    });
    const b = await observation(next.capture);
    expect(b.root).not.toBe(a.root);
    expect(await next.result).toBe(0);
    expect(await fs.readFile(marker(a.root), "utf8")).toBe("live synthetic store");
    await fs.writeFile(first.gate, "release");
    await first.result;
  });
  test("explicit paths remain exact and retained; their lease rejects competing cleanup", async () => {
    const first = start("explicit", { NAC_E2E_ARTIFACTS: "caller-artifacts" }, true),
      a = await observation(first.capture);
    expect(a.selected).toBe("caller-artifacts");
    const competing = start("competing", { NAC_E2E_ARTIFACTS: "caller-artifacts" });
    await expect(competing.result).rejects.toThrow("already has an owner");
    expect(await fs.readFile(marker(a.root), "utf8")).toBe("live synthetic store");
    await fs.writeFile(first.gate, "release");
    expect(await first.result).toBe(0);
    expect(await fs.readFile(marker(a.root), "utf8")).toBe("live synthetic store");
    await expect(fs.access(a.root + ".nac-e2e-owner.json")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  test("failure evidence is printed and bounded without pruning an active runner", async () => {
    const active = start("active", {}, true),
      live = await observation(active.capture),
      failed = [];
    for (let n = 0; n < 4; n++) {
      const run = start("failure" + n, { NAC_RUNNER_EXIT: "1" }),
        item = await observation(run.capture);
      expect(await run.result).toBe(1);
      failed.push(item.root);
      expect(run.log.join("\n")).toContain("retained artifacts: " + item.root);
    }
    await expect(fs.access(failed[0])).rejects.toMatchObject({ code: "ENOENT" });
    for (const root of failed.slice(1))
      expect(await fs.readFile(marker(root), "utf8")).toBe("live synthetic store");
    expect(await fs.readFile(marker(live.root), "utf8")).toBe("live synthetic store");
    await fs.writeFile(active.gate, "release");
    await active.result;
  });
  test("real CLI interruption waits for the child and retains its reported root", async () => {
    const capture = path.join(fixture, "interrupt.json"),
      gate = path.join(fixture, "interrupt.release"),
      entry = path.join(fixture, "wrapper.mjs");
    await fs.writeFile(
      entry,
      `import {runPlaywright} from ${JSON.stringify(new URL("../scripts/run-e2e.mjs", import.meta.url).href)};process.exitCode=await runPlaywright([],{cwd:process.argv[2],tempDirectory:process.argv[2],cliPath:process.argv[3]});`,
    );
    const child = spawn(process.execPath, [entry, fixture, cli], {
      env: {
        ...process.env,
        NAC_E2E_ARTIFACTS: undefined,
        NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS: undefined,
        KEEP_E2E: undefined,
        NAC_RUNNER_CAPTURE: capture,
        NAC_RUNNER_GATE: gate,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    gates.push(gate);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    const ended = new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    pending.push(ended);
    const item = await observation(capture);
    child.kill("SIGINT");
    expect(await ended).toBe(130);
    expect(await fs.readFile(marker(item.root), "utf8")).toBe("live synthetic store");
    expect(output).toContain("retained artifacts: " + item.root);
  });
  test("alias spellings cannot obtain a second lease for the same explicit root", async () => {
    const real = path.join(fixture, "real-artifacts"),
      alias = path.join(fixture, "alias-artifacts");
    await fs.mkdir(real);
    await fs.symlink(real, alias, "dir");
    const first = start("alias-owner", { NAC_E2E_ARTIFACTS: real }, true);
    await observation(first.capture);
    const second = start("alias-competitor", { NAC_E2E_ARTIFACTS: alias });
    await expect(second.result).rejects.toThrow("already has an owner");
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(marker(real), "utf8")).toBe("live synthetic store");
    await fs.writeFile(first.gate, "release");
    await first.result;
  });
  test("dead explicit owners fail with an actionable lease-only recovery path", async () => {
    const root = path.join(fixture, "stale-artifacts"),
      lease = root + ".nac-e2e-owner.json";
    await fs.mkdir(root);
    await fs.writeFile(marker(root), "retained evidence");
    await fs.writeFile(
      lease,
      JSON.stringify({
        kind: "nac-e2e-explicit-v1",
        root: await fs.realpath(root),
        runId: "stale-run",
        pid: 2147483647,
        state: "active",
      }),
      { mode: 0o600 },
    );
    const run = start("stale", { NAC_E2E_ARTIFACTS: root });
    await expect(run.result).rejects.toThrow("no live owner");
    await expect(run.result).rejects.toThrow("remove only that lease");
    expect(await fs.readFile(marker(root), "utf8")).toBe("retained evidence");
    expect(JSON.parse(await fs.readFile(lease, "utf8")).runId).toBe("stale-run");
  });
  test("an interrupt before a child PID exists is recorded and retains its owned root", async () => {
    const entry = path.join(fixture, "pre-child.mjs"),
      capture = path.join(fixture, "pre-child.json");
    await fs.writeFile(
      entry,
      `import {runPlaywright} from ${JSON.stringify(new URL("../scripts/run-e2e.mjs", import.meta.url).href)};
      process.exitCode=await runPlaywright([], {cwd:process.argv[2],tempDirectory:process.argv[2],cliPath:process.argv[3],
        log:line=>{console.log(line);if(line.startsWith("NAC E2E artifacts:"))process.emit("SIGINT");}});`,
    );
    const child = spawn(process.execPath, [entry, fixture, cli], {
      env: {
        ...process.env,
        NAC_E2E_ARTIFACTS: undefined,
        NAC_E2E_INTERNAL_DEFAULT_ARTIFACTS: undefined,
        KEEP_E2E: undefined,
        NAC_RUNNER_CAPTURE: capture,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    const ended = new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    pending.push(ended);
    expect(await ended).toBe(130);
    await expect(fs.access(capture)).rejects.toMatchObject({ code: "ENOENT" });
    expect(output).toContain("retained artifacts:");
  });
  test("KEEP_E2E retains successful owned evidence", async () => {
    const run = start("keep", { KEEP_E2E: "1" });
    const item = await observation(run.capture);
    expect(await run.result).toBe(0);
    expect(await fs.readFile(marker(item.root), "utf8")).toBe("live synthetic store");
    expect(run.log.join("\n")).toContain("retained artifacts: " + item.root);
  });
  test("lease inspection never follows a caller's symlink marker", async () => {
    const root = path.join(fixture, "marker-root"),
      foreign = path.join(fixture, "foreign-evidence");
    await fs.mkdir(root);
    await fs.writeFile(foreign, "retained foreign evidence");
    await fs.symlink(foreign, root + ".nac-e2e-owner.json");
    const run = start("foreign", { NAC_E2E_ARTIFACTS: root });
    await expect(run.result).rejects.toThrow("Inspect the unrecognized E2E lease");
    expect(await fs.readFile(foreign, "utf8")).toBe("retained foreign evidence");
    expect((await fs.lstat(root + ".nac-e2e-owner.json")).isSymbolicLink()).toBe(true);
  });
  test("bounded history never deletes a live native fixture after its runner exits", async () => {
    const first = start("native", { NAC_RUNNER_EXIT: "1" });
    const item = await observation(first.capture);
    await first.result;
    const runDirectory = path.join(item.root, "synthetic-case", "run");
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(
      path.join(runDirectory, "process.json"),
      JSON.stringify({ pid: process.pid, artifactRunId: item.id }),
      { mode: 0o600 },
    );
    for (let n = 0; n < 4; n++) await start("later" + n, { NAC_RUNNER_EXIT: "1" }).result;
    expect(await fs.readFile(marker(item.root), "utf8")).toBe("live synthetic store");
  });
  test("static config reloads share the handoff; unsafe direct invocation fails closed", async () => {
    vi.stubEnv("NAC_E2E_ARTIFACTS", undefined);
    vi.stubEnv("NAC_E2E_RUN_ID", undefined);
    vi.stubEnv("NAC_E2E_REMOTE", "0");
    await expect(import("../playwright.config")).rejects.toThrow("npm run test:e2e");
    vi.resetModules();
    vi.stubEnv("NAC_E2E_ARTIFACTS", path.join(fixture, "stable"));
    vi.stubEnv("NAC_E2E_RUN_ID", "known-invocation");
    vi.stubEnv("NAC_E2E_RUN_ARTIFACT_ROOT", path.join(fixture, "stable"));
    vi.stubEnv("NAC_E2E_RUN_WRAPPER_PID", String(process.ppid));
    vi.stubEnv("NAC_E2E_RUN_CONFIG_PID", undefined);
    vi.stubEnv("TEST_WORKER_INDEX", undefined);
    const first = (await import("../playwright.config")).default;
    vi.resetModules();
    const second = (await import("../playwright.config")).default;
    expect(first.outputDir).toBe(path.join(fixture, "stable"));
    expect(second.outputDir).toBe(first.outputDir);
    expect(second.testMatch).toBe("**/*.e2e.ts");
    expect(second.retries).toBe(0);
    vi.resetModules();
    vi.stubEnv("NAC_E2E_REMOTE", "1");
    vi.stubEnv("NAC_E2E_REMOTE_AUTH_MODE", "portal-launch");
    vi.stubEnv("DEBUG", undefined);
    vi.stubEnv("PWDEBUG", undefined);
    const remote = (await import("../playwright.config")).default;
    expect(remote.use.trace).toBe("off");
    expect(remote.use.screenshot).toBe("off");
    expect(remote.use.video).toBe("off");
    expect(remote.testIgnore).toEqual(["**/embedded.e2e.ts", "**/managed.e2e.ts"]);
    // A separate top-level CLI cannot borrow another runner's handoff.
    vi.resetModules();
    vi.stubEnv("NAC_E2E_RUN_WRAPPER_PID", "0");
    vi.stubEnv("NAC_E2E_RUN_CONFIG_PID", "0");
    await expect(import("../playwright.config")).rejects.toThrow("npm run test:e2e");
  });
});
