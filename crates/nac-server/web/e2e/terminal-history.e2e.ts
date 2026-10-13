import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";

test("retained terminal history reopens without input, expires independently and survives restart as canonical previews", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const session = await createDirectSession(request, harness);
  const makeApi = () =>
    createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  let api = makeApi();
  const command = async (id: string, text: string) => {
    await api.submitShellCommand(session, { request_id: id, command: text });
    await expect
      .poll(async () => {
        const history = await api.listExecutionHistory(session);
        return history.history.entries.find((entry) => entry.command?.request_id === id)?.command
          ?.state;
      })
      .toBe("completed");
  };
  const shell = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: crypto.randomUUID(),
    cols: 80,
    rows: 24,
  });
  await api.inputUserTerminal(session, shell.terminal_id, {
    protocol_version: 1,
    bytes: Array.from(new TextEncoder().encode("printf 'HUMAN-HISTORY\\n'\r")),
  });
  await command("known-history", "printf RETAINED-HISTORY; exit 7");
  const first = (await api.listExecutionHistory(session)).history.entries.find(
    (entry) => entry.command?.request_id === "known-history",
  )!;
  expect(first.command?.exit_code).toBe(7);
  expect(first.command?.stdout).toBe("RETAINED-HISTORY");
  expect(first.command?.output_id).toBeNull();
  expect(first.execution?.input).toBe(false);
  expect(first.execution?.stop).toBe(false);
  const id = first.execution!.id;
  const observer = await api.attachExecution(session, id, { protocol_version: 1, page_limit: 2 });
  const pending = await api.pullExecution(session, id, observer.observer_id, {
    protocol_version: 1,
    acknowledge_reset: false,
    wait_ms: 0,
  });
  expect(pending.bytes).toEqual([82, 69]);

  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const recent = page.getByRole("region", { name: "Recent terminal activity", exact: true });
  await expect(recent.getByRole("option", { name: /known-history|Human command/ })).toHaveCount(1);
  const operations: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() !== "GET" && sent.url().includes(`/sessions/${session}/`))
      operations.push(sent.url());
  });
  const humanHistory = (await api.listExecutionHistory(session)).history.entries.find(
    (entry) => entry.execution?.id === shell.terminal_id,
  )!;
  await recent.getByLabel("Recent activity").selectOption(humanHistory.id);
  await recent.getByRole("button", { name: "Reopen retained output", exact: true }).click();
  const pane = page.getByRole("region", { name: "Session terminal", exact: true });
  await expect(
    pane.getByRole("button", { name: "Return to live source", exact: true }),
  ).toBeVisible();
  await expect(
    pane
      .getByRole("region", { name: "Interactive terminal", exact: true })
      .locator(".xterm-accessibility"),
  ).toContainText("HUMAN-HISTORY");
  await expect(pane.getByRole("button", { name: "Close shell", exact: true })).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Stop execution", exact: true })).toHaveCount(0);
  operations.length = 0;
  await pane.locator(".xterm-screen").click();
  await page.keyboard.type("printf MUST-NOT-HISTORY");
  await page.keyboard.press("Enter");
  expect(operations.some((url) => /\/(input|resize|stop)$/.test(url))).toBe(false);
  expect((await api.getUserTerminal(session, shell.terminal_id)).alive).toBe(true);
  await api.terminateTerminal(session, shell.terminal_id);
  await recent.getByLabel("Recent activity").selectOption(first.id);
  await expect(recent.getByLabel("Recorded stdout")).toHaveText("RETAINED-HISTORY");
  operations.length = 0;
  await recent.getByRole("button", { name: "Reopen retained output", exact: true }).click();
  await expect
    .poll(() => operations.some((url) => url.includes(`/executions/${id}/observers`)))
    .toBe(true);
  await expect(pane.getByRole("region", { name: "Execution log", exact: true })).toContainText(
    "RETAINED-HISTORY",
  );
  expect(operations.some((url) => /\/(input|resize|stop)$/.test(url))).toBe(false);
  expect(
    operations.some((url) => url.endsWith("/user-commands") || url.endsWith("/user-terminals")),
  ).toBe(false);
  expect(harness.provider.requests).toHaveLength(0);

  // Real settled metadata eviction, not a fabricated response or stale replay.
  // The durable first result remains among the bounded newest command rows.
  for (let index = 0; index < 17; index++) await command(`evict-${index}`, "true");
  const expired = (await api.listExecutionHistory(session)).history.entries.find(
    (entry) => entry.id === first.id,
  )!;
  expect(expired.execution).toBeNull();
  expect(expired.output.availability).toBe("process_local_unavailable");
  expect(expired.command?.state).toBe("completed");
  expect(expired.command?.stdout).toBe("RETAINED-HISTORY");
  await expect(
    recent.getByRole("button", { name: "Reopen retained output", exact: true }),
  ).toBeDisabled();
  // A current-owner unexpired seat keeps only the page already admitted.
  // It cannot obtain another page from the expired execution after its ACK.
  expect(
    await api.pullExecution(session, id, observer.observer_id, {
      protocol_version: 1,
      acknowledge_reset: false,
      wait_ms: 0,
    }),
  ).toEqual(pending);
  await expect(
    api.pullExecution(session, id, observer.observer_id, {
      protocol_version: 1,
      acknowledge_offset: pending.next_offset,
      acknowledge_reset: false,
      wait_ms: 0,
    }),
  ).rejects.toBeTruthy();
  await expect(
    api.pullExecution(session, id, observer.observer_id, {
      protocol_version: 1,
      acknowledge_reset: false,
      wait_ms: 0,
    }),
  ).rejects.toBeTruthy();
  expect(harness.provider.requests).toHaveLength(0);

  // Restart the isolated embedded server, then use a new endpoint-bound client.
  // Old observer identity is tested directly rather than replayed browser state.
  await harness.restart(null);
  api = makeApi();
  const restored = (await api.listExecutionHistory(session)).history.entries.find(
    (entry) => entry.id === first.id,
  )!;
  expect(restored.execution).toBeNull();
  expect(restored.command?.stdout).toBe("RETAINED-HISTORY");
  expect(restored.command?.exit_code).toBe(7);
  expect(restored.output.availability).toBe("process_local_unavailable");
  await expect(
    api.attachExecution(session, id, { protocol_version: 1, page_limit: 2 }),
  ).rejects.toBeTruthy();
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const panel = page.getByRole("button", { name: "Show panel", exact: true });
  if (await panel.isVisible()) await panel.click();
  await recent.getByLabel("Recent activity").selectOption(first.id);
  await expect(recent.getByLabel("Recorded stdout")).toHaveText("RETAINED-HISTORY");
  await expect(recent).toContainText("no restored live handle");
  expect(harness.provider.requests).toHaveLength(0);
});

test("production history preserves exact byte gaps and requires reset before retained tail", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const session = await createDirectSession(request, harness);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.submitShellCommand(session, {
    request_id: "bounded-gap",
    command: 'python3 -c \'import sys; sys.stdout.write("x"*(9*1024*1024)+"GAP-END")\'',
  });
  await expect
    .poll(async () => (await api.listExecutionHistory(session)).history.entries[0]?.command?.state)
    .toBe("completed");
  const entry = (await api.listExecutionHistory(session)).history.entries[0];
  expect(entry.output.availability).toBe("tail_gap");
  const start = "1048583";
  const end = "9437191";
  expect(entry.output.retained_start).toBe(start);
  expect(entry.output.retained_end).toBe(end);
  const id = entry.execution!.id;
  const observer = await api.attachExecution(session, id, { protocol_version: 1, page_limit: 8 });
  const gap = await api.pullExecution(session, id, observer.observer_id, {
    protocol_version: 1,
    acknowledge_reset: false,
    wait_ms: 0,
  });
  expect(gap.gap).toBe(true);
  expect(gap.bytes).toEqual([]);
  expect(gap.next_offset).toBe(start);
  expect(
    await api.pullExecution(session, id, observer.observer_id, {
      protocol_version: 1,
      acknowledge_reset: false,
      wait_ms: 0,
    }),
  ).toEqual(gap);
  const tail = await api.pullExecution(session, id, observer.observer_id, {
    protocol_version: 1,
    acknowledge_offset: start,
    acknowledge_reset: true,
    wait_ms: 0,
  });
  expect(tail.gap).toBe(false);
  expect(new TextDecoder().decode(new Uint8Array(tail.bytes))).toBe("xxxxxxxx");
  expect(tail.offset).toBe(start);
  expect(tail.next_offset).toBe("1048591");
  await api.detachExecution(session, id, observer.observer_id);
  await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
  const show = page.getByRole("button", { name: "Show panel", exact: true });
  if (await show.isVisible()) await show.click();
  const recent = page.getByRole("region", { name: "Recent terminal activity", exact: true });
  await recent.getByLabel("Recent activity").selectOption(entry.id);
  await expect(recent).toContainText(`Retained bytes ${start}–${end}`);
  await recent.getByRole("button", { name: "Reopen retained output", exact: true }).click();
  await expect(page.getByRole("region", { name: "Execution log", exact: true })).toContainText(
    "GAP-END",
    { timeout: 30_000 },
  );
  expect(harness.provider.requests).toHaveLength(0);
});
