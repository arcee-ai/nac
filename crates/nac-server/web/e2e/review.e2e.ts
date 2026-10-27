import fs from "node:fs/promises";
import path from "node:path";

import { createDirectSession, expect, test, waitForRunIdle } from "./harness";

// Runs only against a `review-fixture` build (make test-e2e-review), whose
// scripted reviewer rejects reads of paths containing "blocked" and approves
// everything else, including an explicitly authorized retry. Selecting
// Approve for me still goes through NAC's real Arcee credential check.
const fixtureBuild = process.env.NAC_E2E_REVIEW_FIXTURE === "1";

test.use({
  serverEnvironment: fixtureBuild
    ? {
        ARCEE_API_KEY: "nac-e2e-arcee-dummy-only",
        NAC_REVIEW_FIXTURE: JSON.stringify({
          reject_containing: ["blocked"],
          category: "out_of_scope",
          approve_authorized_retries: true,
        }),
      }
    : {},
});

test("reviews eligible requests, returns blocked actions and reviews an authorized retry again", async ({
  harness,
  page,
  request,
}) => {
  test.skip(!fixtureBuild, "requires the review-fixture build (make test-e2e-review)");
  test.setTimeout(90_000);
  const fixtures = path.join(harness.runRoot, "review-fixtures");
  await fs.mkdir(fixtures, { recursive: true });
  const allowed = path.join(fixtures, "allowed.txt");
  const blocked = path.join(fixtures, "blocked.txt");
  await Promise.all([
    fs.writeFile(allowed, "routine contents\n"),
    fs.writeFile(blocked, "blocked contents\n"),
  ]);

  harness.provider.enqueue(
    "review-allowed",
    { token: "ALL37_REVIEW_TOKEN", requiredTools: ["read"] },
    {
      kind: "function_call",
      name: "read",
      callId: "review-allowed",
      arguments: { path: allowed },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "review-blocked",
    { functionOutputCallId: "review-allowed" },
    {
      kind: "function_call",
      name: "read",
      callId: "review-blocked",
      arguments: { path: blocked },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "review-explained",
    { functionOutputCallId: "review-blocked" },
    { kind: "text", text: "the blocked read needs your authorization", stream: true },
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  await page.getByRole("button", { name: "Permissions" }).click();
  await page
    .getByRole("radiogroup", { name: "Approval mode" })
    .getByText("Approve for me", { exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^Approve for me enabled/ })).toBeVisible();
  await expect(page.getByRole("status", { name: "Review service status" })).toContainText(
    "Service availability not checked",
  );
  await expect(page.getByRole("status", { name: "Review service status" })).toContainText(
    "checks credentials only",
  );
  await expect(page.getByRole("region", { name: "Automatic reviews" })).toContainText(
    "No reviews are retained",
  );
  await page.keyboard.press("Escape");

  await page.getByRole("combobox", { name: "Message" }).fill("ALL37_REVIEW_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(3);
  await waitForRunIdle(request, harness, sessionId);

  // Settled tool details live in Insights; the transcript retains their activity badge.
  await page.getByRole("button", { name: /^Total activity: \d+\.\ds$/ }).click();
  const reads = page.getByRole("group", { name: "File Read", exact: true });
  await expect(reads.filter({ hasText: "allowed.txt" })).toBeVisible();
  const blockedCall = reads.filter({ hasText: "code=review_rejected" });
  await expect(blockedCall).toContainText("operation_executed=false");
  const explained = harness.provider.requests.find(
    (entry) => entry.matchedStep === "review-explained",
  );
  expect(JSON.stringify(explained?.body)).toContain("routine contents");
  expect(JSON.stringify(explained?.body)).not.toContain("blocked contents");
  await expect(page.getByText("Permission required")).toHaveCount(0);

  const state = await (
    await request.get(`${harness.baseUrl}/sessions/${sessionId}/permissions`)
  ).json();
  expect(state.approval_mode).toBe("review");
  expect(state.authorizable_review_ids).toHaveLength(1);
  expect(state.reviews.map((review: { outcome: string }) => review.outcome)).toEqual([
    "rejected",
    "approved",
  ]);

  harness.provider.enqueue(
    "review-retry",
    { token: "I authorize retrying this blocked action once" },
    {
      kind: "function_call",
      name: "read",
      callId: "review-retry",
      arguments: { path: blocked },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "review-retry-complete",
    { functionOutputCallId: "review-retry" },
    { kind: "text", text: "authorized retry complete", stream: true },
  );

  await page.getByRole("button", { name: /^Approve for me enabled/ }).click();
  const reviews = page.getByRole("region", { name: "Automatic reviews" });
  await expect(page.getByRole("status", { name: "Review service status" })).toContainText(
    "Last review completed",
  );
  await expect(reviews).toContainText("an idle session is unloaded");
  await expect(reviews).toContainText("Blocked: out of scope");
  await expect(reviews).toContainText("blocked.txt");
  await reviews.getByRole("button", { name: "Authorize retry" }).click();
  await expect(reviews.getByRole("button", { name: "Authorize retry" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await harness.provider.waitForRequestCount(5);
  await waitForRunIdle(request, harness, sessionId);
  await page.getByRole("button", { name: /^Total activity: \d+\.\ds, 1$/ }).click();
  await expect(reads.filter({ hasText: "blocked.txt" })).toBeVisible();
  const completed = harness.provider.requests.find(
    (entry) => entry.matchedStep === "review-retry-complete",
  );
  expect(JSON.stringify(completed?.body)).toContain("blocked contents");
  await expect(page.getByText("authorized retry complete")).toBeVisible();

  const after = await (
    await request.get(`${harness.baseUrl}/sessions/${sessionId}/permissions`)
  ).json();
  expect(after.authorizable_review_ids).toEqual([]);
  const retryReview = after.reviews[0];
  expect(retryReview.outcome).toBe("approved");
  expect(retryReview.user_authorized_retry).toBe(true);

  await page.getByRole("button", { name: /^Approve for me enabled/ }).click();
  await page
    .getByRole("radiogroup", { name: "Approval mode" })
    .getByText("Manual", { exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Permissions" })).toBeVisible();
});
