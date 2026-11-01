import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createProject, createSession, expect, showSidePanel, test } from "./harness";
import { ScriptGate } from "./scripted-provider";
import type { HeartbeatInspection, ManagedSessionSummary } from "../src/app/types/api";

test.use({ managedNativeWeb: false });

test("pending withdrawal keeps an unchanged check quiet in the production session list", async ({
  harness,
  request,
  page,
}, info) => {
  const project = await createProject(request, harness);
  const target = await createSession(request, harness, "direct", project);
  const holder = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(target, "auto_approve");
  await api.setPermissionApprovalMode(holder, "auto_approve");
  const initial: ManagedSessionSummary[] = await (
    await request.get(`${harness.baseUrl}/sessions`)
  ).json();
  await api.updatePresentation(target, {
    expected_version:
      initial.find((entry) => entry.summary.session_id === target)!.summary.presentation_version ??
      0,
    title: "Quiet withdrawal target",
    pinned: false,
  });
  await page.goto(`${harness.baseUrl}/#/session/${target}/insights`);
  await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
  await page.goto(`${harness.baseUrl}/#/session/${holder}/sessions`);
  const row = page.getByRole("button", { name: /^Quiet withdrawal target/ });
  await expect(row).toBeVisible();
  const control = async (operation: object) => {
    const response = await request.post(
      `${harness.baseUrl}/sessions/${target}/heartbeats/control`,
      {
        data: { request_id: randomUUID(), operation },
      },
    );
    expect(response.status()).toBe(200);
    return response.json();
  };
  const created = await control({
    action: "create",
    spec: {
      name: "Quiet fixture check",
      instructions: "Read quiet-result.txt and report unchanged.",
      skills: [],
      interval_ms: 60000,
      end_condition: "Stop after the human pauses this check.",
      goal_id: null,
      execution_timeout_ms: 30000,
      max_occurrences: 10,
      token_allowance: null,
    },
  });
  const schedule = created.schedule.schedule_id as string;
  const inspect = () =>
    request
      .get(`${harness.baseUrl}/sessions/${target}/heartbeats/${schedule}`)
      .then((r) => r.json() as Promise<HeartbeatInspection>);
  await fs.writeFile(path.join(harness.runRoot, "workspace/quiet-result.txt"), "No change.\n");
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "quiet-read",
    { token: "Durable heartbeat occurrence", requiredTools: ["read", "report_heartbeat"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: "quiet-read",
      arguments: { path: path.join(harness.runRoot, "workspace/quiet-result.txt") },
    },
    gate,
  );
  await control({ action: "run_now", schedule_id: schedule, expected_version: 1 });
  await gate.accepted;
  const active = (await inspect()).history.find((item) => item.state === "admitted")!;
  harness.provider.enqueue(
    "quiet-report",
    { functionOutputCallId: "quiet-read" },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: "quiet-report",
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "unchanged",
        evidence: "quiet-result.txt confirms no change.",
      },
    },
  );
  harness.provider.enqueue(
    "quiet-ended",
    { functionOutputCallId: "quiet-report" },
    { kind: "text", stream: "request", text: "No change in the authorized fixture." },
  );
  gate.release();
  await expect.poll(async () => (await inspect()).history[0].state).toBe("settled");
  const listing = async () => {
    const entries: ManagedSessionSummary[] = await (
      await request.get(`${harness.baseUrl}/sessions`)
    ).json();
    return entries.find((entry) => entry.summary.session_id === target)!;
  };
  const before = await listing();
  expect(before.heartbeat_results?.[0].outcome).toBe("unchanged");
  expect(before.attention_updated_at).toBeTruthy();
  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute(
    "aria-label",
    /Updated|updated since last viewed|Run finished/,
  );
  // A real retained terminal in the same workspace holds its activity lease.
  // This makes pending work deterministic across scheduler ticks, without
  // changing the target chat's timestamp or ordinary-run revision.
  const terminal = await api.openUserTerminal(holder, {
    protocol_version: 1,
    launch_id: randomUUID(),
    cols: 80,
    rows: 24,
  });
  expect(terminal.alive).toBe(true);
  const pending = await control({ action: "run_now", schedule_id: schedule, expected_version: 1 });
  await page.waitForTimeout(1200); // Exercise a complete one-second scheduler scan.
  expect(
    (await inspect()).history.find((o) => o.occurrence_id === pending.occurrence.occurrence_id)
      ?.state,
  ).toBe("pending");
  await control({ action: "pause", schedule_id: schedule, expected_version: 1 });
  const after = await listing();
  expect(after.summary.updated_at).toBe(before.summary.updated_at);
  expect(after.attention_revision).toBe(before.attention_revision);
  expect(after.attention_updated_at).toBe(before.attention_updated_at);
  expect(after.heartbeat_results).toEqual(before.heartbeat_results);
  const withdrawn = (await inspect()).history.find(
    (o) => o.occurrence_id === pending.occurrence.occurrence_id,
  )!;
  expect(withdrawn.state).toBe("withdrawn");
  expect(withdrawn.outcome).toBeNull();
  await page.reload();
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute(
    "aria-label",
    /Updated|updated since last viewed|Run finished/,
  );
  await page.screenshot({ path: info.outputPath("quiet-after-withdrawal.png"), fullPage: true });
  const viewedNavigation = await page.evaluate(() => localStorage.getItem("nac.sessionNavigation"));
  expect(viewedNavigation).toBeTruthy();
  await harness.restart("1"); // Normal shutdown also cleans the owned terminal.
  // Restart binds a different ephemeral origin. Preserve this user's actual
  // viewed history rather than treating the new port as a first-time viewer.
  await page.addInitScript(
    (saved) => localStorage.setItem("nac.sessionNavigation", saved!),
    viewedNavigation,
  );
  await page.goto(`${harness.baseUrl}/#/session/${holder}/sessions`);
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute(
    "aria-label",
    /Updated|updated since last viewed|Run finished/,
  );
  expect((await listing()).heartbeat_results).toEqual(after.heartbeat_results);
});

test("a missing heartbeat deep link shows its inspection error", async ({
  harness,
  request,
  page,
}, info) => {
  const session = await createSession(request, harness, "direct");
  await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats?heartbeat=${randomUUID()}`);
  await showSidePanel(page);
  await expect(page.getByRole("alert").filter({ hasText: /heartbeat|not found/i })).toBeVisible();
  await expect(page.getByText(/Choose a heartbeat/)).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("heartbeat-inspection-error.png"),
    fullPage: true,
  });
});
