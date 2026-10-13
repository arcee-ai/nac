import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";

test("user commands, live terminal and explicit queued selection share one session without sharing authority", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const shell = (await api.listUserTerminals(session)).terminals[0];
  const evidence = "terminal evidence during user command";
  const octal = Array.from(
    new TextEncoder().encode(evidence + "\n"),
    (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
  ).join("");
  await pane.getByRole("button", { name: "Focus terminal" }).click();
  await page.keyboard.type(`printf '${octal}'; printf 'same-workspace' > shell-shared.txt`);
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility")).toContainText(evidence);
  const workspace = path.join(harness.runRoot, "workspace");
  await expect
    .poll(() => fs.readFile(path.join(workspace, "shell-shared.txt"), "utf8"))
    .toBe("same-workspace");

  // Both intentional human operations skip Ask and keep manual agent policy.
  const permissions = await api.getPermissions(session);
  expect(permissions.approval_mode).toBe("manual");
  expect(permissions.requests).toHaveLength(0);
  expect(permissions.grants).toHaveLength(0);
  const script =
    'from pathlib import Path; import time,sys; print(Path("shell-shared.txt").read_text()); Path("command-entered").write_text("entered")\nwhile not Path("command-release").exists(): time.sleep(0.01)\nprint("command-finished"); sys.exit(7)';
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill(`!python3 -c '${script}'`);
  await page
    .locator("form")
    .filter({ has: composer })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  const card = page.getByRole("article", { name: "User command" });
  await expect(card).toContainText("started");
  await expect
    .poll(() => fs.readFile(path.join(workspace, "command-entered"), "utf8"))
    .toBe("entered");
  expect(harness.provider.requests).toHaveLength(0);
  expect((await api.getPermissions(session)).requests).toHaveLength(0);
  expect((await api.getUserTerminal(session, shell.terminal_id)).alive).toBe(true);

  const geometry = await api.getUserTerminal(session, shell.terminal_id);
  const rows = await pane.locator(".xterm-accessibility-tree > div").allTextContents();
  const row = rows.findIndex((text) => text.trimEnd() === evidence);
  expect(row).toBeGreaterThanOrEqual(0);
  const grid = await pane.locator(".xterm-screen").boundingBox();
  expect(grid).not.toBeNull();
  const cell = grid!.width / geometry.cols;
  const y = grid!.y + ((row + 0.5) * grid!.height) / geometry.rows;
  await page.mouse.move(grid!.x + 0.25 * cell, y);
  await page.mouse.down();
  await page.mouse.move(grid!.x + (evidence.length + 0.25) * cell, y, { steps: 10 });
  await page.mouse.up();
  await pane.getByRole("button", { name: "Review selected text", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review terminal selection" });
  await expect(dialog.getByLabel("Reviewed selected text")).toHaveText(evidence);
  await expect(
    dialog.getByRole("radio", { name: "Send as a new turn (idle chat)" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("radio", { name: "Steer the displayed active run" }),
  ).toBeDisabled();
  await dialog.getByRole("radio", { name: "Queue after existing input" }).check();
  harness.provider.enqueue(
    "queued-command-evidence",
    { token: evidence },
    { kind: "text", text: "Observed explicitly queued terminal evidence.", stream: true },
  );
  await dialog.getByRole("button", { name: "Queue selection", exact: true }).click();
  await expect.poll(async () => (await api.listInbox(session))[0]?.status).toBe("pending");
  expect(harness.provider.requests).toHaveLength(0);
  await dialog.getByRole("button", { name: "Dismiss review", exact: true }).click();
  await fs.writeFile(path.join(workspace, "command-release"), "release");
  await expect(card).toContainText("completed · exit 7");
  await expect(card).toContainText("same-workspace");
  await harness.provider.waitForRequestCount(1);
  await expect(
    page.getByText("Observed explicitly queued terminal evidence.", { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await api.listInbox(session))[0]?.status).toBe("delivered");
  expect(harness.provider.requests).toHaveLength(1);
  expect((await api.getUserTerminal(session, shell.terminal_id)).alive).toBe(true);
  await api.terminateTerminal(session, shell.terminal_id);
});

test("manual human terminal freezes accepted uncertain input until acknowledgement without replay", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const shell = (await api.listUserTerminals(session)).terminals[0];
  const inputUrl = `${harness.baseUrl}/sessions/${session}/user-terminals/${shell.terminal_id}/input`;
  const inputs: number[][] = [];
  page.on("request", (sent) => {
    if (sent.url() === inputUrl && sent.method() === "POST") inputs.push(sent.postDataJSON().bytes);
  });
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  const command = "printf accepted >> uncertain-effects.txt";
  await page.keyboard.type(command);
  await expect(pane.locator(".xterm-accessibility")).toContainText(command);
  // The Enter reaches the real process. Only its reply is replaced, proving
  // accepted-but-uncertain delivery instead of a pre-dispatch failure.
  await page.route(
    inputUrl,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      await route.fulfill({ status: 500, json: { error: "Input receipt lost" } });
    },
    { times: 1 },
  );
  await page.keyboard.press("Enter");
  const file = path.join(harness.runRoot, "workspace/uncertain-effects.txt");
  await expect.poll(() => fs.readFile(file, "utf8").catch(() => "")).toBe("accepted");
  const acknowledge = pane.getByRole("button", {
    name: "Acknowledge failure and enable fresh input",
    exact: true,
  });
  await expect(acknowledge).toBeVisible();
  const count = inputs.length;
  await page.keyboard.type("must-not-send");
  await pane.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(acknowledge).toBeVisible();
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await page.keyboard.type("still-frozen");
  expect(inputs).toHaveLength(count);
  expect(await fs.readFile(file, "utf8")).toBe("accepted");
  await acknowledge.click();
  await page.keyboard.type("printf fresh >> uncertain-effects.txt");
  await page.keyboard.press("Enter");
  await expect.poll(() => fs.readFile(file, "utf8").catch(() => "")).toBe("acceptedfresh");
  const permissions = await api.getPermissions(session);
  expect(permissions.approval_mode).toBe("manual");
  expect(permissions.requests).toHaveLength(0);
  expect(permissions.grants).toHaveLength(0);
  expect(harness.provider.requests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0);
  await pane.getByRole("button", { name: "Close shell", exact: true }).click();
  await expect
    .poll(async () => (await api.getUserTerminal(session, shell.terminal_id)).alive)
    .toBe(false);
});
