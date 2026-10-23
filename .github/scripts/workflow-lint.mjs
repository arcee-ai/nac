import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { installTools, pins } from "./workflow-lint-tools.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Existing locked release-tooling dependency.

export function inventory(root) {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const workflows = [];
  const scripts = [];
  const blocks = [];
  for (const file of files) {
    const descriptor = fs.openSync(path.join(root, file), "r");
    const prefix = Buffer.alloc(256);
    try {
      fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    const shebang = prefix.toString("utf8").split("\n", 1)[0];
    const shell = shebang.match(
      /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?)?(?:\S*\/)?(bash|sh|dash|ksh|zsh|fish|csh|tcsh)(?:\s|$)/,
    )?.[1];
    if (shell && !["bash", "sh", "dash", "ksh"].includes(shell))
      throw new Error(`unsupported shell dialect ${shell}: ${file}`);
    if (shell) scripts.push({ file, shell: shell === "dash" ? "sh" : shell });
    else if (/\.(?:sh|bash|dash|ksh|zsh|fish|csh|tcsh)$/.test(file))
      throw new Error(`shell script needs a supported explicit shebang: ${file}`);
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) continue;
    workflows.push(file);
    const workflow = YAML.parse(fs.readFileSync(path.join(root, file), "utf8"));
    for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
      for (const [index, step] of (job.steps ?? []).entries()) {
        if (typeof step.run !== "string") continue;
        const dialect =
          step.shell ?? job.defaults?.run?.shell ?? workflow.defaults?.run?.shell ?? "bash";
        if (!["bash", "sh"].includes(dialect))
          throw new Error(`uncovered embedded dialect ${dialect}: ${file}/${jobId}/${index}`);
        blocks.push({ file, job: jobId, step: index + 1, shell: dialect });
      }
    }
  }
  if (!workflows.length || !scripts.length) throw new Error("empty workflow or shell inventory");
  return { workflows, scripts, blocks };
}

export function lint(root, tools, { report = true } = {}) {
  const inputs = inventory(root);
  if (report) {
    console.log(`actionlint ${pins.actionlint.version}; ShellCheck ${pins.shellcheck.version}`);
    for (const file of inputs.workflows) console.log(`workflow ${file}`);
    for (const { file, shell } of inputs.scripts) console.log(`script [${shell}] ${file}`);
    for (const { file, job, step, shell } of inputs.blocks)
      console.log(`embedded [${shell}] ${file}/${job}/step-${step}`);
  }
  // Explicit paths cover every tracked workflow; no discovery filters, ignores,
  // pyflakes or ambient ShellCheck binary/configuration can change this gate.
  const action = spawnSync(
    tools.actionlint,
    ["-color", "-shellcheck", tools.shellcheck, "-pyflakes", "", ...inputs.workflows],
    { cwd: root, encoding: "utf8", env: { ...process.env, SHELLCHECK_OPTS: "--norc" } },
  );
  let failed = action.status !== 0 || Boolean(action.error);
  let output = (action.stdout ?? "") + (action.stderr ?? "") + (action.error?.message ?? "");
  for (const { file, shell } of inputs.scripts) {
    const result = spawnSync(tools.shellcheck, ["--norc", "--shell", shell, file], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, SHELLCHECK_OPTS: "" },
    });
    failed ||= result.status !== 0 || Boolean(result.error);
    output += (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.message ?? "");
  }
  return { failed, output, inputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const start = performance.now();
  const tools = installTools();
  try {
    const result = lint(process.cwd(), tools);
    process.stdout.write(result.output);
    console.log(`Workflow/shell lint: ${((performance.now() - start) / 1000).toFixed(2)}s`);
    if (result.failed) process.exitCode = 1;
  } finally {
    tools.cleanup();
  }
}
