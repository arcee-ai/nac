import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";

// The native Exa fixture enables the real managed harness. This episode qualifies
// registered APP redaction only; native Exa output remains a separate required repair.
test.use({ exaCredential: "managed-screen-native-synthetic-only" });
const canary = "managed-full-screen-app-synthetic-773";

test("managed full-screen APP masking holds a split prefix and exposes its real cursor-width effect", async ({
  harness,
  request,
  page,
}, info) => {
  const put = await request.put(harness.baseUrl + "/managed/secrets/APP_SCREEN_SECRET", {
    data: { value: canary },
  });
  expect(put.ok()).toBe(true);
  const workspace = path.join(harness.runRoot, "workspace");
  await fs.writeFile(
    path.join(workspace, "secret_screen.py"),
    [
      "import os,sys,termios,tty,time,select,json,signal",
      "value=os.environ['APP_SCREEN_SECRET'].encode(); saved=termios.tcgetattr(0)",
      "def geometry(*args): open('screen_geometry.json','w').write(json.dumps(list(os.get_terminal_size(0))))",
      "signal.signal(signal.SIGWINCH,geometry)",
      "try:",
      " tty.setraw(0); os.write(1,b'\\x1b[?1049h\\x1b[2J\\x1b[HLEFT|'+value[:12])",
      " open('screen_prefix_ready','w').write('ready'); end=time.monotonic()+5",
      " while not os.path.isfile('screen_release') and time.monotonic()<end: time.sleep(0.02)",
      " os.write(1,value[12:]+b'|RIGHT\\x1b[6n'); data=b''; end=time.monotonic()+8",
      " while not os.path.isfile('screen_measure_done') and time.monotonic()<end:",
      "  if select.select([0],[],[],0.05)[0]: data+=os.read(0,256)",
      " open('screen_cursor.json','w').write(json.dumps(list(data))); os.write(1,b'\\r\\nAPP-SCREEN-DONE'); geometry()",
      " end=time.monotonic()+8",
      " while time.monotonic()<end:",
      "  if select.select([0],[],[],0.05)[0] and b'q' in os.read(0,256): break",
      "finally:",
      " termios.tcsetattr(0,termios.TCSANOW,saved); os.write(1,b'\\x1b[?1049l')",
    ].join("\n") + "\n",
  );
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  await page.goto(harness.baseUrl + "/#/session/" + session + "/terminal");
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
  const inputs: number[][] = [];
  page.on("request", (sent) => {
    if (
      ["user-terminals", "executions"].some(
        (kind) => sent.url() === `${harness.baseUrl}/sessions/${session}/${kind}/${terminal}/input`,
      ) &&
      sent.method() === "POST"
    )
      inputs.push(sent.postDataJSON().bytes);
  });
  const started = performance.now();
  const observations: Record<string, unknown> = {};
  try {
    await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
    await page.keyboard.type("python3 secret_screen.py");
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        fs.readFile(path.join(workspace, "screen_prefix_ready"), "utf8").catch(() => null),
      )
      .toBe("ready");
    const accessible = pane.locator(".xterm-accessibility");
    await expect(accessible).toContainText("LEFT|");
    const prefix = await accessible.textContent();
    expect(prefix).not.toContain(canary.slice(0, 12));
    expect(prefix).not.toContain("RIGHT");
    observations.prefixSafeAtMs = performance.now() - started;
    const beforeQuery = inputs.length;
    await fs.writeFile(path.join(workspace, "screen_release"), "release");
    await expect(accessible).toContainText("LEFT|[REDACTED]|RIGHT");
    observations.completeMaskAtMs = performance.now() - started;
    // Measure the actual rendered cursor through DOM geometry. Mask replacement
    // changes its column, but a parsed DSR must never supply human stdin intent.
    const cursor = pane.locator(".xterm-rows .xterm-cursor");
    await expect
      .poll(async () => {
        const cell = await cursor.boundingBox();
        const row = await cursor.locator("..").boundingBox();
        return cell && row && cell.width > 0 ? Math.round((cell.x - row.x) / cell.width) + 1 : null;
      })
      .toBe(22);
    expect(inputs).toHaveLength(beforeQuery);
    await fs.writeFile(path.join(workspace, "screen_measure_done"), "measured");
    await expect
      .poll(async () =>
        JSON.parse(
          await fs.readFile(path.join(workspace, "screen_cursor.json"), "utf8").catch(() => "null"),
        ),
      )
      .toEqual([]);
    expect(inputs).toHaveLength(beforeQuery);
    observations.originalWidth = canary.length;
    observations.maskWidth = "[REDACTED]".length;
    observations.actualCursorColumn = 22;
    const before = await api.getUserTerminal(session, terminal);
    await page.setViewportSize({ width: 1050, height: 640 });
    await expect
      .poll(async () => {
        const after = await api.getUserTerminal(session, terminal);
        const geometry = JSON.parse(
          await fs.readFile(path.join(workspace, "screen_geometry.json"), "utf8"),
        );
        return (
          after.cols !== before.cols && geometry[0] === after.cols && geometry[1] === after.rows
        );
      })
      .toBe(true);
    await page.screenshot({
      path: info.outputPath("managed-full-screen-masked.png"),
      fullPage: true,
    });
    expect(await accessible.textContent()).not.toContain(canary);
    await page.keyboard.press("q");
    await page.keyboard.type(
      "printf '\\123\\103\\122\\105\\105\\116\\055\\123\\110\\105\\114\\114\\055\\102\\101\\103\\113\\n'",
    );
    await page.keyboard.press("Enter");
    await expect(accessible).toContainText("SCREEN-SHELL-BACK");
    expect((await api.getUserTerminal(session, terminal)).alive).toBe(true);
  } finally {
    await api.terminateTerminal(session, terminal);
    await fs.writeFile(
      info.outputPath("masking-observations.json"),
      JSON.stringify(observations, null, 2),
    );
    await info.attach("registered APP full-screen masking observations", {
      body: JSON.stringify(observations),
      contentType: "application/json",
    });
  }
  harness.provider.assertConsumed();
});
