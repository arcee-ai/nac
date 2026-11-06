import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { FreshTaskScheduleInspection, HeartbeatSchedule } from "../src/app/types/api";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createProject, expect, test as base } from "./harness";
import { ScriptGate } from "./scripted-provider";

const test = base.extend<{ sharedDirectory: string }>({
  sharedDirectory: async ({ request }, use, info) => {
    void request;
    const shared = await fs.mkdtemp(path.join(os.tmpdir(), "nac-shared-interval-"));
    const owner = await fs.lstat(shared);
    try {
      const probe = spawnSync("git", ["-C", shared, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LC_ALL: "C",
          GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
        },
      });
      const proofPath = info.outputPath("non-git-source-proof.json");
      await fs.mkdir(path.dirname(proofPath), { recursive: true });
      await fs.writeFile(
        proofPath,
        JSON.stringify(
          {
            directory: await fs.realpath(shared),
            device: owner.dev,
            inode: owner.ino,
            probe: { status: probe.status, stdout: probe.stdout, stderr: probe.stderr },
            retainedCopy: info.outputPath("shared-directory-custody"),
          },
          null,
          2,
        ),
      );
      expect(probe.status).toBe(128);
      expect(probe.stderr).toMatch(/^fatal: not a git repository \(/);
      await use(shared);
    } finally {
      // The harness depends on this fixture through serverEnvironment, so its
      // server/provider/process cleanup finishes before copying or removing files.
      const current = await fs.lstat(shared);
      expect(current.isSymbolicLink()).toBe(false);
      expect([current.dev, current.ino]).toEqual([owner.dev, owner.ino]);
      await fs.cp(shared, info.outputPath("shared-directory-custody"), {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await fs.rm(shared, { recursive: true, force: false });
    }
  },
  serverEnvironment: async ({ sharedDirectory }, use) => {
    void sharedDirectory; // Bind the external directory's lifetime to the server.
    await use({});
  },
});

test.use({ managedNativeWeb: false });

test("non-Git interval task shows and retains its exact shared Local directory", async ({
  harness,
  sharedDirectory,
  page,
  request,
}, info) => {
  test.setTimeout(90000);
  const shared = sharedDirectory;
  await fs.writeFile(path.join(shared, "seed"), "shared fixture evidence");
  await fs.writeFile(
    path.join(harness.runRoot, "nac-home/config.toml"),
    "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
  );
  await harness.restart("1", undefined, true);
  const project = await createProject(request, harness, {
    cwd: shared,
    name: "Plain Local fixture",
  });
  const source = await request.get(`${harness.baseUrl}/projects/${project}/task-launch-source`);
  expect(source.ok()).toBe(true);
  expect(await source.json()).toEqual({ eligible: false, default_ref: null });
  await page.goto(`${harness.baseUrl}/#/project/${project}/task-schedules`);
  await page.getByRole("button", { name: "New task schedule", exact: true }).click();
  const form = page.getByRole("form", { name: "Create interval task schedule" });
  await expect(form).toContainText("shares its files with other tasks");
  await expect(form.getByRole("textbox", { name: "Scheduled pinned commit" })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: "Scheduled project default branch" })).toHaveCount(
    0,
  );
  await form.getByRole("textbox", { name: "Heartbeat name" }).fill("Shared Local inspection");
  await form
    .getByRole("textbox", { name: "Heartbeat instructions" })
    .fill("SHARED_INTERVAL_BRIEF: Read seed in this shared Local directory and report unchanged.");
  await form.getByRole("spinbutton", { name: "Interval in minutes" }).fill("10");
  await form.getByRole("spinbutton", { name: "Retained task allowance" }).fill("1");
  await page.screenshot({ path: info.outputPath("fresh-interval-shared-warning.png") });
  await form.getByRole("button", { name: "Create task schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
  const schedules: HeartbeatSchedule[] = await (
    await request.get(`${harness.baseUrl}/projects/${project}/task-schedules`)
  ).json();
  expect(schedules).toHaveLength(1);
  const schedule = schedules[0];
  const inspect = async (): Promise<FreshTaskScheduleInspection> => {
    const response = await request.get(
      `${harness.baseUrl}/projects/${project}/task-schedules/${schedule.schedule_id}`,
    );
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "shared-read",
    { token: "SHARED_INTERVAL_BRIEF", requiredTools: ["read", "report_heartbeat"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: "shared-read",
      arguments: { path: "seed" },
    },
    gate,
  );
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await gate.accepted;
  const admitted = await inspect();
  const active = admitted.heartbeat.history.find((item) => item.state === "admitted");
  if (!active) throw new Error("Shared task has no admitted initial occurrence");
  harness.provider.enqueue(
    "shared-report",
    { functionOutputCallId: "shared-read" },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: "shared-report",
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "unchanged",
        evidence: "Read shared fixture evidence from the exact Local directory.",
      },
    },
  );
  harness.provider.enqueue(
    "shared-ended",
    { functionOutputCallId: "shared-report" },
    { kind: "text", stream: "request", text: "Shared Local directory verified." },
  );
  gate.release();
  await expect
    .poll(async () => (await inspect()).inventory[0]?.initial_outcome?.outcome, { timeout: 30000 })
    .toBe("unchanged");
  const settled = await inspect();
  expect(settled.inventory).toHaveLength(1);
  expect(settled.launches).toHaveLength(0);
  const receipt = settled.inventory[0];
  expect(receipt.shared_directory).toBe(true);
  expect(receipt.initial_run_id).toBe(active.run_id);
  expect(receipt.binding.execution_cwd).toBe(await fs.realpath(shared));
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  expect(await api.getGoal(receipt.session_id)).toBeNull();
  const card = page.locator(`[data-occurrence="${receipt.occurrence_id}"]`);
  await expect(card).toContainText("Shared Local directory: tasks use the same files");
  await expect(card).toContainText(await fs.realpath(shared));
  await page.screenshot({ path: info.outputPath("fresh-interval-shared-receipt.png") });
  await fs.writeFile(path.join(shared, "retained-shared-work"), "belongs to the project directory");
  expect((await request.delete(`${harness.baseUrl}/sessions/${receipt.session_id}`)).ok()).toBe(
    true,
  );
  await page.reload();
  await expect(page.locator(`[data-occurrence="${receipt.occurrence_id}"]`)).toContainText(
    "Task removed",
  );
  expect(await fs.readFile(path.join(shared, "retained-shared-work"), "utf8")).toBe(
    "belongs to the project directory",
  );
  expect(await fs.readFile(path.join(shared, "seed"), "utf8")).toBe("shared fixture evidence");
  await page.getByRole("button", { name: "Stop schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop schedule", exact: true })).toBeDisabled();
  harness.provider.assertConsumed();
});
