import fs from "node:fs/promises";
import path from "node:path";

import {
  createProject,
  createSession,
  expect,
  type EmbeddedHarness,
  test,
  waitForRunIdle,
} from "./harness";

const EXA_CANARY = "production-e2e-exa-canary";

test.describe("managed native Exa delegation", () => {
  test.use({ exaCredential: EXA_CANARY });

  test("runs real worker search/fetch and retains malformed errors without the credential", async ({
    harness,
    request,
  }) => {
    const exa = requireExa(harness);
    enqueueDispatch(harness, "success", "E2E_WORKER_EXA_SUCCESS");
    harness.provider.enqueue(
      "worker-search",
      {
        token: "E2E_WORKER_EXA_SUCCESS",
        requiredTools: ["read", "web_search", "web_fetch"],
      },
      {
        kind: "function_call",
        name: "web_search",
        callId: "exa-search-success",
        arguments: { query: "E2E_SEARCH_SUCCESS", num_results: 1 },
      },
    );
    harness.provider.enqueue(
      "worker-fetch",
      { functionOutputCallId: "exa-search-success" },
      {
        kind: "function_call",
        name: "web_fetch",
        callId: "exa-fetch-success",
        arguments: { url: "https://www.rust-lang.org/learn?request-detail=provider-only" },
      },
    );
    harness.provider.enqueue(
      "worker-malformed",
      { functionOutputCallId: "exa-fetch-success" },
      {
        kind: "function_call",
        name: "web_search",
        callId: "exa-search-malformed",
        arguments: { query: "E2E_MALFORMED_EXA", num_results: 1 },
      },
    );
    harness.provider.enqueue(
      "worker-finished",
      { functionOutputCallId: "exa-search-malformed" },
      { kind: "text", text: "managed Exa worker completed after the malformed response" },
    );
    harness.provider.enqueue(
      "orchestrator-finished",
      { functionOutputCallId: "exa-thread-success" },
      { kind: "text", text: "managed Exa orchestration completed" },
    );

    const projectId = await createProject(request, harness);
    const sessionId = await createSession(request, harness, "orchestrator", projectId);
    const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
      data: { prompt: "E2E_MANAGED_EXA_success" },
    });
    expect(submitted.status()).toBe(202);
    await harness.provider.waitForRequestCount(7);
    await exa.waitForRequestCount(3);
    await waitForRunIdle(request, harness, sessionId);
    harness.provider.assertConsumed();

    expect(exa.requests.map((entry) => entry.path)).toEqual(["/search", "/contents", "/search"]);
    expect(exa.requests.every((entry) => entry.apiKey === EXA_CANARY)).toBe(true);
    const malformedResult = harness.provider.requests.find(
      (entry) => entry.matchedStep === "worker-finished",
    );
    expect(JSON.stringify(malformedResult?.body)).toContain("invalid bounded JSON response");
    expect(JSON.stringify(malformedResult?.body)).not.toContain(EXA_CANARY);

    await assertCanaryAbsentFromRetainedState(harness, request, sessionId, "exa-worker-success");
    await harness.waitForNoWorkerProcesses();
  });

  test("cancels a hanging worker request and reaps its background descendant", async ({
    harness,
    request,
  }) => {
    const exa = requireExa(harness);
    enqueueDispatch(harness, "cancel", "E2E_WORKER_EXA_CANCEL");
    harness.provider.enqueue(
      "worker-background-descendant",
      { token: "E2E_WORKER_EXA_CANCEL", requiredTools: ["exec_command", "web_search"] },
      {
        kind: "function_call",
        name: "exec_command",
        callId: "exa-background-process",
        arguments: { cmd: "sleep 300", tty: true, yield_time_ms: 100 },
      },
    );
    harness.provider.enqueue(
      "worker-hanging-search",
      { functionOutputCallId: "exa-background-process" },
      {
        kind: "function_call",
        name: "web_search",
        callId: "exa-search-hanging",
        arguments: { query: "E2E_HANGING_EXA", num_results: 1 },
      },
    );

    const projectId = await createProject(request, harness);
    const sessionId = await createSession(request, harness, "orchestrator", projectId);
    const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
      data: { prompt: "E2E_MANAGED_EXA_cancel" },
    });
    expect(submitted.status()).toBe(202);
    await withTimeout(exa.hangingRequestAccepted, 15_000, "hanging Exa request");

    const cancelled = await request.post(
      `${harness.baseUrl}/sessions/${sessionId}/cancel-active-run`,
    );
    expect(cancelled.ok()).toBe(true);
    await withTimeout(exa.hangingRequestClosed, 10_000, "cancelled Exa connection close");
    await waitForRunIdle(request, harness, sessionId);
    await harness.waitForNoWorkerProcesses();
    harness.provider.assertConsumed();
    expect(exa.requests).toHaveLength(1);
    expect(exa.requests[0]).toMatchObject({ path: "/search", apiKey: EXA_CANARY });

    await assertCanaryAbsentFromRetainedState(harness, request, sessionId, "exa-worker-cancel");
  });
});

function enqueueDispatch(harness: EmbeddedHarness, suffix: string, workerToken: string): void {
  harness.provider.enqueue(
    `orchestrator-workset-${suffix}`,
    { token: `E2E_MANAGED_EXA_${suffix}`, requiredTools: ["thread", "workset_define"] },
    {
      kind: "function_call",
      name: "workset_define",
      callId: `exa-workset-${suffix}`,
      arguments: {
        id: `managed-exa-${suffix}`,
        goal: "Exercise managed Exa delegation through a real worker",
        status: "running",
        summary: "Managed Exa production-path integration",
        verification_recipe: "Inspect the retained worker episode and provider requests",
        workset_items: [
          {
            title: "Exercise Exa worker",
            scope: "native web retrieval",
            description: "Run the branch-built worker through the local TLS Exa double.",
            role: "verification",
            depends_on: [],
            acceptance: "The worker completes without retaining its delegated credential.",
          },
        ],
      },
    },
  );
  harness.provider.enqueue(
    `orchestrator-thread-${suffix}`,
    { functionOutputCallId: `exa-workset-${suffix}` },
    {
      kind: "function_call",
      name: "thread",
      callId: `exa-thread-${suffix}`,
      arguments: {
        name: `exa-worker-${suffix}`,
        action: `${workerToken} use the native Exa tools exactly as scripted`,
      },
    },
  );
}

function requireExa(harness: EmbeddedHarness) {
  if (harness.exa == null) throw new Error("managed Exa double was not started");
  return harness.exa;
}

async function assertCanaryAbsentFromRetainedState(
  harness: EmbeddedHarness,
  request: Parameters<typeof createProject>[0],
  sessionId: string,
  threadName: string,
): Promise<void> {
  const surfaces = [
    `/sessions/${sessionId}?include_system=true&message_limit=200&thread_event_limit=200`,
    `/sessions/${sessionId}/messages?include_system=true&limit=200`,
    `/sessions/${sessionId}/events?limit=500`,
    `/sessions/${sessionId}/threads/${encodeURIComponent(threadName)}/events?limit=500`,
  ];
  const responses = await Promise.all(
    surfaces.map(async (surface) => {
      const response = await request.get(`${harness.baseUrl}${surface}`);
      expect(response.ok(), `${surface} returned ${response.status()}`).toBe(true);
      return response.text();
    }),
  );
  const modelRequests = JSON.stringify(harness.provider.requests);
  const retainedText = [harness.output.join(""), modelRequests, ...responses].join("\n");
  expect(retainedText).not.toContain(EXA_CANARY);

  for (const file of await regularFiles(harness.runRoot)) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    expect(bytes.indexOf(EXA_CANARY), `credential was retained in ${file}`).toBe(-1);
  }
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  await visit(root);
  return files;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}
