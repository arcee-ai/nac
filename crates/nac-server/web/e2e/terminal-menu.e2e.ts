import { createDirectSession, expect, test } from "./harness";

for (const mobile of [false, true]) {
  test(`terminal options keep keyboard focus ${mobile ? "on a phone" : "in an expanded panel"}`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await createDirectSession(request, harness);
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      if (await show.isVisible()) await show.click();
    }
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    if (!mobile) await page.getByRole("button", { name: "Expand panel", exact: true }).click();
    const processActions: string[] = [];
    page.on("request", (sent) => {
      if (
        sent.method() === "POST" &&
        /\/(input|input-control|stop)$/.test(new URL(sent.url()).pathname)
      )
        processActions.push(sent.url());
    });
    const trigger = pane.getByRole("button", { name: "Terminal options", exact: true });
    const actions = page.getByRole("dialog", { name: "Terminal actions", exact: true });
    const reconnect = actions.getByRole("button", { name: "Reconnect", exact: true });
    const review = actions.getByRole("button", { name: "Review Selected text", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(reconnect).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(review).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reconnect).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      actions.getByRole("button", { name: "Give Agent Control", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(review).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reconnect).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("keyboard-actions.png") });
    await page.keyboard.press("Escape");
    await expect(actions).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(pane).toBeVisible();
    expect(processActions).toEqual([]);

    // Keyboard activation reconnects observation, without submitting shell input.
    await page.keyboard.press("Enter");
    await expect(reconnect).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(actions).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    expect(processActions).toEqual([]);

    // A live handle reopened through history still offers only read-only reconnect.
    if (mobile) await pane.getByRole("button", { name: "Open list", exact: true }).click();
    const recent = pane.getByRole("region", { name: "Recent terminal activity", exact: true });
    await recent.getByRole("button", { name: /^Shell · / }).click();
    await expect(pane.getByLabel("Terminal input ownership")).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(reconnect).toBeFocused();
    await expect(actions.getByRole("button")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(reconnect).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(reconnect).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(actions).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(processActions).toEqual([]);
    expect(harness.provider.requests).toHaveLength(0);
  });
}
