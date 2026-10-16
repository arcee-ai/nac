import { createDirectSession, expect, test } from "./harness";

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
    const aUrl = `${harness.baseUrl}/#/session/${a}/threads`;
    const bUrl = `${harness.baseUrl}/#/session/${b}/threads`;
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
    await input.fill(aText);
    // Hash routing keeps the same runtime while replacing the keyed session view.
    await page.evaluate((url) => {
      location.hash = new URL(url).hash;
    }, bUrl);
    await expect(input).toHaveValue("");
    await input.fill(bText);
    await page.goBack();
    await expect(input).toHaveValue(aText);
    await page.goForward();
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
  const url = `${harness.baseUrl}/#/session/${id}/threads`;
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
