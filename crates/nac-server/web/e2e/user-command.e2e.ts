import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";

for (const mobile of [false, true]) {
  test(`user command lifecycle ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness);
    const session = await createSession(request, harness, "direct", project);
    await page.goto(`${harness.baseUrl}/#/session/${session}/files`);
    const composer = page.getByRole("combobox", { name: "Message" });
    const send = page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true });
    await expect(composer).toBeVisible();

    await composer.fill("!echo USER_CMD_OUT; exit 3");
    await expect(page.getByText("Runs as a shell command.", { exact: false })).toBeVisible();
    await send.click();
    const completed = page.getByRole("status", { name: "Command completed" });
    await expect(completed).toContainText("You ran a command · Completed · exit 3");
    await expect(completed).toContainText("echo USER_CMD_OUT; exit 3");
    await expect(completed).toContainText("stdout");
    await expect(composer).toHaveValue("");
    await expect(completed.getByRole("button", { name: /regenerate|edit/i })).toHaveCount(0);
    await waitForRunIdle(request, harness, session);
    expect(harness.provider.requests).toHaveLength(0);

    await composer.fill("!sleep 30");
    await send.click();
    const running = page.getByRole("status", { name: "Command running" });
    await expect(running).toContainText("sleep 30");
    await composer.fill("!echo second");
    await send.click();
    await expect(page.getByText(/Command not run: .*HTTP 409/)).toBeVisible();
    await expect(composer).toHaveValue("!echo second");
    await composer.blur();
    await running.getByRole("button", { name: "Cancel command" }).click();
    await expect(page.getByRole("status", { name: "Command cancelled" })).toContainText("sleep 30");
    await composer.fill("");

    await page.reload();
    await expect(completed).toContainText("You ran a command · Completed · exit 3");
    await expect(page.getByRole("status", { name: "Command cancelled" })).toBeVisible();
    expect(harness.provider.requests).toHaveLength(0);

    harness.provider.enqueue(
      "follow-up",
      { token: "FOLLOW_UP_TOKEN" },
      { kind: "text", text: "follow-up answer", stream: true },
    );
    await completed.getByRole("button", { name: "Ask about this" }).click();
    await expect(composer).toHaveValue(/^About the output of `echo USER_CMD_OUT/);
    await composer.fill(`${await composer.inputValue()}FOLLOW_UP_TOKEN`);
    await send.click();
    await waitForRunIdle(request, harness, session);
    await expect(page.getByText("follow-up answer", { exact: true })).toBeVisible();
    harness.provider.assertConsumed();
    expect(harness.provider.requests).toHaveLength(1);
    expect(JSON.stringify(harness.provider.requests[0].body)).toContain("USER_CMD_OUT");
    if (mobile) {
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    }
  });
}
