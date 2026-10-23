// The upstream suite discards client exit status; retain it independently.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const scenario = process.env.MCP_CONFORMANCE_SCENARIO;
if (!scenario || !process.env.NAC_MCP_RECEIPTS || !process.env.NAC_MCP_CLIENT) {
  throw new Error("missing conformance launch binding");
}
const environment = { ...process.env };
// Safe control: connect/list normally but omit the required add_numbers call.
if (process.env.NAC_MCP_SEED === "omit-tool-call" && scenario === "tools_call") {
  environment.MCP_CONFORMANCE_SCENARIO = "initialize";
}
const child = spawnSync(process.env.NAC_MCP_CLIENT, process.argv.slice(2), {
  env: environment,
  encoding: "utf8",
  timeout: 35_000,
  maxBuffer: 16 * 1024 * 1024,
});
writeFileSync(join(process.env.NAC_MCP_RECEIPTS, `${encodeURIComponent(scenario)}.json`), JSON.stringify({
  scenario,
  revision: process.env.MCP_CONFORMANCE_PROTOCOL_VERSION,
  status: child.status,
  signal: child.signal,
  error: child.error?.message ?? null,
  stderr: child.stderr ?? "",
}), { flag: "wx" });
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");
process.exit(child.status ?? 2);
