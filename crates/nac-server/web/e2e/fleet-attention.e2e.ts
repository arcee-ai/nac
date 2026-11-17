import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { pendingByRoot } from "../src/app/services/queries/fleetAttentionModel";
import type { FleetAttentionSession } from "../src/app/types/api";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

type FleetSession = FleetAttentionSession;

// Each tab keeps its own browser EventSource on the fleet stream and applies
// frames exactly as a client would: snapshot replaces, changes upsert/remove.
async function observeFleet(tab: Page): Promise<void> {
  await tab.evaluate(() => {
    const state: { sessions: Record<string, unknown>; snapshots: number; live: boolean } = {
      sessions: {},
      snapshots: 0,
      live: false,
    };
    const source = new EventSource("/attention/stream");
    source.addEventListener("fleet_attention", (event) => {
      const frame = JSON.parse((event as unknown as { data: string }).data);
      if (frame.kind === "snapshot") {
        state.snapshots += 1;
        state.sessions = Object.fromEntries(
          frame.sessions.map((session: { session_id: string }) => [session.session_id, session]),
        );
      } else if (frame.kind === "changes") {
        for (const session of frame.upserts) state.sessions[session.session_id] = session;
        for (const id of frame.removed) delete state.sessions[id];
      }
      state.live = true;
    });
    Object.assign(globalThis, { __fleet: state, __fleetSource: source });
  });
}

async function fleetSession(tab: Page, id: string): Promise<FleetSession | undefined> {
  return tab.evaluate(
    (session) =>
      (globalThis as unknown as { __fleet: { sessions: Record<string, FleetSession> } }).__fleet
        .sessions[session],
    id,
  );
}

const pendingPermissions = (session: FleetSession | undefined) =>
  (session?.pending ?? []).filter((decision) => decision.kind === "permission");

test("two tabs see a pending approval appear and resolve through fleet attention", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const file = path.join(harness.runRoot, "fleet-attention-permission.txt");
  await fs.writeFile(file, "fleet attention fixture\n");
  harness.provider.enqueue(
    "fleet-ask",
    { token: "FLEET_ATTENTION_TOKEN" },
    {
      kind: "function_call",
      name: "read",
      callId: "fleet-read",
      arguments: { path: file },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "fleet-done",
    { functionOutputCallId: "fleet-read" },
    { kind: "text", text: "fleet attention finished", stream: "request" },
  );
  const session = await createDirectSession(request, harness);

  // The session view is the interactive client that lets the Ask become
  // pending; fleet observers alone never satisfy that requirement.
  const connected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/sessions/${session}/events/stream` && response.ok(),
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}`);
  await connected;
  const second = await page.context().newPage();
  await second.goto(`${harness.baseUrl}/`);
  for (const tab of [page, second]) {
    await observeFleet(tab);
    await expect
      .poll(async () => (await fleetSession(tab, session))?.availability.permissions)
      .toBe("available");
  }

  const submitted = await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
    data: { prompt: "FLEET_ATTENTION_TOKEN" },
  });
  expect(submitted.status()).toBe(202);
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${session}/permissions`);
      return ((await response.json()) as { requests: unknown[] }).requests.length;
    })
    .toBe(1);
  const permissions = await request.get(`${harness.baseUrl}/sessions/${session}/permissions`);
  const exact = ((await permissions.json()) as { requests: Array<{ id: string }> }).requests[0].id;

  for (const tab of [page, second]) {
    await expect
      .poll(async () => pendingPermissions(await fleetSession(tab, session)))
      .toEqual([{ kind: "permission", request_id: exact }]);
    // The same identity is in the polling fallback snapshot read by the tab.
    const snapshot = await tab.evaluate(
      async () => (await (await fetch("/attention")).json()) as { sessions: FleetSession[] },
    );
    const current = snapshot.sessions.find((entry) => entry.session_id === session);
    expect(pendingPermissions(current)).toEqual([{ kind: "permission", request_id: exact }]);
    expect(JSON.stringify(snapshot)).not.toContain(file);
  }

  const reply = await request.post(`${harness.baseUrl}/sessions/${session}/permissions/${exact}`, {
    data: { reply: "reject" },
  });
  expect(reply.status()).toBe(204);
  for (const tab of [page, second]) {
    await expect.poll(async () => pendingPermissions(await fleetSession(tab, session))).toEqual([]);
    expect(
      await tab.evaluate(
        () => (globalThis as unknown as { __fleet: { snapshots: number } }).__fleet.snapshots,
      ),
    ).toBeGreaterThanOrEqual(1);
  }
  await waitForRunIdle(request, harness, session);
  await second.close();
});

async function fleetSessions(tab: Page): Promise<Map<string, FleetSession>> {
  const sessions = await tab.evaluate(
    () =>
      (globalThis as unknown as { __fleet: { sessions: Record<string, FleetSession> } }).__fleet
        .sessions,
  );
  return new Map(Object.entries(sessions));
}

test("a child's approval appears under the child, rolls up to its root, and resolves", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const file = path.join(harness.runRoot, "fleet-attention-child-permission.txt");
  await fs.writeFile(file, "fleet attention child fixture\n");
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "fleet-child-ask",
    { token: "FLEET_CHILD_TOKEN" },
    {
      kind: "function_call",
      name: "read",
      callId: "fleet-child-read",
      arguments: { path: file },
      stream: "request",
    },
    gate,
  );
  harness.provider.enqueue(
    "fleet-child-done",
    { functionOutputCallId: "fleet-child-read" },
    { kind: "text", text: "child finished", stream: "request" },
  );
  const parent = await createDirectSession(request, harness);
  const description = "Fleet attention child approval journey";
  const started = request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
    data: { profile: "general", description, prompt: "FLEET_CHILD_TOKEN", background: false },
    timeout: 90_000,
  });
  await harness.provider.waitForRequestCount(1);
  const children = (await (
    await request.get(`${harness.baseUrl}/sessions/${parent}/children`)
  ).json()) as Array<{ child_session_id: string; description: string }>;
  const child = children.find((entry) => entry.description === description)!.child_session_id;
  // The delegated parent view is the child's interactive client; hold the
  // model until that stream is live so the Ask stays pending.
  const connected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/sessions/${child}/events/stream` && response.ok(),
  );
  await page.goto(`${harness.baseUrl}/#/session/${parent}/delegated`);
  await connected;
  const second = await page.context().newPage();
  await second.goto(`${harness.baseUrl}/`);
  for (const tab of [page, second]) {
    await observeFleet(tab);
    await expect.poll(async () => (await fleetSession(tab, child))?.session_id).toBe(child);
  }
  gate.release();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${child}/permissions`);
      return ((await response.json()) as { requests: unknown[] }).requests.length;
    })
    .toBe(1);
  const permissions = await request.get(`${harness.baseUrl}/sessions/${child}/permissions`);
  const exact = ((await permissions.json()) as { requests: Array<{ id: string }> }).requests[0].id;

  for (const tab of [page, second]) {
    await expect
      .poll(async () => pendingPermissions(await fleetSession(tab, child)))
      .toEqual([{ kind: "permission", request_id: exact }]);
    const sessions = await fleetSessions(tab);
    const entry = sessions.get(child)!;
    expect(entry.session_id).toBe(child);
    expect(entry.lineage).toEqual({
      kind: "traditional-child",
      parent_session_id: parent,
      root_session_id: parent,
    });
    expect(entry.availability.permissions).toBe("available");
    // Attributed to the child only, and rolled up to its root for the Inbox.
    expect(pendingPermissions(sessions.get(parent))).toEqual([]);
    const roots = pendingByRoot(sessions);
    expect(roots.get(parent)?.map((session) => session.session_id)).toEqual([child]);
    expect(roots.has(child)).toBe(false);
  }

  const reply = await request.post(`${harness.baseUrl}/sessions/${child}/permissions/${exact}`, {
    data: { reply: "reject" },
  });
  expect(reply.status()).toBe(204);
  for (const tab of [page, second]) {
    await expect.poll(async () => pendingPermissions(await fleetSession(tab, child))).toEqual([]);
    expect(pendingByRoot(await fleetSessions(tab)).has(parent)).toBe(false);
  }
  expect((await started).status()).toBe(201);
  await second.close();
});
