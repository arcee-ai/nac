import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import { expect, waitForRunIdle, type EmbeddedHarness } from "./harness";
import { ScriptGate } from "./scripted-provider";

export type Question = {
  request: {
    session_id: string;
    request_id: string;
    run_id: string;
    generation: string;
    responder_class: "information" | "human_decision";
    text: string;
  };
  revision: number;
  status: string;
  answer: null | {
    answer: string;
    continuation_run_id: string;
    inbox_item_id: number;
    revision: number;
  };
  continuation_state: string | null;
};

export type Evidence = {
  case: string;
  calls: Record<string, unknown>;
  [key: string]: unknown;
};

type NativeCall = {
  id: string;
  caller: string;
  request: APIRequestContext;
  harness: EmbeddedHarness;
  evidence: Evidence;
  end: ScriptGate;
};

export async function matched(harness: EmbeddedHarness, id: string) {
  await expect
    .poll(() => harness.provider.requests.some((entry) => entry.matchedStep === id))
    .toBe(true);
  return harness.provider.requests.find((entry) => entry.matchedStep === id)!;
}

export function toolOutput(body: unknown, id: string): string {
  const input = (body as { input?: Array<{ type?: string; call_id?: string; output?: string }> })
    .input;
  expect(Array.isArray(input)).toBe(true);
  const result = input!.find(
    (entry) => entry.type === "function_call_output" && entry.call_id === id,
  );
  expect(typeof result?.output).toBe("string");
  return result!.output!;
}

// The provider requests a real registered native call. Its next model request
// supplies the actual harness-produced output; this helper never injects it.
export async function startNative(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  caller: string,
  evidence: Evidence,
  id: string,
  name: string,
  args: Record<string, unknown>,
): Promise<NativeCall> {
  const end = new ScriptGate();
  harness.provider.enqueue(
    `${id}-call`,
    { token: id, requiredTools: [name] },
    { kind: "function_call", stream: "request", name, callId: id, arguments: args },
  );
  harness.provider.enqueue(
    `${id}-result`,
    { functionOutputCallId: id },
    { kind: "text", stream: "request", text: `${id} inspected` },
    end,
  );
  const response = await request.post(`${harness.baseUrl}/sessions/${caller}/runs`, {
    data: { prompt: id },
  });
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  const call = await matched(harness, `${id}-call`);
  evidence.calls[id] = {
    caller,
    name,
    args,
    accepted,
    provider_call: call.matchedStep,
    provider_call_sha256: digest(call.body),
  };
  return { id, caller, request, harness, evidence, end };
}

export async function finishNative(call: NativeCall): Promise<string> {
  try {
    const result = await matched(call.harness, `${call.id}-result`);
    const output = toolOutput(result.body, call.id);
    Object.assign(call.evidence.calls[call.id] as object, {
      output,
      provider_result: result.matchedStep,
      provider_result_sha256: digest(result.body),
    });
    call.end.release();
    await waitForRunIdle(call.request, call.harness, call.caller);
    return output;
  } finally {
    call.end.release();
  }
}

export async function native<T>(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  caller: string,
  evidence: Evidence,
  id: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  return JSON.parse(
    await finishNative(await startNative(request, harness, caller, evidence, id, name, args)),
  ) as T;
}

export async function question(request: APIRequestContext, harness: EmbeddedHarness, q: Question) {
  const response = await request.get(
    `${harness.baseUrl}/sessions/${q.request.session_id}/questions/${q.request.request_id}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as Question;
}

export function answer(q: Question, text: string) {
  return {
    request_id: q.request.request_id,
    run_id: q.request.run_id,
    generation: q.request.generation,
    expected_revision: q.revision,
    answer: text,
  };
}

export function waitArgs(q: Question, cursor: string | null, goal: string | null, ms = 0) {
  return {
    targets: [
      {
        session_id: q.request.session_id,
        project_id: null,
        mode: goal ? "goal" : "run",
        run_id: goal ? null : q.request.run_id,
        goal_id: goal,
        after_cursor: cursor,
      },
    ],
    timeout_ms: ms,
  };
}

export async function createQuestion(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  session: string,
  evidence: Evidence,
  id: string,
  responder: "information" | "human_decision",
  goalStatus?: "active" | "paused",
  requestId = id,
) {
  const gate = new ScriptGate();
  const text = `Exact ${id} choice`;
  harness.provider.enqueue(
    `${id}-create`,
    { token: `START_${id}`, requiredTools: ["request_question"] },
    {
      kind: "function_call",
      stream: "request",
      name: "request_question",
      callId: `${id}-question`,
      arguments: {
        request_id: requestId,
        text,
        choices: ["CSV", "JSON"],
        responder_class: responder,
      },
    },
    gate,
  );
  const started = await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
    data: { prompt: `START_${id}` },
  });
  expect(started.status()).toBe(202);
  await gate.accepted;
  let goal: { goal_id: string; status: string; version: number } | null = null;
  try {
    if (goalStatus) {
      const created = await request.post(`${harness.baseUrl}/sessions/${session}/goal`, {
        data: { objective: `Finish ${id} after its exact decision` },
      });
      expect(created.ok()).toBe(true);
      goal = await created.json();
      if (goalStatus === "paused") {
        const paused = await request.patch(
          `${harness.baseUrl}/sessions/${session}/goal/${goal!.goal_id}`,
          {
            data: { expected_version: goal!.version, status: "paused" },
          },
        );
        expect(paused.ok()).toBe(true);
        goal = await paused.json();
      }
    }
  } finally {
    gate.release();
  }
  await waitForRunIdle(request, harness, session);
  const rows = await (await request.get(`${harness.baseUrl}/sessions/${session}/questions`)).json();
  const exact = (rows as Question[]).filter((row) => row.request.request_id === requestId);
  expect(exact).toHaveLength(1);
  expect((rows as Question[]).filter((row) => row.status === "pending")).toHaveLength(1);
  const q = exact[0];
  expect(q.status).toBe("pending");
  expect(q.request).toMatchObject({ session_id: session, request_id: requestId, text });
  expect(q.request.generation).toBe(q.request.run_id);
  evidence[id] = { session, goal, question: q, source_run: await started.json() };
  return { q, goal };
}

export async function permissions(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  session: string,
) {
  const response = await request.get(`${harness.baseUrl}/sessions/${session}/permissions`);
  expect(response.ok()).toBe(true);
  return await response.json();
}

export async function configuration(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  session: string,
) {
  const response = await request.get(`${harness.baseUrl}/sessions/${session}/config`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

export async function identity(request: APIRequestContext, harness: EmbeddedHarness) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  const response = await request.get(harness.baseUrl);
  expect(response.ok()).toBe(true);
  const match = (await response.text()).match(
    /<script id="nac-presentation-binding" type="application\/json">([^<]+)<\/script>/,
  );
  expect(match).not.toBeNull();
  const binding = JSON.parse(match![1]) as { scope: { release: string; incarnation: string } };
  expect(JSON.parse(binding.scope.release)[3]).toBe(stdout.trim());
  return {
    source: stdout.trim(),
    base: process.env.NAC_QUESTION_BASE_SHA ?? "6df5e4b5a58541d6ad41e50f24bfcb07011684fe",
    binary: harness.binaryPath,
    binary_sha256: createHash("sha256")
      .update(await fs.readFile(harness.binaryPath))
      .digest("hex"),
    ...binding.scope,
  };
}

export async function retain(info: TestInfo, harness: EmbeddedHarness, evidence: Evidence) {
  const processFile = path.join(harness.runRoot, "process.json");
  const state = await fs.lstat(processFile);
  expect(state.isFile() && !state.isSymbolicLink()).toBe(true);
  await fs.link(processFile, info.outputPath(`all472-${evidence.case}-cleanup.json`));
  const bytes = JSON.stringify(evidence, null, 2);
  expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(131_072);
  const file = info.outputPath(`all472-${evidence.case}-proof.json`);
  await fs.writeFile(file, bytes);
  await info.attach(`ALL472-${evidence.case}`, { path: file, contentType: "application/json" });
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
