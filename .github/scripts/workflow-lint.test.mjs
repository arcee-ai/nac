import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { inventory, lint } from "./workflow-lint.mjs";
import { installTools, pins, verifyArchive } from "./workflow-lint-tools.mjs";
import { requiredJobs, requireComplete } from "./pr-checks.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const tools = installTools();
test.after(() => tools.cleanup());

// Every negative exercises the same tracked-input discovery and real binaries
// as make lint-workflows, in a disposable Git index; scripts are never executed.
function fixture(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nac-lint-fixture-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const [file, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), body);
    }
    execFileSync("git", ["add", "."], { cwd: root });
    return callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function workflow(run, extra = {}) {
  return YAML.stringify({
    name: "Lint fixture",
    on: "push",
    jobs: {
      check: { "runs-on": "ubuntu-latest", steps: [{ run }], ...extra },
    },
  });
}

const clean = () => ({
  ".github/workflows/check.yml": workflow('printf "%s\\n" "$HOME"'),
  "portable.sh": '#!/bin/sh\nset -eu\nprintf "%s\\n" "$HOME"\n',
});

function fails(files, diagnostic) {
  fixture(files, (root) => {
    const result = lint(root, tools, { report: false });
    assert.equal(result.failed, true, result.output);
    assert.match(result.output, diagnostic);
  });
}

test("clean baseline uses Bash/POSIX dialects, defaults and extensionless/unusual tracked paths", () => {
  fixture(
    {
      ...clean(),
      ".github/workflows/check.yml": workflow('values=(one two); printf "%s\\n" "${values[@]}"', {
        defaults: { run: { shell: "sh" } },
        steps: [
          { run: 'test -n "$HOME"' },
          { shell: "bash", run: 'values=(one two); printf "%s\\n" "${values[@]}"' },
        ],
      }),
      "bash script.sh": '#!/usr/bin/env bash\nvalues=(one two)\nprintf "%s\\n" "${values[@]}"\n',
      "extensionless\nscript": '#!/bin/sh -e\nprintf "%s\\n" "$HOME"\n',
    },
    (root) => {
      const result = lint(root, tools, { report: false });
      assert.equal(result.failed, false, result.output);
      assert.equal(result.inputs.scripts.length, 3);
      assert.deepEqual(
        result.inputs.blocks.map(({ shell }) => shell),
        ["sh", "bash"],
      );
    },
  );
});

test("invalid Actions expression fails even when embedded shell is valid", () => {
  fails(
    { ...clean(), ".github/workflows/check.yml": workflow('echo "${{ made_up_context.value }}"') },
    /undefined|not defined/,
  );
});

test("unsafe embedded quoting and embedded shell syntax both fail", () => {
  fails({ ...clean(), ".github/workflows/check.yml": workflow("printf '%s\\n' $HOME") }, /SC2086/);
  fails(
    { ...clean(), ".github/workflows/check.yml": workflow("if true; then\n  echo unfinished") },
    /SC1046|SC1073|SC1072/,
  );
});

test("unsafe standalone quoting and POSIX Bashisms fail including extensionless scripts", () => {
  fails({ ...clean(), "portable.sh": "#!/bin/sh\nprintf '%s\\n' $HOME\n" }, /SC2086/);
  fails(
    { ...clean(), "portable.sh": "#!/bin/sh\nvalues=(one two)\nprintf '%s\\n' \"${values[@]}\"\n" },
    /SC3030|SC3054/,
  );
  fails(
    { ...clean(), extensionless: "#!/bin/bash\nif true; then\necho unfinished\n" },
    /SC1046|SC1073|SC1072/,
  );
});

test("explicit embedded sh and workflow defaults cannot silently lint Bashisms as Bash", () => {
  fails(
    {
      ...clean(),
      ".github/workflows/check.yml": workflow('values=(one two); echo "${values[@]}"', {
        defaults: { run: { shell: "sh" } },
      }),
    },
    /SC3030|SC3054/,
  );
  const parsed = YAML.parse(workflow("unused"));
  parsed.defaults = { run: { shell: "sh" } };
  parsed.jobs.check.steps = [{ run: 'values=(one two); echo "${values[@]}"' }];
  fails({ ...clean(), ".github/workflows/check.yml": YAML.stringify(parsed) }, /SC3030|SC3054/);
});

test("unknown standalone or embedded dialects and empty inventories fail closed", () => {
  for (const launcher of [
    "/bin/env bash",
    "/usr/local/bin/env sh",
    "/usr/bin/env -i bash",
    "/usr/bin/env -u IGNORED MODE=fixture sh",
    "/usr/bin/env -S bash -e",
    "/usr/bin/env --split-string=bash -e",
    "/bin/sh",
  ])
    fixture({ ...clean(), helper: `#!${launcher}\nprintf '%s\\n' "$HOME"\n` }, (root) => {
      const result = lint(root, tools, { report: false });
      assert.ok(
        result.inputs.scripts.some(({ file }) => file === "helper"),
        launcher,
      );
      // Without -S, multiple shebang arguments are nonportable. Discovery must
      // still send them to ShellCheck, which retains its SC2096 rejection.
      if (launcher.includes(" -i ") || launcher.includes(" -u ")) {
        assert.equal(result.failed, true);
        assert.match(result.output, /SC2096/);
      } else assert.equal(result.failed, false, result.output);
    });
  for (const files of [
    { ...clean(), "ambiguous.sh": "echo ambiguous\n" },
    { ...clean(), extensionless: "#!/bin/zsh\necho hello\n" },
    { ...clean(), extensionless: "#!/bin/ash\necho hello\n" },
    { ...clean(), extensionless: "#!/bin/mksh\necho hello\n" },
    { ...clean(), extensionless: "#!/usr/bin/env --unknown bash\necho hello\n" },
    {
      ...clean(),
      ".github/workflows/check.yml": workflow("Write-Output hello", {
        defaults: { run: { shell: "pwsh" } },
      }),
    },
    { "portable.sh": clean()["portable.sh"] },
  ])
    fixture(files, (root) => assert.throws(() => inventory(root), /dialect|shebang|empty/));
  fixture(clean(), (root) => {
    fs.unlinkSync(path.join(root, "portable.sh"));
    assert.throws(() => inventory(root), /ENOENT/);
  });
});

test("checksum mismatch and poisoned cache fail before execution; all platform pins are immutable", () => {
  assert.throws(() => verifyArchive(Buffer.from("tampered"), "a".repeat(64)), /checksum mismatch/);
  assert.throws(() => verifyArchive(Buffer.from("tampered"), ""), /checksum mismatch/);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "nac-lint-cache-"));
  try {
    const [filename] = pins.actionlint.assets[`${process.platform}-${process.arch}`];
    fs.writeFileSync(path.join(cache, filename), "not a trusted executable archive");
    assert.throws(() => installTools(cache), /checksum mismatch/);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
  for (const pin of Object.values(pins)) {
    assert.match(pin.version, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(Object.keys(pin.assets).sort(), [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
    ]);
    for (const [filename, checksum] of Object.values(pin.assets)) {
      assert.ok(filename.includes(pin.version));
      assert.match(checksum, /^[a-f0-9]{64}$/);
    }
  }
});

test("tool failure cannot be reported as lint success", () => {
  fixture(clean(), (root) => {
    const result = lint(
      root,
      { actionlint: "/nonexistent/actionlint", shellcheck: "/nonexistent/shellcheck" },
      { report: false },
    );
    assert.equal(result.failed, true);
    assert.match(result.output, /ENOENT/);
  });
});

test("fast lane is exact-candidate, unprivileged and explicitly required on every PR", () => {
  const stable = YAML.parse(fs.readFileSync(".github/workflows/stable-release.yml", "utf8"));
  const job = stable.jobs["workflow-lint"];
  assert.equal(job.needs, "prepare");
  assert.equal(job.if, "${{ needs.prepare.outputs.run == 'true' }}");
  assert.equal(job["timeout-minutes"], 5);
  assert.equal(job["continue-on-error"], undefined);
  assert.equal(stable.permissions.contents, "read");
  assert.ok(stable.jobs["required-pr-checks"].needs.includes("workflow-lint"));
  assert.ok(requiredJobs.includes("workflow-lint"));
  assert.equal(job.steps[0].with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.match(job.steps.at(-1).run, /make lint-workflows test-workflow-lint/);
  assert.doesNotMatch(YAML.stringify(job), /secrets\.|continue-on-error/);
  for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const sha = "a".repeat(40);
  for (const result of ["failure", "cancelled", "skipped", "pending", "neutral", undefined]) {
    const needs = Object.fromEntries(requiredJobs.map((id) => [id, { result: "success" }]));
    needs.prepare.outputs = { sha, run: "true" };
    needs.managed = { result: "success" };
    needs["workflow-lint"].result = result;
    assert.throws(() => requireComplete(needs, "true", sha), /workflow-lint/);
  }
});
