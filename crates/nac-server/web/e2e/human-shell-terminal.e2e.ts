import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";
import { reviewTerminalEvidence } from "./terminal-evidence";

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

  // Exercise a real resize while the user command owns execution admission.
  const beforeResize = await api.getUserTerminal(session, shell.terminal_id);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: viewport.height + 300 });
  await expect
    .poll(async () => (await api.getUserTerminal(session, shell.terminal_id)).rows)
    .not.toBe(beforeResize.rows);
  const dialog = await reviewTerminalEvidence(page, pane, evidence);
  await page.setViewportSize(viewport);
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

test("trusted pointer reports retain the public renderer's literal PTY encoding", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  const workspace = path.join(harness.runRoot, "workspace");
  await fs.writeFile(
    path.join(workspace, "capture_pointer.py"),
    [
      "import os,sys,termios,tty,time,select,json",
      "saved=termios.tcgetattr(0); data=b''; end=time.monotonic()+6",
      "try:",
      " tty.setraw(0); sys.stdout.write('\\x1b[?1000h\\x1b[?1006hPOINTER-RAW-READY\\r\\n'); sys.stdout.flush()",
      " while data.count(b'\\x1b[<')<2 and time.monotonic()<end:",
      "  if select.select([0],[],[],0.1)[0]: data+=os.read(0,4096)",
      "finally:",
      " termios.tcsetattr(0,termios.TCSANOW,saved); sys.stdout.write('\\x1b[?1000l\\x1b[?1006l'); sys.stdout.flush()",
      "open('pointer_bytes.json','w').write(json.dumps(list(data)))",
    ].join("\n") + "\n",
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const shell = (await api.listUserTerminals(session)).terminals[0];
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await page.keyboard.type("python3 capture_pointer.py");
  await page.keyboard.press("Enter");
  await expect(pane.locator(".xterm-accessibility")).toContainText("POINTER-RAW-READY");
  const grid = await pane.locator(".xterm-screen").boundingBox();
  expect(grid).not.toBeNull();
  await page.mouse.click(grid!.x + 20, grid!.y + 20);
  await expect
    .poll(async () => {
      const bytes = JSON.parse(
        await fs.readFile(path.join(workspace, "pointer_bytes.json"), "utf8").catch(() => "null"),
      );
      return bytes == null
        ? null
        : new TextDecoder().decode(Uint8Array.from(bytes)).replaceAll("\x1b", "<ESC>");
    })
    .toMatch(/^<ESC>\[<0;\d+;\d+M<ESC>\[<0;\d+;\d+m$/);
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
  const legacyInputUrl = `${harness.baseUrl}/sessions/${session}/user-terminals/${shell.terminal_id}/input`;
  const executionInputUrl = `${harness.baseUrl}/sessions/${session}/executions/${shell.terminal_id}/input`;
  const inputUrls = new Set([legacyInputUrl, executionInputUrl]);
  const inputs: number[][] = [];
  let controlledInputUsed = false;
  page.on("request", (sent) => {
    if (inputUrls.has(sent.url()) && sent.method() === "POST")
      inputs.push(sent.postDataJSON().bytes);
    if (sent.url() === executionInputUrl && sent.method() === "POST") controlledInputUsed = true;
  });
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  const command = "printf accepted >> uncertain-effects.txt";
  await page.keyboard.type(command);
  await expect(pane.locator(".xterm-accessibility")).toContainText(command);
  // The Enter reaches the real process. Only its reply is replaced, proving
  // accepted-but-uncertain delivery instead of a pre-dispatch failure.
  let injectedReceiptLoss = false;
  await page.route(
    (url) => inputUrls.has(url.href),
    async (route) => {
      const response = await route.fetch();
      if (route.request().url() === legacyInputUrl) expect(response.status()).toBe(204);
      else {
        expect(response.status()).toBe(200);
        expect((await response.json()).outcome).toBe("written");
      }
      injectedReceiptLoss = true;
      await route.fulfill({ status: 500, json: { error: "Input receipt lost" } });
    },
    { times: 1 },
  );
  await page.keyboard.press("Enter");
  const file = path.join(harness.runRoot, "workspace/uncertain-effects.txt");
  await expect.poll(() => fs.readFile(file, "utf8").catch(() => "")).toBe("accepted");
  expect(injectedReceiptLoss).toBe(true);
  const acknowledge = pane.getByRole("button", {
    name: "Acknowledge failure and enable fresh input",
    exact: true,
  });
  await expect(acknowledge).toBeVisible();
  const count = inputs.length;
  await page.keyboard.type("must-not-send");
  await page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `/session/${session}/files`);
  await expect(pane).toHaveCount(0);
  await page.evaluate((hash) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = hash;
  }, `/session/${session}/terminal`);
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(acknowledge).toBeVisible();
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await page.keyboard.type("source-switch-must-stay-frozen");
  expect(inputs).toHaveLength(count);
  await pane.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(acknowledge).toBeVisible();
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await page.keyboard.type("still-frozen");
  expect(inputs).toHaveLength(count);
  expect(await fs.readFile(file, "utf8")).toBe("accepted");
  const controlUrl = `${harness.baseUrl}/sessions/${session}/executions/${shell.terminal_id}/input-control`;
  const beforeControl = controlledInputUsed
    ? await api.getTerminalInputControl(session, shell.terminal_id)
    : undefined;
  const confirmed = beforeControl
    ? page.waitForResponse((response) => {
        if (response.url() !== controlUrl || response.request().method() !== "POST") return false;
        const body = response.request().postDataJSON();
        return (
          body.expected_revision === beforeControl.revision && body.acknowledge_uncertainty === true
        );
      })
    : undefined;
  await acknowledge.click();
  if (confirmed && beforeControl) {
    const response = await confirmed;
    expect(response.status()).toBe(200);
    const afterControl = await response.json();
    expect(afterControl.controller).toBe("human");
    expect(afterControl.frozen).toBe(false);
    expect(BigInt(afterControl.revision)).toBe(BigInt(beforeControl.revision) + 1n);
  }
  await expect(acknowledge).toHaveCount(0);
  // Confirm the existing public terminal focus behavior after server acceptance.
  await expect(pane.locator(".xterm-helper-textarea")).toBeFocused();
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

test("reattach observation sends no retained terminal-query replies before focused input", async ({
  harness,
  page,
  request,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  const shell = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: crypto.randomUUID(),
    cols: 80,
    rows: 24,
  });
  await api.inputUserTerminal(session, shell.terminal_id, {
    protocol_version: 1,
    bytes: Array.from(
      new TextEncoder().encode("printf '\\033[6nREPLAY-QUERY-END'; printf ready > query-ready\r"),
    ),
  });
  await expect
    .poll(() =>
      fs.readFile(path.join(harness.runRoot, "workspace/query-ready"), "utf8").catch(() => ""),
    )
    .toBe("ready");
  const inputUrls = new Set(
    ["user-terminals", "executions"].map(
      (kind) => `${harness.baseUrl}/sessions/${session}/${kind}/${shell.terminal_id}/input`,
    ),
  );
  const inputs: number[][] = [];
  page.on("request", (sent) => {
    if (inputUrls.has(sent.url()) && sent.method() === "POST")
      inputs.push(sent.postDataJSON().bytes);
  });
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(pane.locator(".xterm-accessibility")).toContainText("REPLAY-QUERY-END");
  expect(inputs).toHaveLength(0);
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await api.inputUserTerminal(session, shell.terminal_id, {
    protocol_version: 1,
    bytes: Array.from(new TextEncoder().encode("printf '\\033[6nFOCUSED-QUERY-END'\r")),
  });
  await expect(pane.locator(".xterm-accessibility")).toContainText("FOCUSED-QUERY-END");
  expect(inputs).toHaveLength(0);
  await pane.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  await expect(pane.locator(".xterm-accessibility")).toContainText("REPLAY-QUERY-END");
  expect(inputs).toHaveLength(0);
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
  await page.keyboard.type("printf fresh > query-fresh");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(harness.runRoot, "workspace/query-fresh"), "utf8").catch(() => ""),
    )
    .toBe("fresh");
  expect(inputs.length).toBeGreaterThan(0);
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: harness.baseUrl });
  const pasteCommand = "printf 'paste Ω中' > query-paste";
  await page.evaluate(
    async (text) =>
      (
        navigator as unknown as { clipboard: { writeText(text: string): Promise<void> } }
      ).clipboard.writeText(text),
    pasteCommand,
  );
  const beforePaste = inputs.length;
  // Ctrl+V is literal terminal SYN on Linux. Its browser paste shortcut adds
  // Shift; Mac uses Command. Require actual clipboard bytes before Enter.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+Shift+V");
  await expect
    .poll(() => {
      const sent = new TextDecoder().decode(Uint8Array.from(inputs.slice(beforePaste).flat()));
      return sent === pasteCommand || sent === `\x1b[200~${pasteCommand}\x1b[201~`;
    })
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      fs.readFile(path.join(harness.runRoot, "workspace/query-paste"), "utf8").catch(() => ""),
    )
    .toBe("paste Ω中");
  await api.terminateTerminal(session, shell.terminal_id);
});
