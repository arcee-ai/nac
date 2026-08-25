import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, test, vi } from "vitest";

import { runStartupStepWithCleanup, terminateProcessGroup } from "./harness";

const spawnedGroups: number[] = [];

afterEach(() => {
  if (process.platform === "win32") return;
  for (const pid of spawnedGroups.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
      const leader = spawnLeaderWithSignalResistantDescendant();
      if (leader.pid == null) throw new Error("leader did not receive a pid");
      spawnedGroups.push(leader.pid);
      const descendantPid = await readPid(leader);
      if (leader.exitCode == null && leader.signalCode == null) {
        await new Promise<void>((resolve, reject) => {
          leader.once("error", reject);
          leader.once("exit", () => resolve());
        });
      }

      expect(processExists(descendantPid)).toBe(true);
      await terminateProcessGroup(leader, { graceMs: 100, killMs: 1_000, pollMs: 10 });
      expect(processExists(descendantPid)).toBe(false);
      spawnedGroups.splice(spawnedGroups.indexOf(leader.pid), 1);
    },
  );
});

function spawnLeaderWithSignalResistantDescendant(): ChildProcess {
  const script = `
    const { spawn } = require("node:child_process");
    const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    process.stdout.write(String(descendant.pid) + "\\n");
    setTimeout(() => process.exit(0), 25);
  `;
  return spawn(process.execPath, ["-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
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
