import { waitForDelegatedInput } from "./delegation-observation";
import { createSession, expect, showSubagents, test } from "./harness";
import { ScriptGate } from "./scripted-provider";

for (const [name, viewport, mobile] of [
  ["desktop", { width: 1280, height: 720 }, false],
  ["phone", { width: 390, height: 844 }, true],
] as const) {
  test(`continues, steers and deliberately stops an existing managed orchestrator on ${name}`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    const parentId = await createSession(request, harness, "direct-with-orchestrator");
    const endpoint = `${harness.baseUrl}/sessions/${parentId}/orchestrators`;
    const ids: string[] = [];
    for (const label of ["Older", "Newer"]) {
      const token = `E2E_MANAGED_${label.toUpperCase()}`;
      harness.provider.enqueue(token, { token }, { kind: "text", text: `${label} completed` });
      const response = await request.post(endpoint, {
        data: { description: `${label} coordinator`, prompt: token, background: false },
      });
      expect(response.status()).toBe(201);
      const record = (await response.json()) as { orchestrator_session_id: string; status: string };
      expect(record.status).toBe("completed");
      ids.push(record.orchestrator_session_id);
    }
    const targetId = ids[0];
    const continuation = new ScriptGate();
    const continued = new ScriptGate();
    harness.provider.enqueue(
      "managed-continuation-boundary",
      { token: "E2E_MANAGED_CONTINUE" },
      {
        kind: "function_call",
        name: "unknown_alpha",
        callId: "managed-panel-boundary",
        arguments: {},
        stream: "request",
      },
      continuation,
    );
    harness.provider.enqueue(
      "managed-steer-consumed",
      { token: "E2E_MANAGED_STEER", functionOutputCallId: "managed-panel-boundary" },
      { kind: "text", text: "managed panel steering completed", stream: "request" },
      continued,
    );

    await page.setViewportSize(viewport);
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
    await showSubagents(page, mobile);
    const list = mobile
      ? page.getByRole("dialog", { name: "Subagents", exact: true })
      : page.locator("body");
    await list.getByRole("button", { name: "Older coordinator", exact: true }).click();
    const composer = page.locator("form").filter({
      has: page.getByRole("textbox", { name: /^(Send|Steer) a message$/ }),
    });
    const starts: Array<{ status: number; id: string; generation: number; outcome: string }> = [];
    await page.route(`**/sessions/${parentId}/orchestrators`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { orchestrator_session_id: string };
      expect(body.orchestrator_session_id).toBe(targetId);
      const response = await route.fetch();
      const record = (await response.json()) as { generation: number; status: string };
      starts.push({
        status: response.status(),
        id: body.orchestrator_session_id,
        generation: record.generation,
        outcome: record.status,
      });
      await route.fulfill({ response });
    });
    await composer.getByRole("textbox", { name: "Send a message" }).fill("E2E_MANAGED_CONTINUE");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await continuation.accepted;
    await expect(composer.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(composer.getByRole("textbox", { name: "Send a message" })).toBeEnabled();

    // The transcript and panel share draft ownership, without replaying the pending continuation.
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${targetId}/`));
    if (mobile) {
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    }
    await expect(page.getByRole("textbox", { name: "Send a message" })).toHaveValue("");
    await page.getByRole("button", { name: "Parent chat" }).click();
    await showSubagents(page, mobile);
    // A phone reopens the panel on its list; the row brings back its composer.
    if (mobile) await list.getByRole("button", { name: "Older coordinator", exact: true }).click();
    const screenshot = testInfo.outputPath("subagent-running.png");
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("Existing managed orchestrator during a foreground continuation", {
      path: screenshot,
      contentType: "image/png",
    });
    await composer.getByRole("textbox", { name: "Send a message" }).fill("E2E_MANAGED_STEER");
    const steerButton = composer.getByRole("button", { name: "Steer", exact: true });
    await steerButton.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await waitForDelegatedInput(harness, "orchestrator", targetId, "E2E_MANAGED_STEER");
    await expect(composer.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    continuation.release();
    await continued.accepted;
    await expect(composer.getByRole("textbox", { name: "Send a message" })).toHaveValue("");
    continued.release();
    await expect.poll(() => starts.length).toBe(2);
    expect(starts).toEqual([
      { status: 201, id: targetId, generation: 2, outcome: "completed" },
      { status: 201, id: targetId, generation: 2, outcome: "completed" },
    ]);

    const stopping = new ScriptGate();
    harness.provider.enqueue(
      "managed-stop-boundary",
      { token: "E2E_MANAGED_STOP" },
      { kind: "text", text: "must be cancelled", stream: "request" },
      stopping,
    );
    await composer.getByRole("textbox", { name: "Send a message" }).fill("E2E_MANAGED_STOP");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await stopping.accepted;
    await composer.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => starts.length).toBe(3);
    expect(starts[2]).toEqual({ status: 201, id: targetId, generation: 3, outcome: "cancelled" });
    stopping.release();
    const records = (await (await request.get(endpoint)).json()) as Array<{
      orchestrator_session_id: string;
      parent_session_id: string;
      generation: number;
      status: string;
    }>;
    expect(records).toHaveLength(2);
    expect(records).toContainEqual(
      expect.objectContaining({
        orchestrator_session_id: targetId,
        parent_session_id: parentId,
        generation: 3,
        status: "cancelled",
      }),
    );
    expect(harness.provider.requests.map((entry) => entry.matchedStep)).toEqual([
      "E2E_MANAGED_OLDER",
      "E2E_MANAGED_NEWER",
      "managed-continuation-boundary",
      "managed-steer-consumed",
      "managed-stop-boundary",
    ]);
    harness.provider.assertConsumed();
  });
}
