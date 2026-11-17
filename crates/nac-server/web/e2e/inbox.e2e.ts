import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { createDirectSession, expect, test } from "./harness";
import { ScriptGate } from "./scripted-provider";

// Direct-only, with orchestration unset (the shipped default).

async function renameSession(page: Page, baseUrl: string, id: string, title: string) {
  const list = (await (await page.request.get(`${baseUrl}/sessions`)).json()) as Array<{
    summary: { session_id: string; presentation_version?: number };
  }>;
  const entry = list.find((item) => item.summary.session_id === id);
  const response = await page.request.put(`${baseUrl}/sessions/${id}/presentation`, {
    data: { title, pinned: false, expected_version: entry?.summary.presentation_version ?? 0 },
  });
  expect(response.ok()).toBe(true);
}

test("a subagent's approval reaches the Inbox, opens at the exact card, and leaves once answered", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const file = path.join(harness.runRoot, "inbox-child-permission.txt");
  await fs.writeFile(file, "inbox child fixture\n");
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "inbox-child-ask",
    { token: "INBOX_CHILD_TOKEN" },
    {
      kind: "function_call",
      name: "read",
      callId: "inbox-child-read",
      arguments: { path: file },
      stream: "request",
    },
    gate,
  );
  harness.provider.enqueue(
    "inbox-child-done",
    { functionOutputCallId: "inbox-child-read" },
    { kind: "text", text: "child finished", stream: "request" },
  );
  const parent = await createDirectSession(request, harness);
  await renameSession(page, harness.baseUrl, parent, "Upgrade the parser");
  const started = request.post(`${harness.baseUrl}/sessions/${parent}/children`, {
    data: {
      profile: "general",
      description: "Check the grammar",
      prompt: "INBOX_CHILD_TOKEN",
      background: false,
    },
    timeout: 110_000,
  });
  await harness.provider.waitForRequestCount(1);
  const children = (await (
    await request.get(`${harness.baseUrl}/sessions/${parent}/children`)
  ).json()) as Array<{ child_session_id: string; description: string }>;
  const child = children.find(
    (entry) => entry.description === "Check the grammar",
  )!.child_session_id;
  await renameSession(page, harness.baseUrl, child, "Check the grammar");

  // Another tab holds the parent's delegated view open: the interactive client
  // that lets the subagent's Ask stay pending (fail-closed otherwise).
  const holder = await page.context().newPage();
  const connected = holder.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/sessions/${child}/events/stream` && response.ok(),
  );
  await holder.goto(`${harness.baseUrl}/#/session/${parent}/delegated`);
  await connected;
  gate.release();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${child}/permissions`);
      return ((await response.json()) as { requests: unknown[] }).requests.length;
    })
    .toBe(1);
  const exact = (
    (await (await request.get(`${harness.baseUrl}/sessions/${child}/permissions`)).json()) as {
      requests: Array<{ id: string }>;
    }
  ).requests[0].id;

  // Home: one quiet line, and the switch's badge.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${harness.baseUrl}/`);
  const line = page.getByRole("button", { name: /^1 needs you/ });
  await expect(line).toBeVisible();
  await expect(page.getByRole("tab", { name: "Inbox, 1 need you", exact: true })).toBeVisible();
  await line.click();
  const inboxTab = page.getByRole("tab", { name: /^Inbox/ });
  await expect(inboxTab).toHaveAttribute("aria-selected", "true");

  // One row for the parent, saying which subagent asks. No approve buttons here.
  const inbox = page.getByRole("group", { name: "Inbox", exact: true });
  const needsYou = inbox.getByRole("region", { name: "Needs you", exact: true });
  const row = needsYou.getByRole("button", {
    name: "Upgrade the parser, Approval needed from Check the grammar",
    exact: true,
  });
  await expect(row).toBeVisible();
  await expect(inbox.getByRole("button", { name: /Allow once|Deny|Always allow/ })).toHaveCount(0);

  // j/k move between rows; Enter opens the child at that exact request.
  await row.focus();
  await page.keyboard.press("k");
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`#/session/${child}/insights\\?permission_request=${exact}$`),
  );
  const card = page.getByRole("dialog", { name: "Permission required", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
  await card.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${child}/permissions`);
      return ((await response.json()) as { requests: unknown[] }).requests.length;
    })
    .toBe(0);

  // Answered anywhere, the row leaves and the badge goes with it.
  await expect(needsYou).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Inbox", exact: true })).toBeVisible();
  expect((await started).status()).toBe(201);
  await holder.close();
});

test("the Inbox says so when nothing needs you, and the switch remembers its choice", async ({
  harness,
  page,
  request,
}) => {
  await createDirectSession(request, harness);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${harness.baseUrl}/`);
  await expect(page.getByRole("button", { name: /need(s)? you/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("Nothing needs you", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "Inbox", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Sessions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("the Inbox preserves an exact question identity through navigation and stale links", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  await renameSession(page, harness.baseUrl, session, "Choose output format");
  harness.provider.enqueue(
    "inbox-question",
    { token: "INBOX_QUESTION_TOKEN" },
    {
      kind: "function_call",
      name: "request_question",
      callId: "inbox-question-call",
      stream: "request",
      arguments: {
        request_id: "inbox-format",
        text: "Which public output format?",
        choices: ["JSON", "CSV"],
        responder_class: "human_decision",
      },
    },
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}/insights`);
  await page.getByRole("combobox", { name: "Message", exact: true }).fill("INBOX_QUESTION_TOKEN");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Which public output format?", { exact: true })).toBeVisible();
  const questions = await (
    await request.get(`${harness.baseUrl}/sessions/${session}/questions`)
  ).json();
  const exact = questions.find((entry: { status: string }) => entry.status === "pending").request
    .request_id;
  await page.goto(`${harness.baseUrl}/`);
  await page.getByRole("tab", { name: /^Inbox/ }).click();
  await page
    .getByRole("group", { name: "Inbox", exact: true })
    .getByRole("button", { name: "Choose output format, Question waiting", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`question_request=${encodeURIComponent(exact)}$`));
  await expect(
    page.getByRole("dialog", { name: "Question from the agent", exact: true }),
  ).toContainText("Which public output format?");
  await page.goto(
    `${harness.baseUrl}/#/session/${session}/insights?question_request=retired-question`,
  );
  await expect(page.getByText(/This task question is no longer pending/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send answer", exact: true })).toHaveCount(0);
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${session}/questions`)).json())[0]
      .status,
  ).toBe("pending");
  harness.provider.assertConsumed();
});
