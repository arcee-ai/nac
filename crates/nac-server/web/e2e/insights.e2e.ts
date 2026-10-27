import type { Page } from "@playwright/test";

import { createSession, expect, test, waitForRunIdle } from "./harness";

/**
 * The right sidebar starts collapsed, so panel tabs and rows sit behind this.
 * A saved open preference can remove the button after the first paint.
 */
async function showSidePanel(page: Page) {
  const show = page.getByRole("button", { name: "Show panel" });
  const open = page.getByRole("tab", { name: "Files" });
  await expect(show.or(open).first()).toBeVisible();
  await expect(async () => {
    if (await open.isVisible()) return;
    if (await show.isVisible()) await show.click();
    await expect(open).toBeVisible();
  }).toPass();
}

test("opens old Threads links in Insights on the stored thread", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "insights-alpha-dispatch",
    { token: "E2E_INSIGHTS_THREADS_TOKEN", requiredTools: ["thread"] },
    {
      kind: "function_call",
      name: "thread",
      callId: "insights-alpha",
      arguments: { name: "alpha-thread", action: "E2E_ALPHA_THREAD_TOKEN inspect the alpha files" },
    },
  );
  harness.provider.enqueue(
    "insights-alpha-worker",
    { token: "E2E_ALPHA_THREAD_TOKEN", requiredTools: ["read"] },
    { kind: "text", text: "alpha worker completed" },
  );
  harness.provider.enqueue(
    "insights-beta-dispatch",
    { functionOutputCallId: "insights-alpha" },
    {
      kind: "function_call",
      name: "thread",
      callId: "insights-beta",
      arguments: { name: "beta-thread", action: "E2E_BETA_THREAD_TOKEN inspect the beta files" },
    },
  );
  harness.provider.enqueue(
    "insights-beta-worker",
    { token: "E2E_BETA_THREAD_TOKEN", requiredTools: ["read"] },
    { kind: "text", text: "beta worker completed" },
  );
  harness.provider.enqueue(
    "insights-orchestrator-completion",
    { functionOutputCallId: "insights-beta" },
    { kind: "text", text: "both threads reported" },
  );
  const sessionId = await createSession(request, harness, "orchestrator");
  const run = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "E2E_INSIGHTS_THREADS_TOKEN" },
  });
  expect(run.status()).toBe(202);
  await waitForRunIdle(request, harness, sessionId);
  harness.provider.assertConsumed();

  const insightsUrl = new RegExp(`/session/${sessionId}/insights$`);
  const insightsTab = page.getByRole("tab", { name: "Insights" });
  const threadDetail = page.getByRole("group", { name: "Thread detail view" });
  const alphaRow = page.getByRole("button", { name: "alpha-thread, Thread, 1" });
  const betaRow = page.getByRole("button", { name: "beta-thread, Thread, 1" });

  // A cold old link has no stored thread: Insights opens on the newest action.
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
  await expect(page).toHaveURL(insightsUrl);
  await showSidePanel(page);
  await expect(insightsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Threads" })).toHaveCount(0);
  await expect(threadDetail).toBeVisible();
  await expect(betaRow).toHaveAttribute("aria-pressed", "true");
  await expect(alphaRow).toHaveAttribute("aria-pressed", "false");

  // Pick the older thread, then let a filter that hides it clear the pick and
  // leave Insights for another panel. The thread itself stays remembered.
  await alphaRow.click();
  await expect(alphaRow).toHaveAttribute("aria-pressed", "true");
  const filter = page.getByRole("group", { name: "Show:" });
  await filter.getByRole("button", { name: "All actions" }).click();
  await page.getByRole("button", { name: "Tools & reasoning", exact: true }).click();
  await expect(alphaRow).toHaveCount(0);
  await expect(threadDetail).toHaveCount(0);
  await page.getByRole("tab", { name: "Files" }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}/files$`));

  // Only the hash changes, so the document and its remembered thread survive.
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
  await expect(page).toHaveURL(insightsUrl);
  await expect(insightsTab).toHaveAttribute("aria-selected", "true");
  await expect(filter.getByRole("button", { name: "All actions" })).toBeVisible();
  await expect(threadDetail).toBeVisible();
  await expect(threadDetail.getByRole("button", { name: "Command Log" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(alphaRow).toHaveAttribute("aria-pressed", "true");
  await expect(betaRow).toHaveAttribute("aria-pressed", "false");
});
