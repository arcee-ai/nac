import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { installTools, pins } from "./workflow-lint-tools.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml"); // Existing locked release-tooling dependency.

// Recognize launcher paths by basename rather than one host's /usr/bin/env.
// Ambiguous env syntax must fail visibly instead of dropping an extensionless
// shell script from the inventory. No shebang text is executed to classify it.
function shebangShell(line) {
  if (!line.startsWith("#!")) return undefined;
  const words = line.slice(2).trim().split(/\s+/);
  let interpreter = path.posix.basename(words.shift() ?? "");
  if (interpreter === "env") {
    if (/["'\\]/.test(line)) throw new Error("unsupported quoted/escaped env shebang");
    while (words.length) {
      const word = words[0];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) words.shift();
      else if (word === "--") {
        words.shift();
        while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
        break;
      } else if (word.startsWith("--split-string=")) words[0] = word.slice(15);
      else if (["-i", "--ignore-environment", "-S", "--split-string"].includes(word)) words.shift();
      else if (["-u", "--unset", "-C", "--chdir", "-a", "--argv0"].includes(word)) {
        words.shift();
        if (!words.shift()) throw new Error("missing env shebang option argument");
      } else if (/^--(?:unset|chdir|argv0)=/.test(word)) words.shift();
      else if (word.startsWith("-")) throw new Error(`unsupported env shebang option: ${word}`);
      else break;
    }
    interpreter = path.posix.basename(words.shift() ?? "");
    if (!interpreter) throw new Error("missing env shebang interpreter");
  }
  if (["bash", "sh", "dash", "ksh"].includes(interpreter))
    return interpreter === "dash" ? "sh" : interpreter;
  if (/sh$|^ksh\d+$|^(?:fish|busybox)$/.test(interpreter)) {
    throw new Error(`unsupported shell dialect: ${interpreter}`);
  }
  return undefined;
}

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
    let length;
    try {
      length = fs.readSync(descriptor, prefix, 0, prefix.length, 0);
    } finally {
      fs.closeSync(descriptor);
    }
    const shebang = prefix.subarray(0, length).toString("utf8").split("\n", 1)[0];
    const shell = shebangShell(shebang);
    if (shell) scripts.push({ file, shell });
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
