import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";

type FleetSession = {
  session_id: string;
  pending: Array<{ kind: string; request_id?: string }>;
  availability: Record<string, string>;
};

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
