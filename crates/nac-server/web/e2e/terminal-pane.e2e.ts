import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";

for (const mobile of [false, true]) {
  test(`embedded terminal pane ${mobile ? "mobile" : "desktop"} uses the session shell`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await createDirectSession(request, harness);
    const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
    await api.setPermissionApprovalMode(session, "auto_approve");
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      if (await show.isVisible()) await show.click();
    }
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    await expect(pane).toBeVisible();
    await pane.getByRole("button", { name: "New shell", exact: true }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    const shell = (await api.listUserTerminals(session)).terminals[0];
    const input = pane.locator(".xterm-helper-textarea");
    await pane.getByRole("button", { name: "Focus terminal" }).click();
    await expect(input).toBeFocused();
    // The marker does not occur literally in echoed input.
    await page.keyboard.type(
      "printf '\\120\\101\\116\\105\\055\\117\\113\\n'; printf 'pane file\\n' > pane.txt",
    );
    await page.keyboard.press("Enter");
    const accessible = pane.locator(".xterm-accessibility");
    await expect(accessible).toContainText("PANE-OK");
    await expect
      .poll(() => fs.readFile(path.join(harness.runRoot, "workspace/pane.txt"), "utf8"))
      .toBe("pane file\n");
    await expect
      .poll(async () => {
        const status = await api.getUserTerminal(session, shell.terminal_id);
        return status.cols !== 80 || status.rows !== 24;
      })
      .toBe(true);
    // Geometry changes use the real PTY, and literal Ctrl-C interrupts its child.
    await page.keyboard.type("sleep 30");
    await page.keyboard.press("Enter");
    await expect(accessible).toContainText("sleep 30");
    await page.keyboard.press("Control+c");
    await page.keyboard.type("printf '\\103\\124\\122\\114\\055\\117\\113\\n'");
    await page.keyboard.press("Enter");
    await expect(accessible).toContainText("CTRL-OK");
    if (!mobile) {
      await page.getByRole("button", { name: "Expand panel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      expect((await api.getUserTerminal(session, shell.terminal_id)).alive).toBe(true);
    }
    await page.reload();
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    await expect(accessible).toContainText("PANE-OK");
    expect(
      (await api.listUserTerminals(session)).terminals.map((item) => item.terminal_id),
    ).toEqual([shell.terminal_id]);
    const viewport = pane.getByRole("region", { name: "Interactive terminal" });
    await expect
      .poll(async () => {
        const host = await viewport.boundingBox();
        const grid = await viewport.locator(".xterm-screen").boundingBox();
        return host && grid
          ? grid.height <= host.height + 1 && grid.width <= host.width + 1
          : false;
      })
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`terminal-${mobile ? "mobile" : "desktop"}.png`),
      fullPage: true,
    });
    if (mobile)
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    await pane.getByRole("button", { name: "Close shell", exact: true }).click();
    await expect
      .poll(async () => {
        const status = await api.getUserTerminal(session, shell.terminal_id);
        return !status.alive && status.output_complete;
      })
      .toBe(true);
    harness.provider.assertConsumed();
  });
}

test("embedded pane resets and replays an actual retention gap", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const terminal = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: randomUUID(),
    cols: 80,
    rows: 24,
  });
  // Finite output exceeds the actual default retention before the pane attaches.
  await api.inputUserTerminal(session, terminal.terminal_id, {
    protocol_version: 1,
    bytes: Array.from(
      new TextEncoder().encode(
        "head -c 12582912 /dev/zero; printf '\\107\\101\\120\\055\\117\\113\\n'\r",
      ),
    ),
  });
  await expect
    .poll(async () => {
      const observer = await api.attachUserTerminal(session, terminal.terminal_id, {
        protocol_version: 1,
        page_limit: 128,
      });
      try {
        const frame = await api.pullUserTerminal(
          session,
          terminal.terminal_id,
          observer.observer_id,
          { protocol_version: 1, acknowledge_reset: false, wait_ms: 0 },
        );
        return frame.gap;
      } finally {
        await api.detachUserTerminal(session, terminal.terminal_id, observer.observer_id);
      }
    })
    .toBe(true);
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("alert")).toContainText("Earlier output was discarded");
  await expect(pane.locator(".xterm-accessibility")).toContainText("GAP-OK");
  expect((await api.getUserTerminal(session, terminal.terminal_id)).alive).toBe(true);
  await pane.getByRole("button", { name: "Close shell", exact: true }).click();
  await expect
    .poll(async () => !(await api.getUserTerminal(session, terminal.terminal_id)).alive)
    .toBe(true);
  harness.provider.assertConsumed();
});
