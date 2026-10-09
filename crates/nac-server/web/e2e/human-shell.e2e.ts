import { createProject, createSession, expect, test } from "./harness";

for (const mobile of [false, true]) {
  test(`human shell command lifecycle ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const project = await createProject(request, harness);
    const session = await createSession(request, harness, "direct", project);
    await page.goto(`${harness.baseUrl}/#/session/${session}/files`);
    const composer = page.getByRole("combobox", { name: "Message" });
    const send = () =>
      page
        .locator("form")
        .filter({ has: composer })
        .getByRole("button", { name: "Send", exact: true })
        .click();
    await composer.fill("!  printf 'USER_SHELL_RESULT'; exit 7\n");
    await send();
    const card = page.getByRole("article", { name: "User command" });
    await expect(card).toContainText("completed · exit 7");
    await expect(card).toContainText("USER_SHELL_RESULT");
    expect(harness.provider.requests).toHaveLength(0);
    const snapshot = await request.get(`${harness.baseUrl}/sessions/${session}`);
    const command = (await snapshot.json()).shell_commands[0];
    expect(command.command).toBe("  printf 'USER_SHELL_RESULT'; exit 7\n");
    await card.getByRole("button", { name: "Full output" }).click();
    await expect(card.locator("pre").last()).toContainText("USER_SHELL_RESULT");
    await page.reload();
    await expect(card).toContainText("completed · exit 7");
    await card.getByRole("button", { name: "Ask about this" }).click();
    await expect(composer).toHaveValue(/Explain the result of my command/);
    expect(harness.provider.requests).toHaveLength(0);
    harness.provider.enqueue(
      "followup",
      { token: "Explain the result of my command" },
      { kind: "text", text: "The user command exited with code seven.", stream: true },
    );
    await send();
    await expect(
      page.getByText("The user command exited with code seven.", { exact: true }),
    ).toBeVisible();
    expect(harness.provider.requests).toHaveLength(1);

    await composer.fill("!sleep 30");
    await send();
    const active = card.filter({ hasText: "!sleep 30" });
    await expect(active.getByRole("button", { name: "Cancel command" })).toBeVisible();
    const busy = await request.post(`${harness.baseUrl}/sessions/${session}/user-commands`, {
      data: { request_id: "busy", command: "echo must-not-run" },
    });
    expect(busy.status()).toBe(409);
    await active.getByRole("button", { name: "Cancel command" }).click();
    await expect(active).toContainText("cancelled");
    expect(harness.provider.requests).toHaveLength(1);
  });
}

test("human shell uncertain response keeps the same identity for an explicit retry", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const ids: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/sessions/${session}/user-commands`)
    ) {
      ids.push(request.postDataJSON().request_id);
    }
  });
  await page.route(`**/sessions/${session}/user-commands`, async (route) => {
    await route.fetch(); // The durable admission commits, but its response is lost.
    await route.abort("failed");
  });
  await page.route(`**/sessions/${session}/user-commands/*`, (route) => route.abort("failed"));
  await page.goto(`${harness.baseUrl}/#/session/${session}/files`);
  const composer = page.getByRole("combobox", { name: "Message" });
  const send = () =>
    page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true })
      .click();
  await composer.fill("!printf UNCERTAIN_COMMAND_RESULT");
  await send();
  await expect(composer).toHaveValue("!printf UNCERTAIN_COMMAND_RESULT");
  await expect(page.getByText(/may have accepted this command/)).toBeVisible();
  expect(ids).toHaveLength(1);
  await page.unroute(`**/sessions/${session}/user-commands`);
  await page.unroute(`**/sessions/${session}/user-commands/*`);
  await send();
  await expect(composer).toHaveValue("");
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  const snapshot = await request.get(`${harness.baseUrl}/sessions/${session}`);
  expect((await snapshot.json()).shell_commands).toHaveLength(1);
  expect(harness.provider.requests).toHaveLength(0);
});
