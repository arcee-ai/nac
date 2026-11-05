#!/usr/bin/env node
// Remeasure immutable generated graphs with ONE startup graph reader and zlib.
// Stage selection is explicit: unrelated dev movement is not migration budget.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "../../..");
const graphScript = fs.readFileSync(path.join(web, "scripts/startup-size.mjs"));
const paths = [
  "crates/nac-server/assets/dist",
  "crates/nac-server/web/packages/nac-presentation/dist",
];
const run = (command, args, cwd = repository) =>
  execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { values } = parseArgs({
  options: {
    baseline: { type: "string" },
    candidate: { type: "string" },
    stages: { type: "string" },
    output: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  process.stdout.write(
    "Usage: node scripts/presentation-budget.mjs --baseline SHA --candidate SHA --stages /absolute/stages.json --output /absolute/budget.json\n" +
      'stages.json: [{"ticket":"ALL-520","baseline":"SHA","candidate":"SHA"}, ...]\n' +
      "Supply the reviewed inherited pilot/525/521 pairs; the requested final range is added once.\n" +
      "Reads committed artifacts without building or checking out branches. Run only in an idle measurement window.\n",
  );
} else {
  assert(
    values.baseline && values.candidate && values.stages && values.output,
    "all four arguments are required",
  );
  assert(
    path.isAbsolute(values.output) && path.isAbsolute(values.stages),
    "use absolute evidence paths",
  );
  const output = path.resolve(values.output);
  assert(!output.startsWith(repository + path.sep), "write evidence outside source checkout");
  const stages = JSON.parse(fs.readFileSync(values.stages, "utf8"));
  assert(Array.isArray(stages), "stages must be an array");
  for (const ticket of ["ALL-520", "ALL-525", "ALL-521"])
    assert.equal(
      stages.filter((stage) => stage.ticket === ticket).length,
      1,
      `name exactly one inherited ${ticket} pair`,
    );
  assert.equal(
    stages.length,
    3,
    "only inherited pilot/525/521 pairs belong in stages; final range is separate",
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nac-presentation-budget-"));
  try {
    const revisions = new Map();
    const measure = (ref) => {
      const revision = run("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
      if (revisions.has(revision)) return revisions.get(revision);
      const root = path.join(temporary, revision);
      fs.mkdirSync(root);
      const archive = path.join(temporary, `${revision}.tar`);
      run("git", ["archive", "--format=tar", `--output=${archive}`, revision, "--", ...paths]);
      run("tar", ["-xf", archive, "-C", root]);
      const script = path.join(root, "crates/nac-server/web/scripts/startup-size.mjs");
      fs.mkdirSync(path.dirname(script), { recursive: true });
      fs.writeFileSync(script, graphScript);
      const graphs = JSON.parse(run(process.execPath, [script, "--json"], root));
      for (const graph of graphs) {
        const graphRoot = path.join(root, paths[graph.name === "app" ? 0 : 1]);
        for (const entry of graph.files)
          entry.sha256 = hash(fs.readFileSync(path.join(graphRoot, entry.file)));
        const startupFiles = new Set(graph.files.map((entry) => entry.file));
        graph.nonStartupJavaScript = fs
          .readdirSync(graphRoot, { recursive: true })
          .filter((name) => name.endsWith(".js") && !startupFiles.has(name))
          .sort();
      }
      const result = { revision, graphs };
      revisions.set(revision, result);
      return result;
    };
    const compare = (stage) => {
      assert(
        typeof stage.ticket === "string" && stage.baseline && stage.candidate,
        "incomplete measurement pair",
      );
      const baseline = measure(stage.baseline),
        candidate = measure(stage.candidate);
      return {
        ticket: stage.ticket,
        baseline: baseline.revision,
        candidate: candidate.revision,
        delta: candidate.graphs.map((graph) => {
          const before = baseline.graphs.find((entry) => entry.name === graph.name);
          assert(before, `missing baseline graph: ${graph.name}`);
          return {
            name: graph.name,
            jsGzip: graph.jsGzip - before.jsGzip,
            cssGzip: graph.cssGzip - before.cssGzip,
          };
        }),
      };
    };
    const comparisons = [
      ...stages,
      { ticket: "selected-final-range", baseline: values.baseline, candidate: values.candidate },
    ].map(compare);
    const cumulative = ["app", "presentation"].map((name) => {
      const deltas = comparisons.map((stage) => stage.delta.find((graph) => graph.name === name));
      const jsGzip = deltas.reduce((sum, graph) => sum + graph.jsGzip, 0);
      const cssGzip = deltas.reduce((sum, graph) => sum + graph.cssGzip, 0);
      return {
        name,
        jsGzip,
        cssGzip,
        limitJs: 50 * 1024,
        limitCss: 15 * 1024,
        withinBudget: jsGzip <= 50 * 1024 && cssGzip <= 15 * 1024,
      };
    });
    const receipt = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      toolchain: {
        node: process.version,
        zlib: process.versions.zlib,
        gzipLevel: 9,
        platform: process.platform,
        arch: process.arch,
      },
      graphScriptSha256: hash(graphScript),
      comparisons,
      cumulative,
      revisions: [...revisions.values()],
      limitation:
        "Committed complete graphs compressed together. Pair selection must exclude unrelated dev changes; this script does not establish source equivalence, browser timing, lazy-route execution or human visual acceptance.",
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
    process.stdout.write(`${JSON.stringify(cumulative)}\n${output}\n`);
    if (cumulative.some((graph) => !graph.withinBudget)) process.exitCode = 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
