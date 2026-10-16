import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`preserves exact primary drafts through navigation and reload on ${viewport.name}`, async ({
    harness,
    page,
    request,
  }) => {
    await page.setViewportSize(viewport);
    const a = await createDirectSession(request, harness);
    const b = await createDirectSession(request, harness);
    const aUrl = `${harness.baseUrl}/#/session/${a}/files`;
    const bUrl = `${harness.baseUrl}/#/session/${b}/files`;
    const input = page.getByRole("combobox", { name: "Message" });
    const aText = "  雪🙂 exact spaces  \n\n!echo never-run\n";
    const bText = "/compact\nunsent second draft  ";
    const mutations: string[] = [];
    page.on("request", (req) => {
      // Model catalog discovery is an existing read transported as POST.
      if (
        !["GET", "HEAD"].includes(req.method()) &&
        new URL(req.url()).pathname !== "/providers/models"
      )
        mutations.push(req.url());
    });
    await page.goto(aUrl);
    await expect(page).toHaveURL(aUrl);
    await expect(page.getByLabel("Loading conversation")).toHaveCount(0);
    await input.fill(aText);
    // Hash routing keeps the same runtime while replacing the keyed session view.
    await page.evaluate((url) => {
      location.hash = new URL(url).hash;
    }, bUrl);
    await expect(page).toHaveURL(bUrl);
    await expect(input).toHaveValue("");
    await input.fill(bText);
    await page.goBack();
    await expect(page).toHaveURL(aUrl);
    await expect(input).toHaveValue(aText);
    await page.goForward();
    await expect(page).toHaveURL(bUrl);
    await expect(input).toHaveValue(bText);
    await page.evaluate(() => {
      location.hash = "#/";
    });
    await expect(input).toHaveCount(0);
    await page.goBack();
    await expect(input).toHaveValue(bText);
    await page.reload();
    await expect(input).toHaveValue(bText);
    await page.evaluate((url) => {
      location.hash = new URL(url).hash;
    }, aUrl);
    await expect(input).toHaveValue(aText);
    await page.reload();
    await expect(input).toHaveValue(aText);
    await input.fill("");
    await page.reload();
    await expect(input).toHaveValue("");
    expect(mutations).toEqual([]);
    expect(harness.provider.requests).toHaveLength(0);
  });
}

test("isolates persisted primary drafts after same-origin serving-instance replacement", async ({
  harness,
  page,
  request,
}) => {
  const id = await createDirectSession(request, harness);
  const url = `${harness.baseUrl}/#/session/${id}/files`;
  await page.goto(url);
  const input = page.getByRole("combobox", { name: "Message" });
  await input.fill("private to the original serving lifetime\n雪");
  const firstBinding = await page.locator("#nac-presentation-binding").textContent();
  await page.reload();
  await expect(input).toHaveValue("private to the original serving lifetime\n雪");
  expect(await page.locator("#nac-presentation-binding").textContent()).toBe(firstBinding);
  const origin = harness.baseUrl;
  await harness.restart("1", true);
  expect(harness.baseUrl).toBe(origin);
  // The same durable session survives, at the identical origin and URL.
  expect((await request.get(`${origin}/sessions/${id}`)).ok()).toBe(true);
  await page.reload();
  await expect(input).toHaveValue("");
  expect(await page.locator("#nac-presentation-binding").textContent()).not.toBe(firstBinding);
  expect(harness.provider.requests).toHaveLength(0);
});

test("keeps a pending primary send guarded through navigation and preserves newer text", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "one-pending-draft",
    { token: "E2E_DRAFT_PENDING_ONCE", requiredTools: ["read"] },
    { kind: "text", text: "accepted once" },
  );
  const a = await createDirectSession(request, harness);
  const b = await createDirectSession(request, harness);
  const aUrl = `${harness.baseUrl}/#/session/${a}/files`;
  const bUrl = `${harness.baseUrl}/#/session/${b}/files`;
  const gate = new ScriptGate();
  let dispatches = 0;
  await page.route(`${harness.baseUrl}/sessions/${a}/runs`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    dispatches += 1;
    gate.markAccepted();
    await gate.waitForRelease();
    await route.continue();
  });
  const input = page.getByRole("combobox", { name: "Message" });
  try {
    // Direct sessions normalize unsupported panels once their snapshot arrives.
    // Start on their canonical panel and observe readiness before navigation.
    await page.goto(aUrl);
    await expect(page).toHaveURL(aUrl);
    await expect(page.getByLabel("Loading conversation")).toHaveCount(0);
    await input.fill("E2E_DRAFT_PENDING_ONCE");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => dispatches).toBe(1);
    await page.evaluate((url) => {
      location.hash = new URL(url).hash;
    }, bUrl);
    await expect(page).toHaveURL(bUrl);
    await expect(input).toHaveValue("");
    await page.goBack();
    await expect(page).toHaveURL(aUrl);
    await expect(input).toHaveValue("E2E_DRAFT_PENDING_ONCE");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await input.fill("newer draft while acceptance is pending");
    await input.press("Enter");
    expect(dispatches).toBe(1);
    gate.release();
    await harness.provider.waitForRequestCount(1);
    await waitForRunIdle(request, harness, a);
    await expect(input).toHaveValue("newer draft while acceptance is pending");
    await expect(send).toBeEnabled();
    expect(dispatches).toBe(1);
    harness.provider.assertConsumed();
  } finally {
    gate.release();
  }
});
