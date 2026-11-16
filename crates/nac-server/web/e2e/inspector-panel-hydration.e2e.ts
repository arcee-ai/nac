import { createProject, createSession, expect, showSidePanel, test } from "./harness";

for (const [width, savedOpen] of [
  [1440, false],
  [1440, true],
  [768, true],
] as const) {
  test(`inspector panel helper handles ${savedOpen ? "saved-open" : "collapsed"} hydration at ${width}px`, async ({
    harness,
    page,
    request,
  }) => {
    const project = await createProject(request, harness, { name: "Panel hydration" });
    const parent = await createSession(request, harness, "direct", project);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      ({ key, value }) => {
        // Seed the same public preference a prior user-owned panel toggle stores.
        if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      },
      { key: `nac.rightSidebar.collapsed.${project}`, value: savedOpen ? "0" : "1" },
    );
    const sessionWrites: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (
        sent.method() !== "GET" &&
        url.origin === new URL(harness.baseUrl).origin &&
        url.pathname.startsWith(`/sessions/${parent}/`)
      )
        sessionWrites.push(url.pathname);
    });
    await page.goto(`${harness.baseUrl}/#/session/${parent}/files`);
    await showSidePanel(page);
    const files = page.getByRole("tab", { name: "Files", exact: true });
    await expect(files).toBeVisible();
    const hide = page.getByRole("button", { name: "Hide panel", exact: true });
    await hide.focus();
    await page.keyboard.press("Enter");
    await expect(files).not.toBeVisible();
    await showSidePanel(page);
    await expect(files).toBeVisible();
    await page.reload();
    await showSidePanel(page);
    await expect(files).toBeVisible();
    expect(sessionWrites).toEqual([]);
    expect(harness.provider.requests).toHaveLength(0);
  });
}
