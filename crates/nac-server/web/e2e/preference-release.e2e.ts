import { createProject, createSession, expect, test } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

test.skip(!!process.env.NAC_E2E_REMOTE, "Requires the isolated caller-owned storage fixture");
test.use({ orchestration: "0" });

test("caller-owned preferences survive real runtime close and reconstruction", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  const projectId = await createProject(request, harness, { name: "Preference release fixture" });
  const sessionId = await createSession(request, harness, "direct", projectId);
  const otherSessionId = await createSession(request, harness, "direct", projectId);
  const fixture = await startHostedFixture(harness, sessionId, {
    preferenceStorage: { projectId, otherSessionId },
  });
  const read = async () => {
    await page.getByRole("button", { name: "Inspect caller preferences", exact: true }).click();
    return JSON.parse(
      (await page.getByLabel("Caller preference snapshot").textContent()) ?? "null",
    );
  };
  try {
    await page.goto(fixture.baseUrl);
    const composer = page.getByRole("combobox", { name: "Message" });
    await expect(composer).toBeVisible();
    await expect.poll(fixture.activeStreams).toBe(1);
    await page.getByRole("button", { name: "Set caller preferences", exact: true }).click();
    const before = await read();
    const expected = {
      tabs: { dismissed: [otherSessionId], order: { [projectId]: [otherSessionId, sessionId] } },
      navigation: { pinned: [sessionId], lastViewedAt: { [sessionId]: "2099-01-01T00:00:00Z" } },
    };
    expect(before).toMatchObject({ ...expected, stored: expected, closed: false });
    await composer.fill("Unsent text stays outside preference storage");
    await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
    await expect(composer).toHaveValue("");
    await expect.poll(fixture.activeStreams).toBe(1);
    const replaced = await read();
    expect(replaced).toMatchObject({ ...expected, stored: expected, closed: false });

    await page.getByRole("button", { name: "Mutate retired preferences", exact: true }).click();
    expect(await read()).toEqual(replaced);
    await page.getByRole("button", { name: "Close runtime", exact: true }).click();
    await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
    await expect.poll(fixture.activeStreams).toBe(0);
    const closed = await read();
    expect(closed).toMatchObject({
      ...expected,
      closed: true,
      stored: expected,
    });
    await page.getByRole("button", { name: "Close runtime", exact: true }).click();
    expect(await read()).toEqual(closed);
    await page.getByRole("button", { name: "Replace runtime", exact: true }).click();
    await expect(composer).toBeVisible();
    await expect.poll(fixture.activeStreams).toBe(1);
    const reconstructed = await read();
    expect(reconstructed).toMatchObject({ ...expected, stored: expected, closed: false });
    expect(fixture.calls.filter((call) => call.path.endsWith("/events/stream"))).toHaveLength(3);
    expect(fixture.calls.filter((call) => call.method !== "GET")).toEqual([]);
    await page.getByRole("button", { name: "Close runtime", exact: true }).click();
    await expect.poll(fixture.activeStreams).toBe(0);
    await info.attach("production shared-runtime preference lifecycle", {
      body: JSON.stringify(
        {
          scenario:
            "Test caller operates actual production stores; retained pin/tab product components are not mounted. No product visual change or native acceptance claimed.",
          before,
          replaced,
          closed,
          reconstructed,
          mutationRequests: fixture.calls.filter((call) => call.method !== "GET"),
          activeStreamsAfterClose: fixture.activeStreams(),
          source: process.env.NAC_PREFERENCE_SOURCE_SHA,
          base: "6f77f6c57d66dad1c657fdad7852c4ccb148d701",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await fixture.stop();
  }
  expect(fixture.activeStreams()).toBe(0);
});
