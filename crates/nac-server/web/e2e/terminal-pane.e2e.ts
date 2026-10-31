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
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      if (await show.isVisible()) await show.click();
    }
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    await expect(pane).toBeVisible();
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    const shell = (await api.listUserTerminals(session)).terminals[0];
    const permissions = await api.getPermissions(session);
    expect(permissions.approval_mode).toBe("manual");
    expect(permissions.requests).toHaveLength(0);
    expect(permissions.grants).toHaveLength(0);
    const input = pane.locator(".xterm-helper-textarea");
    const viewport = pane.getByRole("region", { name: "Interactive terminal" });
    await viewport.click();
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
    if (mobile) {
      // A phone reopens on the list, as its tab bar does.
      await page.getByRole("button", { name: "Open panel", exact: true }).click();
      await pane.getByRole("button", { name: /^Shell 1, / }).click();
    }
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    await expect(accessible).toContainText("PANE-OK");
    expect(
      (await api.listUserTerminals(session)).terminals.map((item) => item.terminal_id),
    ).toEqual([shell.terminal_id]);
    await expect(
      pane.getByRole("button", { name: "Enable terminal input", exact: true }),
    ).toHaveCount(0);
    await viewport.click();
    await page.keyboard.type("printf '\\122\\105\\101\\124\\124\\101\\103\\110\\055\\117\\113\\n'");
    await page.keyboard.press("Enter");
    await expect(accessible).toContainText("REATTACH-OK");
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
    if (mobile) {
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await pane.getByRole("button", { name: "Open list", exact: true }).click();
    }
    await pane.getByRole("button", { name: "Close Shell 1", exact: true }).click();
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
  const observerPath = `${harness.baseUrl}/sessions/${session}/executions/${terminal.terminal_id}/observers/`;
  let replayObserver: string | undefined;
  const replayComplete = page.waitForResponse(async (response) => {
    if (
      !response.url().startsWith(observerPath) ||
      !response.url().endsWith("/read") ||
      response.request().method() !== "POST" ||
      !response.ok()
    )
      return false;
    const frame = await response.json();
    if (frame.gap) replayObserver = frame.observer_id;
    // An empty caught-up frame follows the renderer's ACK of the retained tail.
    return (
      replayObserver !== undefined &&
      frame.observer_id === replayObserver &&
      !frame.gap &&
      frame.caught_up &&
      !frame.requires_ack
    );
  });
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await Promise.all([
    replayComplete,
    (async () => {
      await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      if (await show.isVisible()) await show.click();
      await expect(pane).toBeVisible();
      await expect(pane.getByRole("alert")).toContainText("Earlier output was discarded");
    })(),
  ]);
  // Replay completion and painted text precede xterm's throttled accessibility mirror.
  await expect(pane.locator(".xterm-rows")).toContainText("GAP-OK");
  await expect(pane.locator(".xterm-accessibility")).toContainText("GAP-OK");
  expect((await api.getUserTerminal(session, terminal.terminal_id)).alive).toBe(true);
  await pane.getByRole("button", { name: "Close Shell 1", exact: true }).click();
  await expect
    .poll(async () => !(await api.getUserTerminal(session, terminal.terminal_id)).alive)
    .toBe(true);
  harness.provider.assertConsumed();
});

test.describe("full-screen terminal at browser scale 1.25", () => {
  test.use({ deviceScaleFactor: 1.25 });

  test("edits a real Vim buffer through resize and returns to the same shell", async ({
    harness,
    page,
    request,
  }, testInfo) => {
    test.skip(
      !(await fs.access("/usr/bin/vim").then(
        () => true,
        () => false,
      )),
      "The host has no /usr/bin/vim; full-screen program qualification is unavailable",
    );
    const session = await createDirectSession(request, harness);
    const file = path.join(harness.runRoot, "workspace/fullscreen.txt");
    await fs.writeFile(file, "SCREEN-ONLY-FIRST\n" + "screen body\n".repeat(40));
    const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    const show = page.getByRole("button", { name: "Show panel", exact: true });
    if (await show.isVisible()) await show.click();
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    const shell = (await api.listUserTerminals(session)).terminals[0];
    await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
    await page.keyboard.type(
      "/usr/bin/vim -Nu NONE -n -i NONE --cmd 'set encoding=utf-8' fullscreen.txt",
    );
    await page.keyboard.press("Enter");
    const accessible = pane.locator(".xterm-accessibility");
    // The file marker is absent from echoed input, so only real editor output
    // can satisfy this assertion.
    await expect(accessible).toContainText("SCREEN-ONLY-FIRST");
    await page.keyboard.type("iEDIT-");
    // Non-ASCII keyboard.type uses insertText without composition. Drive the
    // browser's composition path instead; this does not qualify a host OS IME.
    const input = await page.context().newCDPSession(page);
    try {
      await input.send("Input.imeSetComposition", {
        text: "Ω中",
        selectionStart: 2,
        selectionEnd: 2,
      });
      await input.send("Input.insertText", { text: "Ω中" });
    } finally {
      await input.detach();
    }
    const before = await api.getUserTerminal(session, shell.terminal_id);
    await page.setViewportSize({ width: 960, height: 620 });
    await expect
      .poll(async () => {
        const after = await api.getUserTerminal(session, shell.terminal_id);
        return after.cols !== before.cols || after.rows !== before.rows;
      })
      .toBe(true);
    await expect(accessible).toContainText("EDIT-Ω中SCREEN-ONLY-FIRST");
    await page.screenshot({
      path: testInfo.outputPath("terminal-vim-scale125.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page.keyboard.type(":wq");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => fs.readFile(file, "utf8"))
      .toBe("EDIT-Ω中SCREEN-ONLY-FIRST\n" + "screen body\n".repeat(40));
    // Saving the file precedes Vim exit. Wait for the actual shell prompt so
    // the next command cannot race the still-foreground editor.
    await expect
      .poll(async () =>
        (await pane.locator(".xterm-accessibility-tree > div").allTextContents()).some((row) =>
          /[$#]\s*$/.test(row),
        ),
      )
      .toBe(true);
    await page.keyboard.type("printf '\\123\\110\\105\\114\\114\\055\\102\\101\\103\\113\\n'");
    await page.keyboard.press("Enter");
    await expect(accessible).toContainText("SHELL-BACK");
    expect((await api.getUserTerminal(session, shell.terminal_id)).alive).toBe(true);
    // The resize reached the tablet layout, whose list is a screen of its own.
    await pane.getByRole("button", { name: "Open list", exact: true }).click();
    await pane.getByRole("button", { name: "Close Shell 1", exact: true }).click();
    await expect
      .poll(async () => {
        const status = await api.getUserTerminal(session, shell.terminal_id);
        return !status.alive && status.output_complete;
      })
      .toBe(true);
    harness.provider.assertConsumed();
  });
});
