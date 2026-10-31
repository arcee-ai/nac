import { createSession, expect, test, waitForRunIdle } from "./harness";

test.skip(!!process.env.NAC_E2E_REMOTE, "Uses an isolated offline scripted provider");

for (const journey of [
  {
    behavior: "direct",
    question: "How do I add MCP?",
    document: "mcp",
    section: "add-a-server",
    excerpt: "mcp_servers",
    answer:
      "Open MCP in the sidebar. NAC Guide mcp#add-a-server. Current server readiness is unknown.",
  },
  {
    behavior: "direct",
    question: "$nac-help Where are my skills?",
    document: "skills",
    section: "discovery",
    excerpt: ".nac/skills",
    answer:
      "Project skills use .nac/skills or .agents/skills. NAC Guide skills#discovery. Your current installed custom skills are unknown.",
  },
  {
    behavior: "direct-with-orchestrator",
    question: "What does direct-with-orchestrator mean?",
    document: "session-behaviors",
    section: "overview",
    excerpt: "separate managed NAC orchestrator",
    answer:
      "A direct agent can launch separate managed orchestrators. Traditional children stay distinct. NAC Guide session-behaviors#overview.",
  },
  {
    behavior: "orchestrator",
    question: "Why can't this subagent search?",
    document: "web-retrieval",
    section: "overview",
    excerpt: "parent source",
    answer:
      "Native search depends on inherited eligibility and credentials. Current availability is unknown. NAC Guide web-retrieval#overview.",
  },
] as const) {
  test(`release-local guide: ${journey.behavior}: ${journey.document}`, async ({
    harness,
    request,
    page,
  }) => {
    harness.provider.enqueue(
      "guide-search",
      {
        token: journey.question,
        requiredTools: ["nac_guide"],
        forbiddenTools: ["web_search", "web_fetch"],
      },
      {
        kind: "function_call",
        stream: "request",
        name: "nac_guide",
        callId: "guide-index",
        arguments: { operation: "index", query: journey.question },
      },
    );
    harness.provider.enqueue(
      "guide-read",
      { functionOutputCallId: "guide-index" },
      {
        kind: "function_call",
        stream: "request",
        name: "nac_guide",
        callId: "guide-section",
        arguments: {
          operation: "read",
          document_id: journey.document,
          section_id: journey.section,
        },
      },
    );
    harness.provider.enqueue(
      "guide-answer",
      { functionOutputCallId: "guide-section" },
      { kind: "text", text: journey.answer, stream: "request" },
    );
    const sessionId = await createSession(request, harness, journey.behavior);
    if (journey.document === "skills") {
      await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
      const composer = page.getByRole("combobox", { name: "Message", exact: true }).first();
      await composer.fill("$nac");
      const choices = page.getByRole("listbox", {
        name: "Skills",
        exact: true,
      });
      await choices.getByRole("option", { name: /nac-help/ }).click();
      await expect(composer).toHaveValue("$nac-help");
      await composer.fill("");
    }
    const catalog = await request.get(`${harness.baseUrl}/sessions/${sessionId}/skills`);
    expect(catalog.ok()).toBe(true);
    expect(await catalog.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "nac-help",
          description: expect.stringContaining("first-party"),
        }),
      ]),
    );
    const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
      data: { prompt: journey.question },
    });
    expect(submitted.status()).toBe(202);
    await harness.provider.waitForRequestCount(3);
    await waitForRunIdle(request, harness, sessionId);
    harness.provider.assertConsumed();
    const readRequest = harness.provider.requests.find(
      (item) => item.matchedStep === "guide-answer",
    );
    const grounded = JSON.stringify(readRequest?.body);
    expect(grounded).toContain(journey.excerpt);
    expect(grounded).toContain("content_digest");
    expect(grounded).toContain("source_revision");
    expect(grounded).toContain("first-party bundled NAC Guide");
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
    await expect(page.getByText(journey.answer, { exact: true })).toBeVisible();
    if (journey.document === "skills") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByText(journey.answer, { exact: true })).toBeVisible();
      await expect(page.getByText(journey.question, { exact: true })).toBeVisible();
      await expect(page.getByText("Skill expanded: $nac-help", { exact: true })).toBeVisible();
    }
    // A help read never launches workers, adds sessions or edits MCP settings.
    const sessions = await request.get(`${harness.baseUrl}/sessions`);
    expect((await sessions.json()).length).toBe(1);
    if (journey.document === "mcp") {
      await harness.restart("1");
      harness.provider.enqueue(
        "guide-after-restart",
        {
          token: "Which guide is installed after restart?",
          requiredTools: ["nac_guide"],
        },
        {
          kind: "function_call",
          stream: "request",
          name: "nac_guide",
          callId: "old-guide-ref",
          arguments: {
            operation: "manifest",
            expected_fingerprint: "0".repeat(64),
          },
        },
      );
      harness.provider.enqueue(
        "guide-refresh-ref",
        { functionOutputCallId: "old-guide-ref" },
        {
          kind: "function_call",
          stream: "request",
          name: "nac_guide",
          callId: "current-guide-ref",
          arguments: { operation: "manifest" },
        },
      );
      harness.provider.enqueue(
        "guide-resumed-answer",
        { functionOutputCallId: "current-guide-ref" },
        { kind: "text", text: "The current installed guide is authoritative.", stream: "request" },
      );
      expect(
        (
          await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
            data: { prompt: "Which guide is installed after restart?" },
          })
        ).status(),
      ).toBe(202);
      await harness.provider.waitForRequestCount(6);
      await waitForRunIdle(request, harness, sessionId);
      expect(
        JSON.stringify(
          harness.provider.requests.find((item) => item.matchedStep === "guide-refresh-ref")?.body,
        ),
      ).toContain("version_mismatch");
      expect(
        JSON.stringify(
          harness.provider.requests.find((item) => item.matchedStep === "guide-resumed-answer")
            ?.body,
        ),
      ).toContain("build_identity");
      harness.provider.assertConsumed();
    }
  });
}

test("generic NAC coding request preserves ordinary prompt without guide expansion", async ({
  harness,
  request,
}) => {
  const prompt = "Implement a Rust parser in the NAC repository";
  harness.provider.enqueue(
    "coding",
    { token: prompt, requiredTools: ["read", "nac_guide"] },
    { kind: "text", text: "ordinary coding request" },
  );
  const sessionId = await createSession(request, harness, "direct");
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
        data: { prompt },
      })
    ).status(),
  ).toBe(202);
  await harness.provider.waitForRequestCount(1);
  await waitForRunIdle(request, harness, sessionId);
  const body = harness.provider.requests[0].body as {
    input: Array<{ role?: string; content?: unknown }>;
  };
  const users = JSON.stringify(body.input.filter((message) => message.role === "user"));
  expect(users).toContain(prompt);
  expect(users).not.toContain("<invoked_skills>");
  harness.provider.assertConsumed();
});
