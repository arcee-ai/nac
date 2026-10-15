import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

interface LockedRuntimeDependency {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
}

/** Supply verified archive inputs; the consumer retains its own empty cache. */
export async function packedRuntimeDependencies(
  repository: string,
  web: string,
  consumer: string,
): Promise<Record<string, string>> {
  const manifest = JSON.parse(await fs.readFile(path.join(repository, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const lock = JSON.parse(await fs.readFile(path.join(web, "package-lock.json"), "utf8")) as {
    packages: Record<string, LockedRuntimeDependency>;
  };
  const archives = path.join(consumer, "runtime-dependencies");
  await fs.mkdir(archives);
  // make setup populates this cache with the locked archives. Reading those
  // inputs is offline too; absence is a failure, never a network fallback.
  const sourceCache = (
    await execute("npm", ["config", "get", "cache"], { cwd: web })
  ).stdout.trim();
  const inputs: Record<string, string> = {};
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    const locked = lock.packages[`node_modules/${name}`];
    if (
      !locked ||
      version !== locked.version ||
      !locked.resolved.startsWith("https://registry.npmjs.org/") ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(locked.integrity) ||
      Object.keys(locked.dependencies ?? {}).length !== 0
    ) {
      throw new Error(`Packed runtime dependency ${name} must be an exact locked leaf archive`);
    }
    const { stdout } = await execute(
      "npm",
      [
        "pack",
        locked.resolved,
        "--offline",
        "--ignore-scripts",
        "--json",
        "--cache",
        sourceCache,
        "--pack-destination",
        archives,
      ],
      { cwd: web },
    );
    const reports = JSON.parse(stdout) as { name: string; version: string; filename: string }[];
    const report = reports[0];
    if (
      reports.length !== 1 ||
      !report ||
      report.name !== name ||
      report.version !== version ||
      path.basename(report.filename) !== report.filename
    ) {
      throw new Error(`Unexpected packed runtime archive for ${name}`);
    }
    const bytes = await fs.readFile(path.join(archives, report.filename));
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    if (integrity !== locked.integrity) {
      throw new Error(`Packed runtime archive integrity mismatch for ${name}`);
    }
    inputs[name] = `file:./runtime-dependencies/${report.filename}`;
  }
  return inputs;
}
