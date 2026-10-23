import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { initializeHarnessWorkspace } from "./harness";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("nested scripted workspaces snapshot owned inputs, excluding evolving runner artifacts across restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-harness-workspace-"));
  roots.push(root);
  await initializeHarnessWorkspace(root);
  const run = path.join(root, "test-results", "selection", "run");
  const workspace = path.join(run, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const git = async (...args: string[]) =>
    (await execute("git", ["-C", workspace, ...args])).stdout.trim();
  // Characterize the inherited failure: mkdir alone discovers the parent repo.
  expect(await fs.realpath(await git("rev-parse", "--show-toplevel"))).toBe(
    await fs.realpath(root),
  );
  await fs.writeFile(path.join(run, "trace.zip"), "changing runner trace");
  await fs.writeFile(path.join(run, "store.db-shm"), "transient SQLite state");

  await initializeHarnessWorkspace(workspace);
  expect(await fs.realpath(await git("rev-parse", "--show-toplevel"))).toBe(
    await fs.realpath(workspace),
  );
  const baseline = await git("rev-parse", "HEAD");
  await fs.writeFile(path.join(workspace, "owned.txt"), "real snapshot input");
  await git("add", "--all");
  expect(await git("diff", "--cached", "--name-only")).toBe("owned.txt");

  await fs.writeFile(path.join(run, "trace.zip"), "updated trace");
  await fs.rm(path.join(run, "store.db-shm"));
  await git("checkout", "-b", "fixture-edits");
  await initializeHarnessWorkspace(workspace);
  await git("add", "--all");
  expect(await git("rev-parse", "HEAD")).toBe(baseline);
  expect(await git("branch", "--show-current")).toBe("fixture-edits");
  expect(await git("diff", "--cached", "--name-only")).toBe("owned.txt");
  expect(await fs.readFile(path.join(workspace, "owned.txt"), "utf8")).toBe("real snapshot input");
});
