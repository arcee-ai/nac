import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

for (const mobile of [false, true]) {
  test(`same-process terminal input control ${mobile ? "mobile" : "desktop"}`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await createDirectSession(request, harness);
    const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
    const workspace = path.join(harness.runRoot, "workspace");
    await fs.writeFile(
      path.join(workspace, "control_capture.py"),
      [
        "import os,sys,tty,json,termios",
        "name=sys.argv[1]; saved=termios.tcgetattr(0); tty.setraw(0)",
        "open(name+'.pid','w').write(str(os.getpid()))",
        "os.write(1,('CONTROL-READY:'+name+'\\r\\n').encode())",
        "try:",
        " while True:",
        "  data=os.read(0,4096)",
        "  if not data: break",
        "  with open(name+'.bytes','ab') as f: f.write(data)",
        "  os.write(1,('RECEIVED:'+name+':'+json.dumps(list(data))+'\\r\\n').encode())",
        "finally: termios.tcsetattr(0,termios.TCSANOW,saved)",
      ].join("\n") + "\n",
    );
    await api.setPermissionApprovalMode(session, "auto_approve");
    const gate = new ScriptGate();
    const retain = {
      session_id: "awaiting-native-handle",
      retain: true,
      chars: "",
      yield_time_ms: 10,
    };
    harness.provider.enqueue(
      "control-launch",
      { token: "CONTROL_LAUNCH", requiredTools: ["exec_command"] },
      {
        kind: "function_call",
        name: "exec_command",
        callId: "control-launch",
        arguments: { cmd: "python3 control_capture.py agent", tty: true, yield_time_ms: 10 },
        stream: "request",
      },
    );
    harness.provider.enqueue(
      "control-retain",
      { functionOutputCallId: "control-launch" },
      {
        kind: "function_call",
        name: "write_stdin",
        callId: "control-retain",
        arguments: retain,
        stream: "request",
      },
      gate,
    );
    harness.provider.enqueue(
      "control-ready",
      { functionOutputCallId: "control-retain" },
      {
        kind: "text",
        text: "Retained controller fixture ready.",
        stream: "request",
      },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
          data: { prompt: "CONTROL_LAUNCH" },
        })
      ).status(),
    ).toBe(202);
    await gate.accepted;
    const agent = (await api.listExecutions(session)).executions.find(
      (entry) => entry.origin === "agent" && entry.representation === "pty",
    )!;
    expect(agent).toBeTruthy();
    expect(agent.retained).toBe(false);
    retain.session_id = agent.id;
    gate.release();
    await waitForRunIdle(request, harness, session);
    await api.setPermissionApprovalMode(session, "manual");
    const agentPid = await fs.readFile(path.join(workspace, "agent.pid"), "utf8");
    await page.goto(`${harness.baseUrl}/#/session/${session}/terminal`);
    const pane = page.getByRole("region", { name: "Session terminal", exact: true });
    if (mobile) await page.getByRole("button", { name: "Open panel", exact: true }).click();
    else {
      const show = page.getByRole("button", { name: "Show panel", exact: true });
      await expect(show.or(pane)).toBeVisible();
      if (await show.isVisible()) await show.click();
    }
    await pane.getByRole("button", { name: /^PTY \d+, Agent, running$/ }).click();
    await expect(pane.locator(".xterm-accessibility")).toContainText("CONTROL-READY:agent");
    await expect(pane.getByLabel("Input controller")).toHaveText("Input: Agent");
    const bytes = async (name: string) =>
      Array.from(
        await fs.readFile(path.join(workspace, `${name}.bytes`)).catch(() => Buffer.alloc(0)),
      );
    // A phone's menu is a sheet outside the pane.
    const choose = async (name: string) => {
      await pane.getByRole("button", { name: "Terminal options", exact: true }).click();
      await page.getByRole("button", { name, exact: true }).click();
    };
    const type = async (text: string) => {
      await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
      // Playwright's non-ASCII keyboard.type uses insertText without intent.
      // Use the existing trusted browser composition path for UTF8 qualification.
      for (const part of text.split(/(π)/)) {
        if (part !== "π") await page.keyboard.type(part);
        else {
          const input = await page.context().newCDPSession(page);
          try {
            await input.send("Input.imeSetComposition", {
              text: part,
              selectionStart: 1,
              selectionEnd: 1,
            });
            await input.send("Input.insertText", { text: part });
          } finally {
            await input.detach();
          }
        }
      }
      await page.keyboard.press("Enter");
    };
    await choose("Take Control");
    await expect(pane.getByLabel("Input controller")).toHaveText("Input: Human");
    await type("agent-π<RET>");
    const agentHumanBytes = Array.from(new TextEncoder().encode("agent-π<RET>\r"));
    await expect.poll(() => bytes("agent")).toEqual(agentHumanBytes);
    expect(await fs.readFile(path.join(workspace, "agent.pid"), "utf8")).toBe(agentPid);
    expect(
      (await api.listExecutions(session)).executions.find((entry) => entry.id === agent.id)
        ?.retained,
    ).toBe(true);
    expect((await api.getPermissions(session)).requests).toHaveLength(0);

    const modelInput = async (
      tag: string,
      id: string,
      chars: string,
      beforeAllow?: () => Promise<void>,
    ) => {
      harness.provider.enqueue(
        tag,
        { token: tag, requiredTools: ["write_stdin"] },
        {
          kind: "function_call",
          name: "write_stdin",
          callId: tag,
          arguments: { session_id: id, chars, yield_time_ms: 10 },
          stream: "request",
        },
      );
      harness.provider.enqueue(
        `${tag}-done`,
        { functionOutputCallId: tag },
        {
          kind: "text",
          text: `${tag} settled.`,
          stream: "request",
        },
      );
      expect(
        (
          await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
            data: { prompt: tag },
          })
        ).status(),
      ).toBe(202);
      await expect.poll(async () => (await api.getPermissions(session)).requests.length).toBe(1);
      const approval = (await api.getPermissions(session)).requests[0];
      expect(approval.tool).toBe("write_stdin");
      // Dismiss the automatic Ask presentation while keeping the model paused.
      const dialog = page.getByRole("dialog", { name: "Permission required", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      if (beforeAllow) await beforeAllow();
      await api.replyPermission(session, approval.id, "once");
      await waitForRunIdle(request, harness, session);
    };
    await choose("Give Agent Control");
    await expect(pane.getByLabel("Input controller")).toHaveText("Input: Agent");
    await modelInput("AGENT_RETURN_INPUT", agent.id, "agent-model<RET>");
    await expect
      .poll(() => bytes("agent"))
      .toEqual([...agentHumanBytes, ...Array.from(new TextEncoder().encode("agent-model\r"))]);
    expect(await fs.readFile(path.join(workspace, "agent.pid"), "utf8")).toBe(agentPid);

    if (mobile) await pane.getByRole("button", { name: "Open list", exact: true }).click();
    await pane.getByRole("button", { name: /^New shell$/i }).click();
    await expect(pane.getByLabel("Input controller")).toHaveText("Input: Human");
    const human = (await api.listExecutions(session)).executions.find(
      (entry) => entry.origin === "human",
    )!;
    await type("python3 control_capture.py human");
    await expect(pane.locator(".xterm-accessibility")).toContainText("CONTROL-READY:human");
    const humanPid = await fs.readFile(path.join(workspace, "human.pid"), "utf8");
    await type("human-π<RET>");
    const humanBytes = Array.from(new TextEncoder().encode("human-π<RET>\r"));
    await expect.poll(() => bytes("human")).toEqual(humanBytes);
    await choose("Give Agent Control");
    await expect(pane.getByLabel("Input controller")).toHaveText("Input: Agent");
    // A phone shows the list on its own screen.
    const handedRow = pane.getByRole("button", { name: /^Shell \d+, Agent, / });
    if (!mobile) await expect(handedRow).toBeVisible();
    await modelInput("STALE_HUMAN_INPUT", human.id, "must-not-write<RET>", async () => {
      await choose("Reclaim Input");
      await expect(pane.getByLabel("Input controller")).toHaveText("Input: Human");
      if (!mobile) await expect(handedRow).toHaveCount(0);
    });
    expect(await bytes("human")).toEqual(humanBytes);
    await type("fresh-human");
    await expect
      .poll(() => bytes("human"))
      .toEqual([...humanBytes, ...Array.from(new TextEncoder().encode("fresh-human\r"))]);
    expect(await fs.readFile(path.join(workspace, "human.pid"), "utf8")).toBe(humanPid);
    const permissions = await api.getPermissions(session);
    expect(permissions.approval_mode).toBe("manual");
    expect(permissions.requests).toHaveLength(0);
    expect(permissions.grants).toHaveLength(0);
    await page.screenshot({
      path: testInfo.outputPath("same-process-input-control.png"),
      fullPage: true,
    });
    await api.stopExecution(session, human.id);
    await api.stopExecution(session, agent.id);
  });
}
