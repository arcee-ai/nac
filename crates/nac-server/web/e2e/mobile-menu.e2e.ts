import { createProject, createSession, expect, test } from "./harness";

// Phones have no persistent sidebar: the session screen's header is a back
// arrow plus one panel button, and the navigation sheet ("Menu") and Search
// (the command palette) live on Home's header. Picking a chat from either
// surface must close it and land on that chat, and picking the chat already
// on screen from the palette must close it without moving.
for (const grouped of [false, true]) {
  test(`closes phone navigation when selecting the current ${grouped ? "project" : "standalone"} chat`, async ({
    harness,
    page,
    request,
  }) => {
    const projectId = grouped ? await createProject(request, harness) : undefined;
    const id = await createSession(request, harness, "direct", projectId);
    const renamed = await request.put(`${harness.baseUrl}/sessions/${id}/presentation`, {
      data: { title: "Current chat", pinned: false, expected_version: 0 },
    });
    expect(renamed.ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${harness.baseUrl}/#/session/${id}/insights`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await expect(composer).toBeVisible();
    const currentUrl = page.url();
    const sessionUrl = new RegExp(`#/session/${id}(?:/|$)`);

    // The palette answers the shortcut on the session screen; choosing the
    // chat on screen closes it and leaves the route alone.
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill("Current");
    await palette.getByRole("option").filter({ hasText: "Current chat" }).first().click();
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(currentUrl);
    await expect(composer).toBeVisible();

    // Home's navigation sheet lists the same chat and closes on selection.
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/#\/$/);
    await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await expect(menu).toBeVisible();

    // Each chat row has one "⋯" options menu, a 44px target that opens a sheet
    // of 44px actions; Escape closes only that sheet and returns to its trigger.
    const options = menu.getByRole("button", { name: "Current chat options", exact: true });
    const optionsBox = await options.boundingBox();
    expect(optionsBox!.width).toBeGreaterThanOrEqual(44);
    expect(optionsBox!.height).toBeGreaterThanOrEqual(44);
    await options.click();
    const rowMenu = page.getByRole("menu", { name: "Current chat options", exact: true });
    await expect(rowMenu).toBeVisible();
    const items = rowMenu.getByRole("menuitem");
    await expect(items.first()).toBeFocused();
    const names = await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent),
    );
    expect(names).toEqual([
      "Rename Current chat",
      "Pin Current chat",
      ...(grouped ? [] : ["Move to project"]),
      "View full name",
      "Delete Current chat",
    ]);
    for (const box of await items.evaluateAll((nodes) =>
      nodes.map(
        (node) => node.getBoundingClientRect().toJSON() as { height: number; right: number },
      ),
    )) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.right).toBeLessThanOrEqual(390);
    }
    await page.keyboard.press("Escape");
    await expect(rowMenu).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(options).toBeFocused();

    await menu
      .getByRole("button", { name: /^Current chat(?:,|$)/ })
      .first()
      .click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(sessionUrl);
    await expect(composer).toBeVisible();

    // Search on Home's header is the palette; it closes on selection too.
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox", { name: "Search commands", exact: true }).fill("Current");
    await palette.getByRole("option").filter({ hasText: "Current chat" }).first().click();
    await expect(palette).toBeHidden();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(sessionUrl);
    await expect(composer).toBeVisible();
  });
}
