import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

for (const mobile of [false, true]) {
  test(`unified existing terminal sources ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await createDirectSession(request, harness);
    const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
    await api.setPermissionApprovalMode(session, "auto_approve");
    await fs.writeFile(
      path.join(harness.runRoot, "workspace", "agent_build_fixture.py"),
      "def add(a, b):\n    return a + b\n",
    );
    const gate = new ScriptGate();
    const retainArguments = {
      session_id: "fixture-awaiting-existing-handle",
      retain: true,
      chars: "",
      yield_time_ms: 10,
    };
    harness.provider.enqueue(
      "all-source-pty",
      { token: "ALL_SOURCE_FIXTURE", requiredTools: ["exec_command"] },
      {
        kind: "function_call",
        name: "exec_command",
        callId: "all-source-pty",
        arguments: { cmd: "printf 'AGENT-PTY-READY\\n'; sleep 60", tty: true, yield_time_ms: 10 },
        stream: true,
      },
    );
    harness.provider.enqueue(
      "all-source-retain",
      { functionOutputCallId: "all-source-pty" },
      {
        kind: "function_call",
        name: "write_stdin",
        callId: "all-source-retain",
        arguments: retainArguments,
        stream: true,
      },
      gate,
    );
    harness.provider.enqueue(
      "all-source-pipe",
      { functionOutputCallId: "all-source-retain" },
      {
        kind: "function_call",
        name: "exec_command",
        callId: "all-source-pipe",
        arguments: {
          cmd: "python3 -c 'import py_compile; py_compile.compile(\"agent_build_fixture.py\", cfile=\"agent_build_fixture.pyc\", doraise=True)' && printf 'AGENT-PIPE-READY\\n' && sleep 60",
          tty: false,
          yield_time_ms: 60_000,
        },
        stream: true,
      },
    );
    harness.provider.enqueue(
      "all-source-settle",
      { functionOutputCallId: "all-source-pipe" },
      { kind: "text", text: "Agent fixture settled.", stream: true },
    );
    const launches: string[] = [];
    page.on("request", (event) => {
      if (event.method() === "POST" && event.url().endsWith("/user-terminals"))
        launches.push(event.url());
    });
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      await expect(show.or(pane)).toBeVisible();
      if (await show.isVisible()) await show.click();
    }
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
    // A phone shows one screen at a time, and an open row is a step past its list.
    const fromList = async (name: RegExp) => {
      const back = pane.getByRole("button", { name: "Open list", exact: true });
      if (mobile && (await back.isVisible())) await back.click();
      await pane.getByRole("button", { name }).click();
    };
    const human = (await api.listExecutions(session)).executions.find(
      (entry) => entry.origin === "human",
    )!;
    const run = await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
      data: { prompt: "ALL_SOURCE_FIXTURE" },
    });
    expect(run.status()).toBe(202);
    await gate.accepted;
    let agent = (await api.listExecutions(session)).executions.find(
      (entry) => entry.origin === "agent" && entry.representation === "pty",
    )!;
    expect(agent).toBeTruthy();
    expect(agent.retained).toBe(false);
    await fromList(/^PTY \d+, Agent, running$/);
    await expect(pane.locator(".xterm-accessibility")).toContainText("AGENT-PTY-READY");
    expect(
      (await api.listExecutions(session)).executions.find((entry) => entry.id === agent.id)
        ?.retained,
    ).toBe(false);
    retainArguments.session_id = agent.id;
    gate.release();
    await expect
      .poll(
        async () =>
          (await api.listExecutions(session)).executions.filter(
            (entry) => entry.alive && entry.representation === "log",
          ).length,
      )
      .toBe(1);
    const first = (await api.listExecutions(session)).executions;
    agent = first.find((entry) => entry.id === agent.id)!;
    const pipe = first.find((entry) => entry.origin === "agent" && entry.representation === "log")!;
    expect(agent.retained).toBe(true);
    expect(first.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([human.id, agent.id, pipe.id]),
    );
    expect(pipe.input).toBe(false);
    expect(pipe.resize).toBe(false);
    const busy = await request.post(`${harness.baseUrl}/sessions/${session}/user-commands`, {
      data: { request_id: randomUUID(), command: "true" },
    });
    expect(busy.status()).toBe(409);
    await fromList(/^Command \d+, Agent, running$/);
    await expect(pane.getByRole("region", { name: "Execution log" })).toContainText(
      "AGENT-PIPE-READY",
    );
    expect(
      (await fs.stat(path.join(harness.runRoot, "workspace", "agent_build_fixture.pyc"))).isFile(),
    ).toBe(true);
    await expect(pane.getByText(/Agent execution.*Read-only/)).toBeVisible();
    expect(harness.provider.requests).toHaveLength(3);
    await fromList(/^Stop Command \d+$/);
    await waitForRunIdle(request, harness, session);
    expect(
      (await api.listExecutions(session)).executions.find((entry) => entry.id === human.id)?.alive,
    ).toBe(true);
    expect(
      (await api.listExecutions(session)).executions.find((entry) => entry.id === agent.id)?.alive,
    ).toBe(true);
    const commandId = randomUUID();
    await api.submitShellCommand(session, {
      request_id: commandId,
      command:
        'python3 -c \'import sys; sys.stdout.write("x" * 65536 + "\\nBANG-READY\\n"); sys.stdout.flush()\'; sleep 60',
      timeout_ms: 60_000,
    });
    await expect
      .poll(
        async () =>
          (await api.listExecutions(session)).executions.filter(
            (entry) => entry.origin === "human_command" && entry.alive,
          ).length,
      )
      .toBe(1);
    const second = (await api.listExecutions(session)).executions;
    const bang = second.find(
      (entry) => entry.origin === "human_command" && entry.request_id === commandId,
    )!;
    expect(second.filter((entry) => entry.alive).map((entry) => entry.id)).toEqual(
      expect.arrayContaining([human.id, agent.id, bang.id]),
    );
    expect(bang.input).toBe(false);
    expect(bang.resize).toBe(false);
    await fromList(/^! command \d+, running$/);
    await expect(pane.getByRole("region", { name: "Execution log" })).toContainText("BANG-READY");
    await expect(
      pane.getByText(
        "Display limit reached. Showing the latest output; earlier text is hidden in this view.",
      ),
    ).toBeVisible();
    expect((await pane.getByRole("region", { name: "Execution log" }).textContent())?.length).toBe(
      65_536,
    );
    await expect(
      pane.getByText("Earlier output was discarded. The log was reset before replay."),
    ).toHaveCount(0);
    // A phone's menu is a sheet outside the pane.
    await pane.getByRole("button", { name: "Terminal options", exact: true }).click();
    await page.getByRole("button", { name: "Reconnect", exact: true }).click();
    await expect(pane.getByRole("region", { name: "Execution log" })).toContainText("BANG-READY");
    await expect(
      pane.getByText(
        "Display limit reached. Showing the latest output; earlier text is hidden in this view.",
      ),
    ).toBeVisible();
    expect((await pane.getByRole("region", { name: "Execution log" }).textContent())?.length).toBe(
      65_536,
    );
    await expect(
      pane.getByText("Earlier output was discarded. The log was reset before replay."),
    ).toHaveCount(0);
    expect(
      (await api.listExecutions(session)).executions
        .filter((entry) => entry.alive)
        .map((entry) => entry.id),
    ).toEqual(expect.arrayContaining([human.id, agent.id, bang.id]));
    expect(launches).toHaveLength(1);
    expect(harness.provider.requests).toHaveLength(4);
    await page.screenshot({
      path: testInfo.outputPath(`unified-${mobile ? "mobile" : "desktop"}.png`),
      fullPage: true,
    });
    if (mobile)
      expect(await page.locator("html").evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    await fromList(/^Stop ! command \d+$/);
    await expect
      .poll(async () => (await api.getShellCommand(session, commandId)).state)
      .toBe("cancelled");
    await api.stopExecution(session, agent.id);
    await api.stopExecution(session, human.id);
    harness.provider.assertConsumed();
  });
}
