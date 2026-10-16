import fs from "node:fs/promises";
import path from "node:path";
import { createSession, expect, test, waitForRunIdle, type EmbeddedHarness } from "./harness";

import { ScriptGate } from "./scripted-provider";

const CANARY = "inherited-native-exa-canary";
const forbidden = ["subagent", "create_goal", "orchestrator_launch"];

test.describe("inherited native web", () => {
  test.use({ exaCredential: CANARY });

  for (const behavior of ["direct", "direct-with-orchestrator"] as const) {
    for (const background of [false, true]) {
      test(`${behavior} traditional child ${background ? "background" : "foreground"} invokes both tools and continues`, async ({
        harness,
        request,
      }) => {
        const parent = await createSession(request, harness, behavior);
        const description = `Inherited research ${behavior} ${background}`;
        const endpoint = `${harness.baseUrl}/sessions/${parent}/children`;
        enqueueResearch(harness, "first", "INHERITED_FIRST", forbidden);
        if (background) enqueueAcknowledgment(harness, description, "first-done");
        const launched = await request.post(endpoint, {
          data: { profile: "general", description, prompt: "INHERITED_FIRST", background },
        });
        expect(launched.ok(), await launched.text()).toBe(true);
        const child = (await launched.json()) as { child_session_id: string };
        await waitForRunIdle(request, harness, child.child_session_id);
        if (background) await waitForRunIdle(request, harness, parent);
        enqueueResearch(harness, "second", "INHERITED_SECOND", forbidden);
        if (background) enqueueAcknowledgment(harness, description, "second-done");
        const continued = await request.post(endpoint, {
          data: {
            profile: "general",
            description,
            prompt: "INHERITED_SECOND",
            background,
            child_session_id: child.child_session_id,
          },
        });
        expect(continued.ok(), await continued.text()).toBe(true);
        expect((await continued.json()).generation).toBe(2);
        await waitForRunIdle(request, harness, child.child_session_id);
        if (background) await waitForRunIdle(request, harness, parent);
        await harness.exa!.waitForRequestCount(4);
        expect(harness.exa!.requests.map((r) => r.path)).toEqual([
          "/search",
          "/contents",
          "/search",
          "/contents",
        ]);
        expect(harness.exa!.requests.every((r) => r.apiKey === CANARY)).toBe(true);
        harness.provider.assertConsumed();
        await assertIsolated(harness, request, [parent, child.child_session_id]);
      });
    }
  }

  test("restart reattaches through the parent, rotates generation 2 and revokes generation 3", async ({
    harness,
    request,
  }) => {
    const parent = await createSession(request, harness, "direct");
    const description = "Restarted native research";
    enqueueResearch(harness, "before", "INHERITED_BEFORE", forbidden);
    const initial = await request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
      data: { profile: "general", description, prompt: "INHERITED_BEFORE", background: false },
    });
    expect(initial.ok()).toBe(true);
    const { child_session_id } = (await initial.json()) as { child_session_id: string };
    await harness.restart("1", `${CANARY}-rotated`);
    // Reattach the child before reconstructing its parent's trusted source.
    expect((await request.get(`${harness.baseUrl}/sessions/${child_session_id}`)).ok()).toBe(true);
    enqueueResearch(harness, "after", "INHERITED_AFTER", forbidden);
    const continued = await request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
      data: {
        profile: "general",
        description,
        prompt: "INHERITED_AFTER",
        child_session_id,
        background: false,
      },
    });
    expect(continued.ok(), await continued.text()).toBe(true);
    expect((await continued.json()).generation).toBe(2);
    expect(harness.exa!.requests.map((r) => r.apiKey)).toEqual([
      CANARY,
      CANARY,
      `${CANARY}-rotated`,
      `${CANARY}-rotated`,
    ]);
    await harness.restart("1", null);
    harness.provider.enqueue(
      "revoked",
      {
        token: "INHERITED_REVOKED",
        requiredTools: ["read"],
        forbiddenTools: ["web_search", "web_fetch", ...forbidden],
      },
      { kind: "text", text: "No web after parent revocation" },
    );
    const revoked = await request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
      data: {
        profile: "general",
        description,
        prompt: "INHERITED_REVOKED",
        child_session_id,
        background: false,
      },
    });
    expect(revoked.ok(), await revoked.text()).toBe(true);
    expect((await revoked.json()).generation).toBe(3);
    expect(harness.exa!.requests).toHaveLength(4);
    harness.provider.assertConsumed();
    await assertIsolated(harness, request, [parent, child_session_id]);
  });

  test("steering keeps the current child generation and admitted native web tools", async ({
    harness,
    request,
  }) => {
    const parent = await createSession(request, harness, "direct-with-orchestrator");
    const description = "Steered research";
    const gate = new ScriptGate();
    harness.provider.enqueue(
      "steer-search",
      { token: "INHERITED_STEER_START", requiredTools: ["web_search", "web_fetch"] },
      {
        kind: "function_call",
        name: "web_search",
        callId: "steer-search",
        arguments: { query: "E2E_SEARCH_SUCCESS" },
      },
      gate,
    );
    harness.provider.enqueue(
      "steer-fetch",
      {
        functionOutputCallId: "steer-search",
        token: "INHERITED_STEER_INPUT",
        requiredTools: ["web_search", "web_fetch"],
        forbiddenTools: forbidden,
      },
      {
        kind: "function_call",
        name: "web_fetch",
        callId: "steer-fetch",
        arguments: { url: "https://www.rust-lang.org/learn" },
      },
    );
    harness.provider.enqueue(
      "steer-done",
      { functionOutputCallId: "steer-fetch" },
      { kind: "text", text: "Steered research complete" },
    );
    enqueueAcknowledgment(harness, description, "steer-done");
    const endpoint = `${harness.baseUrl}/sessions/${parent}/children`;
    const launched = await request.post(endpoint, {
      data: { profile: "general", description, prompt: "INHERITED_STEER_START", background: true },
    });
    expect(launched.ok()).toBe(true);
    const { child_session_id } = (await launched.json()) as { child_session_id: string };
    await gate.accepted;
    const steered = await request.post(endpoint, {
      data: {
        profile: "general",
        description,
        prompt: "INHERITED_STEER_INPUT",
        background: true,
        child_session_id,
      },
    });
    expect(steered.ok(), await steered.text()).toBe(true);
    expect((await steered.json()).generation).toBe(1);
    gate.release();
    await waitForRunIdle(request, harness, child_session_id);
    await waitForRunIdle(request, harness, parent);
    expect(harness.exa!.requests.map((entry) => entry.path)).toEqual(["/search", "/contents"]);
    harness.provider.assertConsumed();
    await assertIsolated(harness, request, [parent, child_session_id]);
  });

  test("cancels an inherited child request without retaining its key", async ({
    harness,
    request,
  }) => {
    const parent = await createSession(request, harness, "direct");
    const description = "Cancel native research";
    harness.provider.enqueue(
      "hanging",
      { token: "INHERITED_CANCEL", requiredTools: ["web_search", "web_fetch"] },
      {
        kind: "function_call",
        name: "web_search",
        callId: "inherited-hanging",
        arguments: { query: "E2E_HANGING_EXA" },
      },
    );
    enqueueAcknowledgment(harness, description, "hanging");
    const launched = await request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
      data: { profile: "general", description, prompt: "INHERITED_CANCEL", background: true },
    });
    expect(launched.ok()).toBe(true);
    const { child_session_id } = (await launched.json()) as { child_session_id: string };
    await harness.exa!.hangingRequestAccepted;
    const cancelled = await request.post(
      `${harness.baseUrl}/sessions/${parent}/children/${child_session_id}/cancel`,
    );
    expect(cancelled.ok(), await cancelled.text()).toBe(true);
    await harness.exa!.hangingRequestClosed;
    await waitForRunIdle(request, harness, child_session_id);
    await waitForRunIdle(request, harness, parent);
    expect(harness.exa!.requests).toHaveLength(1);
    harness.provider.assertConsumed();
    await assertIsolated(harness, request, [parent, child_session_id]);
  });

  for (const managedNativeWeb of [true, false]) {
    test.describe(`${managedNativeWeb ? "managed" : "ordinary local"} dispatch`, () => {
      test.use({ managedNativeWeb });
      test("managed orchestrator inherits both tools and forwards only its admitted snapshot to a worker", async ({
        harness,
        request,
      }) => {
        const parent = await createSession(request, harness, "direct-with-orchestrator");
        enqueueResearch(
          harness,
          "orchestrator",
          "INHERITED_ORCHESTRATOR",
          ["subagent", "create_goal", "orchestrator_launch"],
          false,
        );
        harness.provider.enqueue(
          "workset",
          { functionOutputCallId: "orchestrator-fetch" },
          {
            kind: "function_call",
            name: "workset_define",
            callId: "inherited-workset",
            arguments: {
              id: "inherited",
              goal: "Research with native web",
              status: "running",
              summary: "Delegated research",
              verification_recipe: "Invoke both native web tools",
              workset_items: [
                {
                  title: "Research",
                  scope: "web",
                  description: "Run a real inherited worker",
                  role: "verification",
                  depends_on: [],
                  acceptance: "Both web tools succeed",
                },
              ],
            },
          },
        );
        harness.provider.enqueue(
          "dispatch",
          { functionOutputCallId: "inherited-workset" },
          {
            kind: "function_call",
            name: "thread",
            callId: "inherited-thread",
            arguments: {
              name: "inherited-worker",
              action: "INHERITED_WORKER research with both tools",
            },
          },
        );
        enqueueResearch(harness, "worker", "INHERITED_WORKER", forbidden);
        harness.provider.enqueue(
          "orchestrator-done",
          { functionOutputCallId: "inherited-thread" },
          { kind: "text", text: "research complete" },
        );
        const launched = await request.post(`${harness.baseUrl}/sessions/${parent}/orchestrators`, {
          data: {
            description: "Native research",
            prompt: "INHERITED_ORCHESTRATOR",
            background: false,
          },
          timeout: 30_000,
        });
        expect(launched.ok(), await launched.text()).toBe(true);
        const child = (await launched.json()) as {
          orchestrator_session_id: string;
          status: string;
        };
        expect(child.status).toBe("completed");
        await harness.exa!.waitForRequestCount(4);
        expect(harness.exa!.requests.every((r) => r.apiKey === CANARY)).toBe(true);
        harness.provider.assertConsumed();
        await harness.waitForNoWorkerProcesses();
        await assertIsolated(harness, request, [parent, child.orchestrator_session_id]);
      });
    });
  }
});

function enqueueResearch(
  harness: EmbeddedHarness,
  id: string,
  token: string,
  forbiddenTools: string[],
  finish = true,
) {
  harness.provider.enqueue(
    `${id}-search`,
    {
      token,
      requiredTools: [id === "orchestrator" ? "thread" : "read", "web_search", "web_fetch"],
      forbiddenTools,
    },
    {
      kind: "function_call",
      name: "web_search",
      callId: `${id}-search`,
      arguments: { query: "E2E_SEARCH_SUCCESS", num_results: 1 },
    },
  );
  harness.provider.enqueue(
    `${id}-fetch`,
    { functionOutputCallId: `${id}-search` },
    {
      kind: "function_call",
      name: "web_fetch",
      callId: `${id}-fetch`,
      arguments: { url: "https://www.rust-lang.org/learn" },
    },
  );
  if (finish)
    harness.provider.enqueue(
      `${id}-done`,
      { functionOutputCallId: `${id}-fetch` },
      { kind: "text", text: `${id} research complete` },
    );
}

function enqueueAcknowledgment(harness: EmbeddedHarness, description: string, afterStep: string) {
  harness.provider.enqueue(
    `${afterStep}-ack`,
    { token: description, afterStep },
    { kind: "text", text: "Research acknowledged" },
  );
}

async function assertIsolated(
  harness: EmbeddedHarness,
  request: Parameters<typeof createSession>[0],
  sessions: string[],
) {
  expect(JSON.stringify(harness.provider.requests)).not.toContain(CANARY);
  for (const entry of harness.provider.requests) {
    if (entry.matchedStep?.endsWith("-done") || entry.matchedStep === "workset") {
      const body = JSON.stringify(entry.body);
      expect(body).toContain("final_url");
      expect(body).toContain("retrieved_at_unix_ms");
      expect(body).not.toContain("Error: web_fetch failed");
    }
  }
  expect(harness.output.join("")).not.toContain(CANARY);
  for (const session of sessions) {
    for (const suffix of [
      "?include_system=true",
      "/messages?include_system=true&limit=200",
      "/events?limit=500",
    ]) {
      const response = await request.get(`${harness.baseUrl}/sessions/${session}${suffix}`);
      expect(response.ok()).toBe(true);
      expect(await response.text()).not.toContain(CANARY);
    }
  }
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile()) {
        try {
          expect((await fs.readFile(file)).indexOf(CANARY), file).toBe(-1);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  };
  await scan(harness.runRoot);
}

test("missing parent credentials grant neither traditional nor managed subagents native web", async ({
  harness,
  request,
}) => {
  const parent = await createSession(request, harness, "direct-with-orchestrator");
  for (const kind of ["children", "orchestrators"] as const) {
    harness.provider.enqueue(
      kind,
      {
        token: `NO_INHERITED_WEB_${kind}`,
        requiredTools: kind === "children" ? ["read"] : ["thread"],
        forbiddenTools: ["web_search", "web_fetch"],
      },
      { kind: "text", text: "No inherited native web" },
    );
    const response = await request.post(`${harness.baseUrl}/sessions/${parent}/${kind}`, {
      data: {
        ...(kind === "children" ? { profile: "general" } : {}),
        description: kind,
        prompt: `NO_INHERITED_WEB_${kind}`,
        background: false,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).status).toBe("completed");
  }
  harness.provider.assertConsumed();
});
