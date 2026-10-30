import { createProject, createSession, expect, test } from "./harness";

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
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
    const currentUrl = page.url();
    await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu", exact: true });
    await menu.getByRole("button", { name: "Search Chats", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Search Chats", exact: true });
    await search
      .getByRole("button", { name: /^Current chat(?:,|$)/ })
      .first()
      .click();
    await expect(search).toBeHidden();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(currentUrl);
    await page.getByRole("button", { name: "Open the menu", exact: true }).click();
    await menu
      .getByRole("button", { name: /^Current chat(?:,|$)/ })
      .first()
      .click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(currentUrl);
    await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
  });
}
