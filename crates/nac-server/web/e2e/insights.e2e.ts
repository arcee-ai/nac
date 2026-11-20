import fs from "node:fs/promises";
import path from "node:path";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";

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
