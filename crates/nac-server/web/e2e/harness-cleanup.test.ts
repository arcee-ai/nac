import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

import { runStartupStepWithCleanup, terminateProcessGroup } from "./harness";

const spawnedGroups: Array<{ child: ChildProcess; marker: string }> = [];

afterEach(async () => {
  if (process.platform === "win32") return;
  for (const { child, marker } of spawnedGroups.splice(0)) {
    try {
      await terminateProcessGroup(child, { graceMs: 25, killMs: 1_000, pollMs: 10, marker });
    } catch {
      // Best-effort fallback for a test that has already failed.
    }
  }
});

describe("E2E harness cleanup", () => {
  test("runs every cleanup when post-start bookkeeping fails", async () => {
    const stopServer = vi.fn(async () => undefined);
    const stopProvider = vi.fn(async () => undefined);

    await expect(
      runStartupStepWithCleanup(
        async () => {
          throw new Error("injected process.json write failure");
        },
        [stopServer, stopProvider],
        "bookkeeping",
      ),
    ).rejects.toThrow("injected process.json write failure");

    expect(stopServer).toHaveBeenCalledOnce();
    expect(stopProvider).toHaveBeenCalledOnce();
  });

  test.skipIf(process.platform === "win32")(
    "kills a signal-resistant descendant after its process-group leader exits",
    async () => {
      const marker = `cleanup-test-${process.pid}-${Date.now()}`;
      const leader = spawnLeaderWithSignalResistantDescendant(marker);
      if (leader.pid == null) throw new Error("leader did not receive a pid");
      spawnedGroups.push({ child: leader, marker });
      const descendantPid = await readPid(leader);
      await new Promise<void>((resolve, reject) => {
        leader.once("error", reject);
        leader.once("exit", () => resolve());
      });
      expect(processExists(descendantPid)).toBe(true);
      expect(processGroupId(descendantPid)).toBe(descendantPid);
      await terminateProcessGroup(leader, {
        graceMs: 100,
        killMs: 1_000,
        pollMs: 10,
        marker,
      });
      expect(processExists(descendantPid)).toBe(false);
      spawnedGroups.splice(
        spawnedGroups.findIndex((entry) => entry.child === leader),
        1,
      );
    },
  );
});

function spawnLeaderWithSignalResistantDescendant(marker: string): ChildProcess {
  const leaderScript = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(`
      process.on("SIGTERM", () => {});
      process.stdout.write(String(process.pid) + "\\n");
      setInterval(() => {}, 1000);
    `)}], { detached: true, stdio: ["ignore", "pipe", "ignore"], env: process.env });
    child.stdout.once("data", (chunk) => {
      process.stdout.write(chunk);
      child.stdout.destroy();
      child.unref();
      process.exit(0);
    });
  `;
  return spawn(process.execPath, ["-e", leaderScript], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
    env: {
      ...process.env,
      NAC_E2E_CLEANUP_ID: marker,
    },
  });
}

async function readPid(child: ChildProcess): Promise<number> {
  const stdout = child.stdout;
  if (stdout == null) throw new Error("leader stdout was not captured");
  return await new Promise<number>((resolve, reject) => {
    let buffered = "";
    child.once("error", reject);
    stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lineEnd = buffered.indexOf("\n");
      if (lineEnd < 0) return;
      const pid = Number.parseInt(buffered.slice(0, lineEnd), 10);
      if (!Number.isInteger(pid)) reject(new Error(`invalid descendant pid: ${buffered}`));
      else resolve(pid);
    });
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function processGroupId(pid: number): number {
  const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ps failed for descendant ${pid}: ${result.stderr}`);
  const pgid = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isInteger(pgid))
    throw new Error(`invalid process group for ${pid}: ${result.stdout}`);
  return pgid;
}
