import fs from "node:fs/promises";
import path from "node:path";
import {
  createDirectSession,
  createSession,
  expect,
  showSidePanel,
  test,
  waitForRunIdle,
} from "./harness";

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
  await expect(threadDetail.getByRole("button", { name: "Logs" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(alphaRow).toHaveAttribute("aria-pressed", "true");
  await expect(betaRow).toHaveAttribute("aria-pressed", "false");
});

test("opens a transcript group in Insights from its badge", async ({ harness, page, request }) => {
  const notes = "badge-notes.txt";
  await fs.writeFile(path.join(harness.runRoot, "workspace", notes), "badge notes\n");
  harness.provider.enqueue(
    "badge-first-read",
    { token: "E2E_BADGE_FIRST_TOKEN", requiredTools: ["read"] },
    { kind: "function_call", name: "read", callId: "badge-first-read", arguments: { path: notes } },
  );
  harness.provider.enqueue(
    "badge-first-answer",
    { functionOutputCallId: "badge-first-read" },
    { kind: "text", text: "first group answered" },
  );
  harness.provider.enqueue(
    "badge-second-glob",
    { token: "E2E_BADGE_SECOND_TOKEN", requiredTools: ["glob"] },
    {
      kind: "function_call",
      name: "glob",
      callId: "badge-second-glob",
      arguments: { pattern: "*.txt" },
    },
  );
  harness.provider.enqueue(
    "badge-second-read",
    { functionOutputCallId: "badge-second-glob" },
    {
      kind: "function_call",
      name: "read",
      callId: "badge-second-read",
      arguments: { path: notes },
    },
  );
  harness.provider.enqueue(
    "badge-second-answer",
    { functionOutputCallId: "badge-second-read" },
    { kind: "text", text: "second group answered" },
  );
  const sessionId = await createDirectSession(request, harness);
  for (const prompt of ["E2E_BADGE_FIRST_TOKEN", "E2E_BADGE_SECOND_TOKEN"]) {
    const run = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
      data: { prompt },
    });
    expect(run.status()).toBe(202);
    await waitForRunIdle(request, harness, sessionId);
  }
  harness.provider.assertConsumed();

  // Each turn's work folds behind one "Worked for …" line, in the order of the
  // runs; expanded, the fold offers "Open in Insights" on its own group. Every
  // step of both groups is measured, so their Insights rows share a label.
  const folds = page.locator("[data-work-fold]");
  const readFold = folds.nth(0);
  const searchFold = folds.nth(1);
  const foldToggle = (fold: typeof readFold) => fold.getByRole("button", { name: /^Worked for / });
  const openInInsights = (fold: typeof readFold) =>
    fold.getByRole("button", { name: "Open in Insights", exact: true });
  const readRow = page.getByRole("button", { name: /^Total activity: \d+\.\ds, 1$/ });
  const searchRow = page.getByRole("button", { name: /^Total activity: \d+\.\ds, 2$/ });
  const fileRead = page.getByRole("group", { name: "File Read", exact: true });
  const findFiles = page.getByRole("group", { name: "Find files", exact: true });

  // A fold opens Insights from whichever panel is showing.
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/files`);
  await expect(page.getByText("second group answered")).toBeVisible();
  await expect(folds).toHaveCount(2);
  await foldToggle(readFold).click();
  await expect(foldToggle(readFold)).toHaveAttribute("aria-expanded", "true");
  await openInInsights(readFold).click();
  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}/insights$`));
  await expect(readRow).toHaveAttribute("aria-pressed", "true");
  await expect(searchRow).toHaveAttribute("aria-pressed", "false");
  await expect(fileRead).toContainText("badge-notes.txt");
  await expect(findFiles).toHaveCount(0);

  // The floating drawer covers the chat; close it to reach the other turn.
  await page.getByRole("button", { name: "Hide panel", exact: true }).click();
  await foldToggle(searchFold).click();
  await openInInsights(searchFold).click();
  await expect(searchRow).toHaveAttribute("aria-pressed", "true");
  await expect(readRow).toHaveAttribute("aria-pressed", "false");
  await expect(findFiles).toContainText("*.txt");
  await expect(fileRead).toContainText("badge-notes.txt");
});

test("opens a launched session in the parent Subagents panel", async ({
  harness,
  page,
  request,
}) => {
  const title = "Audit the session card";
  harness.provider.enqueue(
    "card-launch",
    { token: "E2E_CARD_PARENT_TOKEN", requiredTools: ["subagent"] },
    {
      kind: "function_call",
      name: "subagent",
      callId: "card-launch",
      arguments: {
        profile: "general",
        description: title,
        prompt: "E2E_CARD_CHILD_TOKEN check the transcript card",
        child_session_id: null,
        background: false,
      },
    },
  );
  harness.provider.enqueue(
    "card-child",
    { token: "E2E_CARD_CHILD_TOKEN", forbiddenTools: ["subagent"] },
    { kind: "text", text: "card child finished" },
  );
  harness.provider.enqueue(
    "card-parent-answer",
    { functionOutputCallId: "card-launch" },
    { kind: "text", text: "parent saw the card" },
  );
  const parentId = await createDirectSession(request, harness);
  const run = await request.post(`${harness.baseUrl}/sessions/${parentId}/runs`, {
    data: { prompt: "E2E_CARD_PARENT_TOKEN" },
  });
  expect(run.status()).toBe(202);
  await waitForRunIdle(request, harness, parentId);
  harness.provider.assertConsumed();
  const children = (await (
    await request.get(`${harness.baseUrl}/sessions/${parentId}/children`)
  ).json()) as Array<{ child_session_id: string; description: string }>;
  const childId = children.find((child) => child.description === title)?.child_session_id;
  expect(childId).toBeTruthy();

  await page.goto(`${harness.baseUrl}/#/session/${parentId}/insights`);
  await expect(page.getByText("parent saw the card")).toBeVisible();
  await page
    .locator("[data-turn]")
    .getByRole("button", { name: "Open Subagent in Subagents", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/session/${parentId}/delegated$`));
  await expect(page.getByRole("tab", { name: "Subagents" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("card child finished", { exact: true })).toBeVisible();
  await expect(page.getByText("parent saw the card", { exact: true })).toBeVisible();
});
