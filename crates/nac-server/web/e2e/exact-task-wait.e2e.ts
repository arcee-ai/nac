import fs from "node:fs/promises";
import path from "node:path";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

// Native tool execution plus the actual human response path. An ordinary
// interactive stream prevents navigation from dismissing the existing Ask.
test("native exact wait returns approval and human navigation revalidates it", async ({
  harness,
  page,
  request,
}, info) => {
  const project = await createProject(request, harness);
  const peer = await createSession(request, harness, "direct", project);
  const coordinator = await createSession(request, harness, "direct", project);
  const outside = path.join(harness.runRoot, "approval-target.txt");
  await fs.writeFile(outside, "fixture result\n");
  const observer = new AbortController();
  try {
    const interactive = await fetch(`${harness.baseUrl}/sessions/${peer}/events/stream`, {
      signal: observer.signal,
    });
    expect(interactive.ok).toBe(true);
    harness.provider.enqueue(
      "peer-ask",
      { token: "EXACT_WAIT_PEER" },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: "peer-read",
        arguments: { path: outside },
      },
    );
    harness.provider.enqueue(
      "peer-result",
      { functionOutputCallId: "peer-read" },
      {
        kind: "text",
        stream: "request",
        text: "peer finished after exact approval",
      },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
          data: { prompt: "EXACT_WAIT_PEER" },
        })
      ).ok(),
    ).toBe(true);
    let requestId = "";
    await expect
      .poll(async () => {
        const state = await (
          await request.get(`${harness.baseUrl}/sessions/${peer}/permissions`)
        ).json();
        requestId = state.requests?.[0]?.id ?? "";
        return requestId;
      })
      .not.toBe("");
    harness.provider.enqueue(
      "coordinator-wait",
      { token: "EXACT_WAIT_COORDINATOR", requiredTools: ["wait_tasks"] },
      {
        kind: "function_call",
        stream: "request",
        name: "wait_tasks",
        callId: "exact-wait",
        arguments: {
          targets: [
            {
              session_id: peer,
              project_id: null,
              mode: "run",
              run_id: null,
              goal_id: null,
              after_cursor: null,
            },
          ],
          timeout_ms: 30_000,
        },
      },
    );
    harness.provider.enqueue(
      "coordinator-result",
      { functionOutputCallId: "exact-wait" },
      {
        kind: "text",
        stream: "request",
        text: "exact approval is ready for the human",
      },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${coordinator}/runs`, {
          data: { prompt: "EXACT_WAIT_COORDINATOR" },
        })
      ).ok(),
    ).toBe(true);
    await waitForRunIdle(request, harness, coordinator);
    const followup = harness.provider.requests.find((r) => r.matchedStep === "coordinator-result");
    const body = JSON.stringify(followup?.body);
    expect(body).toContain("approval_attention");
    expect(body).toContain(requestId);
    expect(body).toContain("resolved_identity");
    await page.goto(
      `${harness.baseUrl}/#/session/${peer}/insights?permission_request=${requestId}`,
    );
    await expect(
      page.getByRole("dialog", { name: "Permission required", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath("exact-approval.png"), animations: "disabled" });
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await waitForRunIdle(request, harness, peer);
    expect(
      (await (await request.get(`${harness.baseUrl}/sessions/${peer}/permissions`)).json())
        .requests,
    ).toHaveLength(0);
    await page.goto(
      `${harness.baseUrl}/#/session/${peer}/insights?permission_request=${requestId}`,
    );
    await page.reload();
    await expect(page.getByText(/This permission request is no longer pending/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Loading permissions for/)).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("stale-exact-approval.png"),
      animations: "disabled",
    });
    const baselineAssets = process.env.NAC_WAIT_BASELINE_ASSETS;
    if (baselineAssets) {
      await page.route("**/assets/dist/**", async (route) => {
        const relative = new URL(route.request().url()).pathname.split("/assets/dist/")[1];
        if (!relative || relative.includes("..")) throw new Error("Invalid baseline asset path");
        await route.fulfill({ path: path.join(baselineAssets, relative) });
      });
      await page.route(harness.baseUrl + "/", (route) =>
        route.fulfill({
          path: path.join(baselineAssets, "index.html"),
          contentType: "text/html",
        }),
      );
      await page.reload();
      await page.getByRole("button", { name: "Permissions", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Permissions", exact: true })).toBeVisible();
      await expect(page.getByText(/Loading permissions for/)).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("stale-exact-approval-before.png"),
        animations: "disabled",
      });
      await page.unroute("**/assets/dist/**");
      await page.unroute(harness.baseUrl + "/");
    }
    harness.provider.assertConsumed();
  } finally {
    observer.abort();
  }
});

test("ordinary coordinator input interrupts native wait and leaves the target running", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const peer = await createSession(request, harness, "direct", project);
  const coordinator = await createSession(request, harness, "direct", project);
  const peerGate = new ScriptGate();
  const guidanceGate = new ScriptGate();
  harness.provider.enqueue(
    "held-peer",
    { token: "WAIT_HELD_PEER" },
    {
      kind: "text",
      stream: "request",
      text: "independent target completed",
    },
    peerGate,
  );
  harness.provider.enqueue(
    "long-wait",
    { token: "WAIT_LONG_COORDINATOR", requiredTools: ["wait_tasks"] },
    {
      kind: "function_call",
      stream: "request",
      name: "wait_tasks",
      callId: "long-wait",
      arguments: {
        targets: [
          {
            session_id: peer,
            project_id: null,
            mode: "run",
            run_id: null,
            goal_id: null,
            after_cursor: null,
          },
        ],
        timeout_ms: 30_000,
      },
    },
  );
  harness.provider.enqueue(
    "guidance-delivered",
    { functionOutputCallId: "long-wait" },
    {
      kind: "text",
      stream: "request",
      text: "guidance preserved after interruption",
    },
    guidanceGate,
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
        data: { prompt: "WAIT_HELD_PEER" },
      })
    ).ok(),
  ).toBe(true);
  await peerGate.accepted;
  await page.goto(`${harness.baseUrl}/#/session/${coordinator}/insights`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("WAIT_LONG_COORDINATOR");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await harness.provider.waitForRequestCount(2);
  await composer.fill("preserve this exact new guidance");
  const started = Date.now();
  await page.getByRole("button", { name: "Steer active run", exact: true }).click();
  await guidanceGate.accepted;
  expect(Date.now() - started).toBeLessThan(3_000);
  const followup = harness.provider.requests.find((r) => r.matchedStep === "guidance-delivered");
  expect(JSON.stringify(followup?.body)).toContain("coordinator_input");
  expect(JSON.stringify(followup?.body)).toContain("preserve this exact new guidance");
  const peerState = await (await request.get(`${harness.baseUrl}/sessions/${peer}`)).json();
  expect(peerState.active_run).not.toBeNull();
  guidanceGate.release();
  await waitForRunIdle(request, harness, coordinator);
  peerGate.release();
  await waitForRunIdle(request, harness, peer);
  harness.provider.assertConsumed();
});
