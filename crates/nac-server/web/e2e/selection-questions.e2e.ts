import fs from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

const FIRST_REPLY =
  "The cache is keyed by session id so two chats never share entries.\n\nEntries expire after one hour of inactivity.";

async function evidence(page: Page, name: string, testInfo: { outputPath(name: string): string }) {
  const target = testInfo.outputPath(name);
  await page.screenshot({ path: target, animations: "disabled" });
  const directory = process.env.NAC_E2E_EVIDENCE_DIR;
  if (directory) {
    await fs.mkdir(directory, { recursive: true });
    await fs.copyFile(target, path.join(directory, name));
  }
}

/** Select `text` inside the completed reply block that contains it. */
async function selectInReply(page: Page, text: string) {
  // Runs in the browser; the e2e project compiles without DOM types.
  await page.evaluate(`(() => {
    const needle = ${JSON.stringify(text)};
    const blocks = Array.from(document.querySelectorAll("[data-selection-source]"));
    const block = blocks.find((candidate) => candidate.textContent.includes(needle));
    if (!block) throw new Error("no completed reply contains " + needle);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const offset = node.textContent.indexOf(needle);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + needle.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error("text is split across elements: " + needle);
  })()`);
}

async function messages(page: Page, baseUrl: string, sessionId: string) {
  const response = await page.request.get(
    `${baseUrl}/sessions/${sessionId}/messages?limit=200&include_system=true`,
  );
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { messages: unknown[] }).messages;
}

test("asks a tool-free question about earlier reply text while the main run keeps working", async ({
  harness,
  page,
  request,
}, testInfo) => {
  const sessionId = await createSession(request, harness, "direct");

  harness.provider.enqueue(
    "all559-first",
    { token: "ALL559_FIRST_PROMPT" },
    { kind: "text", text: FIRST_REPLY, stream: "request" },
  );
  const first = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "ALL559_FIRST_PROMPT explain the cache" },
  });
  expect(first.status()).toBe(202);
  await waitForRunIdle(request, harness, sessionId);

  // The main chat starts a long reply that the provider holds open.
  const mainGate = new ScriptGate();
  harness.provider.enqueue(
    "all559-main",
    { token: "ALL559_MAIN_PROMPT" },
    { kind: "text", text: "ALL559 main reply finished.", stream: "request" },
    mainGate,
  );
  const main = request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "ALL559_MAIN_PROMPT now refactor everything" },
  });
  await mainGate.accepted;

  try {
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
    await expect(page.getByText("Entries expire after one hour of inactivity.")).toBeVisible();
    const before = await messages(page, harness.baseUrl, sessionId);

    harness.provider.enqueue(
      "all559-question",
      { token: "ALL559_QUESTION_TOKEN" },
      { kind: "text", text: "It means the session id is the cache key (ALL559 answer)." },
    );
    await selectInReply(page, "keyed by session id");
    await page.getByRole("button", { name: "Ask about selection" }).click();
    const review = page.getByRole("form", { name: "Review selection question" });
    await expect(review.getByLabel("Selected excerpt")).toHaveText("keyed by session id");
    await review.getByLabel("Your question").fill("What does keyed mean? ALL559_QUESTION_TOKEN");
    await evidence(page, "01-review.png", testInfo);
    await review.getByRole("button", { name: "Ask" }).click();

    const answer = page.getByRole("article", {
      name: "Question about selection: What does keyed mean? ALL559_QUESTION_TOKEN",
    });
    await expect(answer).toContainText("It means the session id is the cache key (ALL559 answer).");
    await expect(answer).toContainText("About reply #2 · gpt-5.6-sol");
    await expect(answer).toContainText("counted separately from this chat");
    // The pane floats over the transcript, so it must paint its own surface.
    await expect(
      page.getByRole("complementary", { name: "Questions about selections" }),
    ).toBeVisible();
    const paneBackground = await page.evaluate(
      `getComputedStyle(document.querySelector('[aria-label="Questions about selections"]')).backgroundColor`,
    );
    expect(paneBackground).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);

    // The main run is still running and its transcript did not change.
    const state = await request.get(`${harness.baseUrl}/sessions/${sessionId}`);
    expect(((await state.json()) as { active_run?: unknown }).active_run).not.toBeNull();
    expect(await messages(page, harness.baseUrl, sessionId)).toEqual(before);
    await evidence(page, "02-answer-while-main-runs.png", testInfo);

    // The question went out as one tool-free request bound to the frozen excerpt.
    const asked = harness.provider.requests.find(
      (entry) => entry.matchedStep === "all559-question",
    );
    const body = asked?.body as { tools?: unknown[]; input?: unknown } | undefined;
    expect(body?.tools ?? []).toEqual([]);
    expect(JSON.stringify(body)).toContain("keyed by session id");
    expect(JSON.stringify(body)).not.toContain("ALL559_MAIN_PROMPT");

    // A provider tool call is recorded and never executed.
    const marker = path.join(harness.runRoot, "workspace", "all559-tool-ran");
    harness.provider.enqueue(
      "all559-tool",
      { token: "ALL559_TOOL_TOKEN" },
      {
        kind: "function_call",
        name: "bash",
        callId: "all559-call",
        arguments: { command: `touch ${marker}` },
      },
    );
    await selectInReply(page, "Entries expire after one hour");
    await page.getByRole("button", { name: "Ask about selection" }).click();
    await review.getByLabel("Your question").fill("Check it? ALL559_TOOL_TOKEN");
    await review.getByRole("button", { name: "Ask" }).click();
    const toolCard = page.getByRole("article", {
      name: "Question about selection: Check it? ALL559_TOOL_TOKEN",
    });
    await expect(toolCard).toContainText("the model tried to use a tool; nothing was run");
    await expect(toolCard).toContainText("No tool was run and no answer was recorded.");
    await evidence(page, "03-tool-call-not-executed.png", testInfo);
    await expect(fs.access(marker)).rejects.toThrow();
    expect(
      harness.provider.requests.some((entry) =>
        JSON.stringify(entry.body).includes('"call_id":"all559-call"'),
      ),
    ).toBe(false);
  } finally {
    mainGate.release();
  }
  expect((await main).status()).toBe(202);
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("ALL559 main reply finished.")).toBeVisible();

  // Reload: the history is durable and separate from the transcript.
  await page.reload();
  await page.getByRole("button", { name: "Selection questions (2)" }).click();
  await expect(
    page.getByRole("article", {
      name: "Question about selection: What does keyed mean? ALL559_QUESTION_TOKEN",
    }),
  ).toContainText("(ALL559 answer)");
  await expect(
    page.getByRole("article", { name: "Question about selection: Check it? ALL559_TOOL_TOKEN" }),
  ).toContainText("No answer");
  const transcript = JSON.stringify(await messages(page, harness.baseUrl, sessionId));
  expect(transcript).not.toContain("ALL559_QUESTION_TOKEN");
  expect(transcript).not.toContain("ALL559 answer");
  await evidence(page, "04-reload-persisted.png", testInfo);
  harness.provider.assertConsumed();
});
