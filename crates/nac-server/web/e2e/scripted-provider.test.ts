import { afterEach, expect, test } from "vitest";

import { ScriptGate, ScriptedProvider } from "./scripted-provider";

const providers: ScriptedProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.stop()));
});
async function providerFor(stream: boolean | "request" | undefined, gate?: ScriptGate) {
  const provider = new ScriptedProvider();
  await provider.start();
  providers.push(provider);
  provider.enqueue(
    "wire",
    { token: "WIRE_PROBE" },
    { kind: "text", text: "wire answer", stream },
    gate,
  );
  return provider;
}
function send(provider: ScriptedProvider, stream: boolean | undefined) {
  return fetch(`${provider.baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "WIRE_PROBE", ...(stream == null ? {} : { stream }) }),
    signal: AbortSignal.timeout(2_000),
  });
}
function assertWire(body: string, streaming: boolean) {
  if (streaming) {
    expect(body).toMatch(/^data: /);
    expect(body).toContain('"type":"response.completed"');
    expect(body).toContain('"text":"wire answer"');
  } else {
    expect(JSON.parse(body).output[0].content[0].text).toBe("wire answer");
  }
}

test.each([
  ["opt-in true request", "request", true, true],
  ["opt-in false request", "request", false, false],
  ["opt-in omitted request", "request", undefined, false],
  ["explicit true fixture stays SSE", true, false, true],
  ["explicit false fixture stays JSON", false, true, false],
  ["omitted fixture stays JSON", undefined, true, false],
] as const)("scripted provider HTTP wire: %s", async (_name, mode, requested, streaming) => {
  const provider = await providerFor(mode);
  const response = await send(provider, requested);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    streaming ? "text/event-stream" : "application/json",
  );
  assertWire(await response.text(), streaming);
  provider.assertConsumed();
});

test.each([true, false, undefined])(
  "request-shaped gated HTTP headers and body agree for request stream=%s",
  async (requested) => {
    const gate = new ScriptGate();
    const provider = await providerFor("request", gate);
    const pending = send(provider, requested);
    await gate.accepted;
    try {
      if (requested === true) {
        // The real HTTP response must expose SSE headers before releasing a slow
        // scripted body, so deliberate latency cannot cause a protocol retry.
        const response = await pending;
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        gate.release();
        assertWire(await response.text(), true);
      } else {
        gate.release();
        const response = await pending;
        expect(response.headers.get("content-type")).toBe("application/json");
        assertWire(await response.text(), false);
      }
    } finally {
      gate.release();
    }
    provider.assertConsumed();
  },
);
