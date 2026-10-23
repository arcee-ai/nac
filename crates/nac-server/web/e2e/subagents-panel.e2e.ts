import type { Page } from "@playwright/test";

import { waitForDelegatedInput } from "./delegation-observation";
import { createSession, expect, showSubagents, startForegroundChild, test } from "./harness";
import { ScriptGate } from "./scripted-provider";

/** The narrow list: a dialog of its own on a phone, the panel's own column on a tablet. */
function subagentList(page: Page, mobile: boolean) {
  return mobile
    ? page.getByRole("dialog", { name: "Subagents", exact: true })
    : page.locator("body");
}

for (const [name, viewport, mobile] of [
  ["tablet", { width: 1024, height: 900 }, false],
  ["phone", { width: 390, height: 844 }, true],
] as const) {
  test(`keeps a failed Subagents load explained and retryable from the ${name} list`, async ({
    harness,
    page,
    request,
  }) => {
    harness.provider.enqueue(
      "listed-child",
      { token: "E2E_LISTED_CHILD" },
      { kind: "text", text: "listed child completed" },
    );
    const parentId = await createSession(request, harness, "direct");
    const started = await startForegroundChild(
      request,
      harness,
      parentId,
      "Listed child",
      "E2E_LISTED_CHILD",
    );
    expect(started.ok()).toBe(true);

    let failing = true;
    let failures = 0;
    await page.route(`**/sessions/${parentId}/children`, async (route) => {
      if (route.request().method() !== "GET" || !failing) return route.fallback();
      failures += 1;
      await route.fulfill({ status: 503, body: "unavailable" });
    });
    await page.setViewportSize(viewport);
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
    await showSubagents(page, mobile);
    await expect(
      page.getByRole("alert").filter({ hasText: "Subagents could not be loaded" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Open list", exact: true }).click();
    const list = subagentList(page, mobile);
    const alert = list.getByRole("alert").filter({ hasText: "Subagents could not be loaded" });
    await expect(alert).toBeVisible();
    await expect(page.getByText("No subagents yet", { exact: true })).toHaveCount(0);

    const retry = alert.getByRole("button", { name: "Try again" });
    await expect(retry).toBeInViewport({ ratio: 1 });
    // Recover just after a failed poll, so the click rather than the 1s poll restores rows.
    await page.waitForResponse(
      (response) =>
        response.url().endsWith(`/sessions/${parentId}/children`) && response.status() === 503,
    );
    failing = false;
    await retry.click();
    const row = list.getByRole("button", { name: "Listed child", exact: true });
    await expect(row).toBeVisible();
    await expect(alert).toHaveCount(0);

    // A failed poll keeps the rows it already has.
    failing = true;
    const failedBefore = failures;
    await expect.poll(() => failures, { timeout: 10_000 }).toBeGreaterThan(failedBefore + 1);
    await expect(row).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Subagents could not be loaded" }),
    ).toHaveCount(0);
    await expect(page.getByText("No subagents yet", { exact: true })).toHaveCount(0);
    harness.provider.assertConsumed();
  });
}

for (const [name, viewport, mobile] of [
  ["desktop", { width: 1280, height: 720 }, false],
  ["phone", { width: 390, height: 844 }, true],
] as const) {
  test(`continues an existing child from the panel composer after a transcript round trip on ${name}`, async ({
    harness,
    page,
    request,
  }) => {
    for (const token of ["E2E_OLDER_CHILD", "E2E_NEWER_CHILD"]) {
      harness.provider.enqueue(
        token,
        { token },
        { kind: "text", text: `${token.toLowerCase()} completed` },
      );
    }
    // The continued run stops at a tool call until released, so the foreground start stays pending.
    const running = new ScriptGate();
    harness.provider.enqueue(
      "panel-continuation",
      { token: "E2E_PANEL_CONTINUATION" },
      {
        kind: "function_call",
        name: "unknown_alpha",
        callId: "panel-continuation-1",
        arguments: {},
        stream: true,
      },
      running,
    );
    harness.provider.enqueue(
      "panel-continuation-done",
      {
        functionOutputCallId: "panel-continuation-1",
        afterStep: "panel-continuation",
      },
      { kind: "text", text: "panel continuation completed", stream: "request" },
    );
    harness.provider.enqueue(
      "panel-steer",
      { token: "E2E_PANEL_STEER" },
      { kind: "text", text: "panel steer completed", stream: "request" },
    );
    const parentId = await createSession(request, harness, "direct");
    const older = await startForegroundChild(
      request,
      harness,
      parentId,
      "Older child",
      "E2E_OLDER_CHILD",
    );
    expect(older.ok()).toBe(true);
    const olderId = ((await older.json()) as { child_session_id: string }).child_session_id;
    const newer = await startForegroundChild(
      request,
      harness,
      parentId,
      "Newer child",
      "E2E_NEWER_CHILD",
    );
    expect(newer.ok()).toBe(true);

    await page.setViewportSize(viewport);
    await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
    await showSubagents(page, mobile);
    if (mobile) await page.getByRole("button", { name: "Open list", exact: true }).click();
    // The newest child opens by default; pick the other one.
    await subagentList(page, mobile)
      .getByRole("button", { name: "Older child", exact: true })
      .click();
    // The panel's composer, not the parent's own.
    const composer = page.locator("form").filter({
      has: page.getByRole("switch", { name: "Run in the background" }),
    });
    const draft = composer.getByRole("textbox", { name: "Send a message" });
    await draft.fill("E2E_PANEL_CONTINUATION continue from the panel");

    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${olderId}/`));
    if (mobile) {
      // The phone's panel stays open over the transcript it opened.
      const panel = page.getByRole("dialog");
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await expect(panel).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Parent chat" }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${parentId}/delegated$`));
    await showSubagents(page, mobile);
    await expect(page.getByText("Older child", { exact: true }).first()).toBeVisible();
    await expect(draft).toHaveValue("E2E_PANEL_CONTINUATION continue from the panel");

    const starts: string[] = [];
    const replies: number[] = [];
    await page.route(`**/sessions/${parentId}/children`, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      starts.push(route.request().postData() ?? "");
      const response = await route.fetch();
      replies.push(response.status());
      await route.fulfill({ response });
    });

    // A plain click also proves nothing, such as the phone's tab bar, covers the button.
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    await running.accepted;
    // The sent message left the field; the running child's composers take the next one.
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/session/${olderId}/`));
    if (mobile) {
      const panel = page.getByRole("dialog");
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await expect(panel).toHaveCount(0);
    }
    const childDraft = page.getByRole("textbox", { name: "Steer a message" });
    await expect(childDraft).toHaveValue("");
    await expect(childDraft).toBeEnabled();
    await page.getByRole("button", { name: "Parent chat" }).click();
    await showSubagents(page, mobile);
    // A running composer has no background switch; its Steer field is the only one on the page.
    const steer = page.getByRole("textbox", { name: "Steer a message" });
    await expect(steer).toHaveValue("");
    await expect(steer).toBeEnabled();
    await steer.fill("E2E_PANEL_STEER check the cache too");
    await page.getByRole("button", { name: "Steer", exact: true }).click();
    await expect.poll(() => starts.length).toBe(2);
    expect(starts.map((body) => (JSON.parse(body) as { prompt: string }).prompt)).toEqual([
      "E2E_PANEL_CONTINUATION continue from the panel",
      "E2E_PANEL_STEER check the cache too",
    ]);
    expect(
      starts.map((body) => (JSON.parse(body) as { child_session_id: string }).child_session_id),
    ).toEqual([olderId, olderId]);

    // Observe actual durable admission, rather than racing the provider release with HTTP handling.
    await waitForDelegatedInput(harness, "child", olderId, "E2E_PANEL_STEER check the cache too");
    running.release();
    await harness.provider.waitForRequestCount(5);
    await expect(composer.getByRole("textbox", { name: "Send a message" })).toHaveValue("");
    expect(starts).toHaveLength(2);
    await expect.poll(() => replies).toEqual([201, 201]);
    await expect
      .poll(async () => {
        const response = await request.get(`${harness.baseUrl}/sessions/${parentId}/children`);
        const children = (await response.json()) as Array<{
          child_session_id: string;
          parent_session_id: string;
          generation: number;
          status: string;
        }>;
        return children.map((child) => ({
          id: child.child_session_id,
          parent: child.parent_session_id,
          generation: child.generation,
          status: child.status,
        }));
      })
      .toEqual(
        expect.arrayContaining([
          // The server runs the steer once the held turn ends, as the next generation.
          { id: olderId, parent: parentId, generation: 3, status: "completed" },
        ]),
      );
    const listed = (await (
      await request.get(`${harness.baseUrl}/sessions/${parentId}/children`)
    ).json()) as unknown[];
    expect(listed).toHaveLength(2);
    harness.provider.assertConsumed();
  });
}
