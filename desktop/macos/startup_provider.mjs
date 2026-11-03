#!/usr/bin/env node
// Test-only control of the existing shared provider. No real credentials.
import readline from "node:readline";
import { ScriptedProvider } from "../../crates/nac-server/web/e2e/scripted-provider.ts";

const provider = new ScriptedProvider();
await provider.start();
console.log(JSON.stringify({ base_url: provider.baseUrl }));
for await (const line of readline.createInterface({ input: process.stdin })) {
  if (line.length > 4096) throw new Error("Oversized fixture command");
  const command = JSON.parse(line);
  if (command.kind === "queue") {
    if (!/^startup-[a-z-]+$/.test(command.scenario)) throw new Error("Unknown fixture scenario");
    provider.enqueue(command.scenario, { token: "FINDER_CONFIGURED_LOCAL_" + command.scenario },
      { kind: "text", text: "Finder configured local response.", stream: "request" });
    console.log(JSON.stringify({ queued: command.scenario }));
  } else if (command.kind === "finish") {
    provider.assertConsumed();
    console.log(JSON.stringify({ passed: true, requests: provider.requests.map((request) => ({
      step: request.matchedStep, dummy_authorization: request.headers.authorization === "Bearer preview-dummy-only",
    })) }));
    break;
  } else { throw new Error("Unknown fixture command"); }
}
process.stdin.destroy();
await provider.stop();
