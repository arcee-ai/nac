import fs from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

// These browser-only names are evaluated by Playwright, never by the Node test runner.
declare class DataTransfer {
  getData(type: string): string;
  setData(type: string, value: string): void;
}
declare class ClipboardEvent {
  constructor(
    type: string,
    options: { clipboardData: DataTransfer; bubbles: boolean; cancelable: boolean },
  );
}
interface RenderedMarkerTiming {
  domMs: number;
  renderedMs: number;
}
declare const window: {
  open: (url?: string | URL) => null;
  terminalRenderedMarker?: {
    result: Promise<RenderedMarkerTiming>;
    dispose: () => void;
  };
};
declare class MutationObserver {
  constructor(callback: () => void);
  observe(target: unknown, options: Record<string, boolean>): void;
  disconnect(): void;
}
declare const navigator: { clipboard: { writeText: (text: string) => Promise<void> } };
declare function requestAnimationFrame(callback: (timestamp: number) => void): number;
declare function cancelAnimationFrame(handle: number): void;

function octal(text: string) {
  return Array.from(
    new TextEncoder().encode(text),
    (byte) => "\\" + byte.toString(8).padStart(3, "0"),
  ).join("");
}
async function command(page: Page, text: string) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
async function show(page: Page, base: string, session: string) {
  await page.goto(base + "/#/session/" + session + "/terminal");
  const button = page.getByRole("button", { name: "Show panel", exact: true });
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  // Document load can precede the session query and React's panel controls.
  await expect(button.or(pane)).toBeVisible();
  if (await button.isVisible()) await button.click();
  await expect(pane).toBeVisible();
  return pane;
}
async function focus(pane: Locator) {
  await pane.getByRole("button", { name: "Focus terminal", exact: true }).click();
}
/**
 * Arm the actual visual DOM renderer before input. The screen-reader mirror is
 * intentionally throttled by xterm and assertion polling is not a render clock.
 * Record DOM arrival plus the next animation-frame paint opportunity in-browser.
 */
async function armRenderedMarker(pane: Locator, marker: string) {
  await pane.locator(".xterm-rows").evaluate((rows, marker) => {
    window.terminalRenderedMarker?.dispose();
    if (rows.textContent?.includes(marker))
      throw new Error("Terminal latency marker must be absent before measurement");
    let resolve!: (timing: RenderedMarkerTiming) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<RenderedMarkerTiming>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    // Cleanup can precede the reader when another journey assertion fails.
    void result.catch(() => {});
    let settled = false;
    let frame: number | undefined;
    let startedAt = 0;
    const release = () => {
      observer.disconnect();
      clearTimeout(deadline);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      release();
      reject(new Error(message));
    };
    const observer = new MutationObserver(() => {
      if (settled || frame !== undefined || !rows.textContent?.includes(marker)) return;
      const domAt = performance.now();
      observer.disconnect();
      frame = requestAnimationFrame(() => {
        if (settled) return;
        const renderedAt = performance.now();
        settled = true;
        release();
        resolve({ domMs: domAt - startedAt, renderedMs: renderedAt - startedAt });
      });
    });
    observer.observe(rows, { childList: true, characterData: true, subtree: true });
    startedAt = performance.now();
    const deadline = setTimeout(
      () => fail("Terminal visual marker did not arrive within 10 seconds"),
      10_000,
    );
    window.terminalRenderedMarker = {
      result,
      dispose: () => fail("Terminal latency measurement disposed"),
    };
  }, marker);
}

async function copyRow(page: Page, pane: Locator, line: string, cols: number, rows: number) {
  const texts = await pane.locator(".xterm-accessibility-tree > div").allTextContents();
  const row = texts.findIndex((text) => text.trimEnd() === line);
  expect(row, JSON.stringify(texts)).toBeGreaterThanOrEqual(0);
  const grid = await pane.locator(".xterm-screen").boundingBox();
  expect(grid).not.toBeNull();
  const cell = grid!.width / cols;
  const y = grid!.y + ((row + 0.5) * grid!.height) / rows;
  await page.mouse.move(grid!.x + 0.25 * cell, y);
  await page.mouse.down();
  await page.mouse.move(grid!.x + (line.length + 0.25) * cell, y, { steps: 10 });
  await page.mouse.up();
  return pane.locator(".xterm-helper-textarea").evaluate((textarea) => {
    const data = new DataTransfer();
    textarea.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
    );
    return data.getData("text/plain");
  });
}

test("connected Zsh, less resize, and trusted browser bracketed UTF-8 paste return to the same shell", async ({
  harness,
  request,
  page,
}, info) => {
  test.skip(process.platform !== "darwin", "This episode qualifies installed Mac Zsh/less only");
  await Promise.all([fs.access("/bin/zsh"), fs.access("/usr/bin/less")]);
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const workspace = path.join(harness.runRoot, "workspace");
  await fs.writeFile(
    path.join(workspace, "pager.txt"),
    "LESS-REAL-CONTENT\n" + "pager body\n".repeat(90),
  );
  await fs.writeFile(
    path.join(workspace, "capture_paste.py"),
    [
      "import os,sys,termios,tty,time,select,json",
      "saved=termios.tcgetattr(0); data=b''; end=time.monotonic()+8",
      "try:",
      " tty.setraw(0); sys.stdout.write('\\x1b[?2004hPASTE-RAW-READY\\r\\n'); sys.stdout.flush()",
      " while b'\\x1b[201~' not in data and time.monotonic()<end:",
      "  if select.select([0],[],[],0.1)[0]: data+=os.read(0,4096)",
      "finally:",
      " termios.tcsetattr(0,termios.TCSANOW,saved); sys.stdout.write('\\x1b[?2004l'); sys.stdout.flush()",
      "open('paste_bytes.json','w').write(json.dumps(list(data)))",
    ].join("\n") + "\n",
  );
  const pane = await show(page, harness.baseUrl, session);
  let terminal: string | undefined;
  try {
    await pane.getByRole("button", { name: "New shell", exact: true }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
    const accessible = pane.locator(".xterm-accessibility");
    await focus(pane);
    await command(page, "exec /bin/zsh -f");
    await command(
      page,
      "printf '" + octal("ZSH-REAL-READY\n") + "'; /usr/bin/less -R -- pager.txt",
    );
    await expect(accessible).toContainText("LESS-REAL-CONTENT");
    const before = await api.getUserTerminal(session, terminal);
    await page.setViewportSize({ width: 970, height: 600 });
    await expect
      .poll(async () => {
        const after = await api.getUserTerminal(session, terminal!);
        return after.cols !== before.cols || after.rows !== before.rows;
      })
      .toBe(true);
    await expect(accessible).toContainText("LESS-REAL-CONTENT");
    await page.keyboard.press("q");
    await command(page, "printf '" + octal("LESS-SHELL-BACK\n") + "'; python3 capture_paste.py");
    await expect(accessible).toContainText("PASTE-RAW-READY");
    const pasteInputs: number[][] = [];
    page.on("request", (sent) => {
      if (
        ["user-terminals", "executions"].some(
          (kind) =>
            sent.url() === `${harness.baseUrl}/sessions/${session}/${kind}/${terminal}/input`,
        ) &&
        sent.method() === "POST"
      )
        pasteInputs.push(sent.postDataJSON().bytes);
    });
    // A script-generated paste grants no human input intent.
    await pane.locator(".xterm-helper-textarea").evaluate((textarea) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Ω中\nliteral paste");
      textarea.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], { origin: harness.baseUrl });
    await page.evaluate(async () =>
      (
        navigator as unknown as { clipboard: { writeText(text: string): Promise<void> } }
      ).clipboard.writeText("Ω中\nliteral paste"),
    );
    expect(pasteInputs).toHaveLength(0);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    await expect
      .poll(async () =>
        JSON.parse(
          await fs.readFile(path.join(workspace, "paste_bytes.json"), "utf8").catch(() => "null"),
        ),
      )
      .toEqual(Array.from(new TextEncoder().encode("\x1b[200~Ω中\rliteral paste\x1b[201~")));
    await command(page, "printf '" + octal("PASTE-SHELL-BACK\n") + "'");
    await expect(accessible).toContainText("PASTE-SHELL-BACK");
    expect((await api.listUserTerminals(session)).terminals.map((row) => row.terminal_id)).toEqual([
      terminal,
    ]);
    await page.screenshot({
      path: info.outputPath("connected-zsh-less-paste.png"),
      fullPage: true,
    });
  } finally {
    if (terminal) await api.terminateTerminal(session, terminal);
  }
  harness.provider.assertConsumed();
});

test("pane disposal releases observer seats and connected OSC52/OSC8 stays within browser policy", async ({
  harness,
  request,
  page,
}, info) => {
  await page.addInitScript(() => {
    const observations = { clipboardWrites: 0, opens: [] as string[] };
    Object.defineProperty(window, "terminalPolicyObservations", { value: observations });
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: async () => {
        observations.clipboardWrites += 1;
      },
    });
    window.open = ((url?: string | URL) => {
      observations.opens.push(String(url));
      return null;
    }) as typeof window.open;
  });
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  let pane = await show(page, harness.baseUrl, session);
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
  let cycles = 0;
  try {
    for (; cycles < 6; cycles += 1) {
      await page.getByRole("button", { name: "Hide panel", exact: true }).click();
      await page.getByRole("button", { name: "Show panel", exact: true }).click();
      await page.evaluate((id) => {
        location.hash = "/session/" + id + "/files";
      }, session);
      await expect(pane).toHaveCount(0);
      const seats: string[] = [];
      try {
        // Four successful seats after unmount prove the old seat was released, not merely hidden.
        await expect
          .poll(async () => {
            try {
              while (seats.length < 4)
                seats.push(
                  (
                    await api.attachUserTerminal(session, terminal, {
                      protocol_version: 1,
                      page_limit: 128,
                    })
                  ).observer_id,
                );
              return seats.length;
            } catch (error) {
              if (!(error instanceof Error) || !("status" in error) || error.status !== 429)
                throw error;
              return seats.length;
            }
          })
          .toBe(4);
        await expect(
          api.attachUserTerminal(session, terminal, { protocol_version: 1, page_limit: 128 }),
        ).rejects.toMatchObject({ status: 429 });
      } finally {
        await Promise.all(seats.map((seat) => api.detachUserTerminal(session, terminal, seat)));
      }
      await page.evaluate((id) => {
        location.hash = "/session/" + id + "/terminal";
      }, session);
      pane = page.getByRole("region", { name: "Session terminal", exact: true });
      await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    }
    await expect(
      pane.getByRole("button", { name: "Enable terminal input", exact: true }),
    ).toHaveCount(0);
    await focus(pane);
    const output =
      "\x1b[2J\x1b[H\x1b]52;c;Q0xJUEJPQVJELVNZTlRIRVRJQw==\x07" +
      "\x1b]8;;https://example.invalid/terminal-policy\x07SAFE-LINK\x1b]8;;\x07\r\n" +
      "\x1b]8;;javascript:alert(1)\x07BLOCKED-LINK\x1b]8;;\x07\r\nOSC-REAL-DONE\r\n";
    await command(page, "printf '" + octal(output) + "'");
    await expect(pane.locator(".xterm-accessibility")).toContainText("OSC-REAL-DONE");
    const geometry = await api.getUserTerminal(session, terminal);
    const box = await pane.locator(".xterm-screen").boundingBox();
    expect(box).not.toBeNull();
    const cell = box!.width / geometry.cols;
    const row = box!.height / geometry.rows;
    await page.mouse.click(box!.x + 3 * cell, box!.y + 0.5 * row);
    await page.mouse.click(box!.x + 3 * cell, box!.y + 1.5 * row);
    const observations = await page.evaluate(
      () =>
        (window as unknown as { terminalPolicyObservations: unknown }).terminalPolicyObservations,
    );
    expect(observations).toEqual({
      clipboardWrites: 0,
      opens: ["https://example.invalid/terminal-policy"],
    });
    await fs.writeFile(
      info.outputPath("observer-policy-observations.json"),
      JSON.stringify({ cycles, observations }, null, 2),
    );
    await info.attach("observer cycles and OSC policy", {
      body: JSON.stringify({ cycles, observations }),
      contentType: "application/json",
    });
  } finally {
    await api.terminateTerminal(session, terminal);
  }
  harness.provider.assertConsumed();
});

test("actual Python build and unittest consume active agent edits in the shell workspace", async ({
  harness,
  request,
  page,
}) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const root = path.join(harness.runRoot, "workspace");
  await fs.writeFile(
    path.join(root, "test_arithmetic.py"),
    "import unittest\nfrom arithmetic import add\nclass Arithmetic(unittest.TestCase):\n def test_sum(self): self.assertEqual(add(2,3),5)\n",
  );
  const completion = new ScriptGate();
  harness.provider.enqueue(
    "real-build-write",
    { token: "LOCAL_REAL_BUILD", requiredTools: ["write"] },
    {
      kind: "function_call",
      name: "write",
      callId: "arithmetic-write",
      arguments: {
        path: "arithmetic.py",
        content: "def add(a,b):\n return a+b\n",
        expected_revision: null,
      },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "real-build-complete",
    { functionOutputCallId: "arithmetic-write" },
    { kind: "text", text: "tested edit completed", stream: true },
    completion,
  );
  const pane = await show(page, harness.baseUrl, session);
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
  try {
    expect(
      (
        await request.post(harness.baseUrl + "/sessions/" + session + "/runs", {
          data: { prompt: "LOCAL_REAL_BUILD" },
        })
      ).status(),
    ).toBe(202);
    await completion.accepted;
    expect((await api.getSession(session)).active_run).toBeTruthy();
    await focus(pane);
    await command(
      page,
      "python3 -m py_compile arithmetic.py && python3 -m unittest -v test_arithmetic",
    );
    await expect(pane.locator(".xterm-accessibility")).toContainText(
      "test_sum (test_arithmetic.Arithmetic.test_sum) ... ok",
    );
    await expect(pane.locator(".xterm-accessibility")).toContainText("Ran 1 test");
    await expect(pane.locator(".xterm-accessibility")).toContainText("OK");
    expect((await api.getSession(session)).active_run).toBeTruthy();
    expect(await fs.readFile(path.join(root, "arithmetic.py"), "utf8")).toBe(
      "def add(a,b):\n return a+b\n",
    );
  } finally {
    completion.release();
    await api.terminateTerminal(session, terminal);
    await api.cancelActiveRun(session);
  }
  await waitForRunIdle(request, harness, session);
  harness.provider.assertConsumed();
});

test("connected renderer keeps copy selection, input, resize and Ctrl-C responsive under finite noisy output", async ({
  harness,
  request,
  page,
}, info) => {
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const root = path.join(harness.runRoot, "workspace");
  await fs.writeFile(
    path.join(root, "noise.py"),
    [
      "import os,time",
      "os.write(1,b'\\x1b[2J\\x1b[HSELECT-WHILE-OUTPUT\\r\\n')",
      "for i in range(240):",
      " width=max(1,os.get_terminal_size(1).columns-6)",
      " block=b'\\x1b[2;1H'+str(i).encode()+b':'+b'n'*width+b'\\x1b[K'",
      " os.write(1,block*300); time.sleep(0.02)",
    ].join("\n") + "\n",
  );
  const pane = await show(page, harness.baseUrl, session);
  await pane.getByRole("button", { name: "New shell", exact: true }).click();
  await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
  const terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
  // The first history refresh removes its empty-state row and resizes the terminal.
  // Complete that setup before exercising selection under noisy output.
  await expect(
    pane
      .getByRole("region", { name: "Recent terminal activity" })
      .locator(`option[value="${terminal}"]`),
  ).toHaveCount(1);
  const pages: Array<{ bytes: number; gap: boolean; retained: number }> = [];
  const pending = new Set<Promise<void>>();
  page.on("response", (response) => {
    if (
      !response.url().includes("/observers/") ||
      response.request().method() !== "POST" ||
      !response.ok()
    )
      return;
    const job = response
      .json()
      .then((frame) => {
        pages.push({
          bytes: frame.bytes.length,
          gap: frame.gap,
          retained: Number(frame.retained_end) - Number(frame.retained_start),
        });
      })
      .catch(() => {});
    pending.add(job);
    void job.finally(() => pending.delete(job));
  });
  await page.evaluate(() => {
    const sample = { count: 0, maxGapMs: 0, last: performance.now(), active: true };
    Object.defineProperty(window, "terminalHeartbeat", { value: sample });
    const beat = (now: number) => {
      sample.count++;
      sample.maxGapMs = Math.max(sample.maxGapMs, now - sample.last);
      sample.last = now;
      if (sample.active) requestAnimationFrame(beat);
    };
    requestAnimationFrame(beat);
  });
  const measurements: Record<string, unknown> = {};
  try {
    await focus(pane);
    await command(page, "python3 noise.py");
    const accessible = pane.locator(".xterm-accessibility");
    await expect(accessible).toContainText("SELECT-WHILE-OUTPUT");
    await expect
      .poll(() => pages.reduce((total, frame) => total + frame.bytes, 0))
      .toBeGreaterThan(256 * 1024);
    const before = await api.getUserTerminal(session, terminal);
    expect(await copyRow(page, pane, "SELECT-WHILE-OUTPUT", before.cols, before.rows)).toBe(
      "SELECT-WHILE-OUTPUT",
    );
    const resizedAt = performance.now();
    await page.setViewportSize({ width: 1050, height: 650 });
    await expect
      .poll(async () => {
        const status = await api.getUserTerminal(session, terminal);
        return status.cols !== before.cols || status.rows !== before.rows;
      })
      .toBe(true);
    measurements.resizeMs = performance.now() - resizedAt;
    await focus(pane);
    await armRenderedMarker(pane, "NOISE-INTERRUPTED");
    await page.keyboard.press("Control+c");
    await command(page, "printf '" + octal("NOISE-INTERRUPTED\n") + "'");
    const timing = await page.evaluate(() => {
      if (!window.terminalRenderedMarker)
        throw new Error("Terminal render measurement was not armed");
      return window.terminalRenderedMarker.result;
    });
    measurements.interruptToDomMarkerMs = timing.domMs;
    measurements.interruptToRenderedMarkerMs = timing.renderedMs;
    // Accessibility correctness remains required, with its own throttled update
    // lifetime. Its assertion polling never contributes to the recorded latency.
    await expect(accessible).toContainText("NOISE-INTERRUPTED");
    expect(measurements.interruptToRenderedMarkerMs).toBeLessThan(1500);
    expect(measurements.resizeMs).toBeLessThan(1500);
    const closeAt = performance.now();
    await pane.getByRole("button", { name: "Close shell", exact: true }).click();
    await expect
      .poll(async () => {
        const status = await api.getUserTerminal(session, terminal);
        return !status.alive && status.output_complete;
      })
      .toBe(true);
    measurements.closeSettledMs = performance.now() - closeAt;
    expect(measurements.closeSettledMs).toBeLessThan(1500);
  } finally {
    await page.evaluate(() => {
      window.terminalRenderedMarker?.dispose();
      delete window.terminalRenderedMarker;
    });
    await api.terminateTerminal(session, terminal);
    await Promise.allSettled(pending);
    const heartbeat = await page.evaluate(() => {
      const value = (window as unknown as { terminalHeartbeat: { active: boolean } })
        .terminalHeartbeat;
      value.active = false;
      return value;
    });
    await fs.writeFile(
      info.outputPath("pressure-observations.json"),
      JSON.stringify(
        {
          measurements,
          heartbeat,
          pages,
          maxFrameBytes: Math.max(0, ...pages.map((frame) => frame.bytes)),
        },
        null,
        2,
      ),
    );
    await info.attach("real renderer PTY pressure observations", {
      body: JSON.stringify({
        measurements,
        heartbeat,
        pages,
        maxFrameBytes: Math.max(0, ...pages.map((frame) => frame.bytes)),
      }),
      contentType: "application/json",
    });
  }
  expect(pages.length).toBeGreaterThan(2);
  expect(Math.max(...pages.map((frame) => frame.retained))).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(Math.max(...pages.map((frame) => frame.bytes))).toBeLessThanOrEqual(32 * 1024);
  harness.provider.assertConsumed();
});
