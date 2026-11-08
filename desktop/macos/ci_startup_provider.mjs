// H-owned dummy fixture. Product P and external XCTest source Q never import it.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { ScriptedProvider } from "../../crates/nac-server/web/e2e/scripted-provider.ts";

const token = "FINDER_CONFIGURED_LOCAL_startup-home";
const provider = new ScriptedProvider();
provider.enqueue(
  "startup-home",
  { token },
  { kind: "text", text: "Finder configured local response.", stream: "request" },
);
let stopping = false;
let invalidLifecycle = false;
async function finish() {
  if (stopping) return;
  stopping = true;
  let consumed = true;
  try {
    provider.assertConsumed();
  } catch {
    consumed = false;
  }
  await provider.stop();
  const requests = provider.requests.map((request) => {
    const encoded = Buffer.from(JSON.stringify(request.body));
    return {
      method: request.method,
      path: request.path,
      matched_step: request.matchedStep ?? null,
      model: request.body?.model ?? null,
      stream: request.body?.stream === true,
      dummy_authorization_matches: request.headers.authorization === "Bearer preview-dummy-only",
      expected_token_present: encoded.includes(Buffer.from(token)),
      body_bytes: encoded.length,
      body_sha256: createHash("sha256").update(encoded).digest("hex"),
    };
  });
  const valid =
    !invalidLifecycle &&
    consumed &&
    requests.length === 1 &&
    requests.every(
      (request) =>
        request.method === "POST" &&
        request.path === "/responses" &&
        request.matched_step === "startup-home" &&
        request.model === "gpt-5.6-sol" &&
        request.dummy_authorization_matches &&
        request.expected_token_present &&
        request.body_bytes <= 2 * 1024 * 1024,
    );
  process.stdout.write(JSON.stringify({ event: "finished", consumed, requests, valid }) + "\n");
  process.exit(valid ? 0 : 1);
}
try {
  await provider.start();
  const shared = await readFile(
    new URL("../../crates/nac-server/web/e2e/scripted-provider.ts", import.meta.url),
  );
  process.stdout.write(
    JSON.stringify({
      event: "ready",
      base_url: provider.baseUrl,
      shared_source_sha256: createHash("sha256").update(shared).digest("hex"),
    }) + "\n",
  );
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (line === "finish") void finish();
    else {
      invalidLifecycle = true;
      process.stderr.write("Invalid fixed provider lifecycle request\n");
      void finish();
    }
  });
  input.on("close", () => {
    void finish();
  });
  process.once("SIGTERM", () => {
    void finish();
  });
} catch {
  process.stderr.write("Owned startup provider fixture unavailable\n");
  process.exit(1);
}
