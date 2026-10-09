import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import {
  UserTerminalConnection,
  type UserTerminalRenderer,
} from "../packages/nac-client/dist/userTerminalConnection.js";
import { createDirectSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

// Exercises the actual embedded server, PTY and model loop. Browser renderer
// fidelity belongs to the separate terminal presentation journey.
class ByteSink implements UserTerminalRenderer {
  chunks: Uint8Array[] = [];
  resets = 0;
  async write(bytes: Uint8Array) {
    this.chunks.push(bytes);
  }
  async reset() {
    this.chunks = [];
    this.resets += 1;
  }
  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

async function readUntil(connection: UserTerminalConnection, sink: ByteSink, text: string) {
  const signal = AbortSignal.timeout(10_000);
  while (!sink.text().includes(text)) await connection.readNext(signal);
}

test("human terminal and active agents share files without sharing cancellation or observation", async ({
  harness,
  request,
  page,
}) => {
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  const session = await createDirectSession(request, harness);
  await api.setPermissionApprovalMode(session, "auto_approve");
  const terminal = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: randomUUID(),
    cols: 80,
    rows: 24,
  });
  const sink = new ByteSink();
  const observer = new UserTerminalConnection(api, session, terminal.terminal_id, sink, {
    pageLimit: 512,
    waitMs: 100,
  });
  await observer.attach();
  const completion = new ScriptGate();
  harness.provider.enqueue(
    "terminal-concurrent-write",
    { token: "TERMINAL_CONCURRENT_WRITE", requiredTools: ["write"] },
    {
      kind: "function_call",
      name: "write",
      callId: "terminal-agent-write",
      arguments: { path: "shared.txt", content: "AGENT_FILE_VALUE\n", expected_revision: null },
    },
  );
  harness.provider.enqueue(
    "terminal-concurrent-complete",
    { functionOutputCallId: "terminal-agent-write" },
    { kind: "text", text: "concurrent write complete", stream: true },
    completion,
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
        data: { prompt: "TERMINAL_CONCURRENT_WRITE" },
      })
    ).status(),
  ).toBe(202);
  await completion.accepted;
  await page.goto(`${harness.baseUrl}/#/session/${session}/files`);
  await expect(page.getByRole("button", { name: "Stop run", exact: true })).toBeVisible();
  expect(await fs.readFile(path.join(harness.runRoot, "workspace/shared.txt"), "utf8")).toBe(
    "AGENT_FILE_VALUE\n",
  );
  await observer.input(
    new TextEncoder().encode(
      "cat shared.txt; printf 'human-written-file\\n' > human.txt; test -f human.txt && printf '\\124\\105\\123\\124\\137\\120\\101\\123\\123\\105\\104\\n'\r",
    ),
  );
  await readUntil(observer, sink, "TEST_PASSED");
  expect(sink.text()).toContain("AGENT_FILE_VALUE");
  expect(await fs.readFile(path.join(harness.runRoot, "workspace/human.txt"), "utf8")).toBe(
    "human-written-file\n",
  );
  await observer.resize(91, 31);
  await observer.input(new TextEncoder().encode("stty size\r"));
  await readUntil(observer, sink, "31 91");
  await observer.detach();
  expect((await api.getUserTerminal(session, terminal.terminal_id)).alive).toBe(true);
  await observer.attach();
  await readUntil(observer, sink, "TEST_PASSED");
  expect(sink.resets).toBe(2);
  // A second session at the same location consumes the human-written file
  // through its real model tool, while the first model is still active.
  const second = await createDirectSession(request, harness);
  await api.setPermissionApprovalMode(second, "auto_approve");
  harness.provider.enqueue(
    "terminal-second-read",
    { token: "TERMINAL_SECOND_READ", requiredTools: ["read"] },
    {
      kind: "function_call",
      name: "read",
      callId: "terminal-read-human",
      arguments: { path: "human.txt" },
    },
  );
  harness.provider.enqueue(
    "terminal-second-complete",
    { functionOutputCallId: "terminal-read-human" },
    { kind: "text", text: "human file consumed" },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${second}/runs`, {
        data: { prompt: "TERMINAL_SECOND_READ" },
      })
    ).status(),
  ).toBe(202);
  await waitForRunIdle(request, harness, second);
  expect(
    JSON.stringify(
      harness.provider.requests.find((entry) => entry.matchedStep === "terminal-second-complete")
        ?.body,
    ),
  ).toContain("human-written-file");
  const surviving = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: randomUUID(),
    cols: 80,
    rows: 24,
  });
  await api.terminateTerminal(session, terminal.terminal_id);
  expect((await api.getUserTerminal(session, terminal.terminal_id)).alive).toBe(false);
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${session}`)).json()).active_run,
  ).toBeTruthy();
  await observer.detach();
  await api.cancelActiveRun(session);
  await waitForRunIdle(request, harness, session);
  completion.release();
  expect((await api.getUserTerminal(session, surviving.terminal_id)).alive).toBe(true);
  await api.terminateTerminal(session, surviving.terminal_id);
  harness.provider.assertConsumed();
});

test("human file changes retain agent revision checks and shell loss is honest after restart", async ({
  harness,
  request,
}) => {
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  const session = await createDirectSession(request, harness);
  await api.setPermissionApprovalMode(session, "auto_approve");
  const original = "original agent reading\n";
  const file = path.join(harness.runRoot, "workspace/revision.txt");
  await fs.writeFile(file, original);
  const revision = `sha256:${createHash("sha256").update(original).digest("hex")}`;
  const boundary = new ScriptGate();
  harness.provider.enqueue(
    "terminal-revision-read",
    { token: "TERMINAL_REVISION_READ" },
    {
      kind: "function_call",
      name: "read",
      callId: "terminal-revision-read",
      arguments: { path: "revision.txt" },
    },
  );
  harness.provider.enqueue(
    "terminal-revision-write",
    { functionOutputCallId: "terminal-revision-read" },
    {
      kind: "function_call",
      name: "write",
      callId: "terminal-stale-write",
      arguments: {
        path: "revision.txt",
        content: "stale overwrite\n",
        expected_revision: revision,
      },
    },
    boundary,
  );
  harness.provider.enqueue(
    "terminal-revision-complete",
    { functionOutputCallId: "terminal-stale-write" },
    {
      kind: "text",
      text: "revision conflict consumed",
    },
  );
  const terminal = await api.openUserTerminal(session, {
    protocol_version: 1,
    launch_id: randomUUID(),
    cols: 80,
    rows: 24,
  });
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
        data: { prompt: "TERMINAL_REVISION_READ" },
      })
    ).status(),
  ).toBe(202);
  await boundary.accepted;
  await api.inputUserTerminal(session, terminal.terminal_id, {
    protocol_version: 1,
    bytes: Array.from(new TextEncoder().encode("printf 'human replacement\\n' > revision.txt\r")),
  });
  await expect.poll(() => fs.readFile(file, "utf8")).toBe("human replacement\n");
  boundary.release();
  await waitForRunIdle(request, harness, session);
  expect(await fs.readFile(file, "utf8")).toBe("human replacement\n");
  const continuation = harness.provider.requests.find(
    (entry) => entry.matchedStep === "terminal-revision-complete",
  )?.body as { input: Array<{ type?: string; call_id?: string; output?: string }> };
  const result = JSON.parse(
    continuation.input.find(
      (entry) => entry.type === "function_call_output" && entry.call_id === "terminal-stale-write",
    )!.output!,
  );
  expect(result).toMatchObject({ error: "stale_revision", committed: false });
  expect(result.current_revision).not.toBe(revision);
  expect((await api.getUserTerminal(session, terminal.terminal_id)).alive).toBe(true);
  await harness.restart("1");
  const replacement = createNacApi(
    new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }),
  );
  await expect(replacement.getUserTerminal(session, terminal.terminal_id)).rejects.toMatchObject({
    status: 409,
  });
  expect((await replacement.listUserTerminals(session)).terminals).toEqual([]);
  harness.provider.assertConsumed();
});
