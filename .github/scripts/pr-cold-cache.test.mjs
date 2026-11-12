import { reverseImageApplicability, reverseStrictImageSummary } from './image-security-wiring.mjs';
import { reverseAssetTokens } from "./asset-token-wiring.mjs";
import {reverseNativeApp, reverseNativeQualification} from './native-qualification-wiring.mjs';
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { reverseBrowserApt } from "./browser-apt-wiring.mjs";
import { reverseManagedSupplierControl } from "./managed-supplier-wiring.mjs";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const predicate = "(github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request') && inputs.cold_caches == true";
const mainPredicate = "needs.prepare.outputs.cold_caches == 'true'";
const forward = "${{ " + mainPredicate + " }}";
const childFlag = "${{ " + predicate + " }}";
const prefix = "${{ " + predicate + " && format('nac-ci-cold-{0}-{1}', github.run_id, github.run_attempt) || 'nac-ci-v1' }}";
const mainPrefix = prefix.replace(predicate, mainPredicate);
const imageImport = "${{ !(" + predicate + ") && 'type=gha,scope=nac-managed-linux-amd64-v1' || '' }}";
const normalImport = "type=gha,scope=nac-managed-linux-amd64-v1";
const trust = "${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}";
const provenanceEnv = {
  CI_EVENT_NAME: "${{ github.event_name }}",
  CI_EVENT_ACTION: "${{ github.event.action }}",
  CI_EVENT_BASE_CHANGED: "${{ toJSON(github.event.changes.base != null) }}",
};
const readonlyBrowserCaches = new Set(["browser-binary", "browser-proof", "browser-shards"]);
// Canonical cold-normalized hashes originated at 85f12eadfbf43cb585fe5a0f0231d479069ec26d.
// S17 on parent 004492fc300b296e6245a0f0768a892f98c8a42d intentionally changes
// only stable-release's four shared-key inputs and three read-only save inputs.
// Its old digest is independently checked after reversing exactly those inputs.
// Startup custody and isolated native auth remain exact required test steps in both projections.
// The other four workflow hashes and every normalization remain unchanged.
const baseline = {
  "stable-release": "43b11c4b1cccae666a6f5fe71f1359c6aaca1662f38876c98cd284e918cd70e5",
  "macos-native": "0ee43280f28b4b888cb50f7b17467625dc83e856391e05dad88c7a45f71c08d7",
  "managed-image-build": "d16867e85d8959cc561a33e288f09466f3d3d63096807e172f9857ac5edfe30f",
  "managed-fault": "459336943e5f6c361d281e00a920fcca61ee3ad09fab5b61a7356b9ce2da7953",
  "managed-quality": "b77ca20017fcce1fef054e779b42b852dac053dcf53648cbeb41940d5cdc14e0",
};
const read = name => { const value = YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")); if (name === "macos-native") reverseNativeApp(value); if (name === "stable-release") reverseNativeQualification(value); return value; };
function graph() {
  const result = {};
  function visit(name) {
    if (result[name]) return;
    const value = result[name] = read(name);
    for (const job of Object.values(value.jobs)) {
      const local = job.uses?.match(/^\.\/\.github\/workflows\/([\w-]+)\.yml$/);
      if (local) visit(local[1]);
    }
  }
  visit("stable-release");
  return result;
}
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)])) : value;
const digest = value => createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
const rust = step => step.uses?.startsWith("Swatinem/rust-cache@");
const image = step => step.uses?.startsWith("docker/build-push-action@");
const cacheSteps = values => Object.entries(values).flatMap(([name, value]) => Object.entries(value.jobs)
  .flatMap(([job, config]) => (config.steps ?? []).filter(rust).map(step => ({ name, job, step }))));

function verify(values) {
  const normalized = structuredClone(values);
  reverseImageApplicability(normalized["managed-image-build"]);
  reverseStrictImageSummary(normalized["managed-image-build"]);
  reverseAssetTokens(normalized["stable-release"]);
  reverseAssetTokens(normalized["managed-image-build"]);
  reverseManagedSupplierControl(normalized["managed-image-build"], "build-candidate");
  // Undo only exact authenticated relay additions; original four child hashes
  // and all prior source/provenance/profile/quality fingerprints remain fixed.
  reverseBrowserApt(normalized["stable-release"]);
  // Reverse only S19's guarded selection and explicit selected-builder binding.
  // Every prior cold/cache/security field remains covered by the original hashes.
  const imageSteps = normalized['managed-image-build'].jobs['build-candidate'].steps;
  const driver = imageSteps.find(s => s.id === 'image-driver');
  assert.deepEqual(driver, {
    name: 'Select supported image build driver', id: 'image-driver',
    run: 'python3 .github/scripts/image-build-driver.py >> "$GITHUB_OUTPUT"',
  });
  const setup = imageSteps.find(s => s.uses?.startsWith('docker/setup-buildx-action@'));
  assert.deepEqual(setup, {
    uses: 'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f', id: 'buildx',
    with: { driver: '${{ steps.image-driver.outputs.driver }}' },
  });
  const imageBuild = imageSteps.find(image);
  assert.equal(imageBuild.with.builder, '${{ steps.buildx.outputs.name }}');
  normalized['managed-image-build'].jobs['build-candidate'].steps = imageSteps.filter(s => s !== driver);
  delete setup.id;
  delete setup.with;
  delete imageBuild.with.builder;
  const top = normalized["stable-release"];
  // Reverse only S02's ordinary execution/list granularity; proof remains serial.
  for (const step of [
    top.jobs["browser-shards"].steps.find(s => s.name === "Run production-embedded browser shard"),
    top.jobs["browser-proof"].steps.find(s => s.name === "Verify complete disjoint current browser selection"),
  ]) {
    assert.equal(step.run.split("--fully-parallel").length, 2);
    assert.ok(step.run.includes("--fully-parallel --grep-invert='exact-goal-wait.e2e.ts'"));
    step.run = step.run.replace("--fully-parallel ", "");
  }
  const identity = top.jobs.prepare.steps.find(step => step.id === "ci");
  // Reverse only the three observational bindings to recover S17's exact
  // 1bd0... workflow; commands, graph, caches and every other field stay bound.
  for (const [name, value] of Object.entries(provenanceEnv)) {
    assert.equal(identity.env[name], value);
    delete identity.env[name];
  }
  // S12 on ad3400565aad89834742893ad36183254b5098af changes only this
  // server runner input. Reversing it must recover the exact pre-S12 workflow,
  // retaining the independently checked provenance bindings and S17 policy.
  const server = top.jobs["test-server"].steps.find(step => step.name === "Run nac-server tests");
  assert.deepEqual(server, { name: "Run nac-server tests", run: "python3 .github/scripts/server-tests.py" });
  server.run = "cargo test -p nac-server --locked";
  const input = top.on.workflow_dispatch.inputs.cold_caches;
  assert.equal(input.type, "boolean");
  assert.equal(input.default, false);
  assert.equal(input.required, false);
  assert.deepEqual(Object.keys(top.on.workflow_dispatch.inputs), ["cold_caches"]);
  top.on.workflow_dispatch = null;
  assert.equal(top.jobs.prepare.outputs.cold_caches, "${{ steps.cache-mode.outputs.cold_caches }}");
  delete top.jobs.prepare.outputs.cold_caches;
  const selector = top.jobs.prepare.steps.find(step => step.id === "cache-mode");
  assert.deepEqual(selector.env, { DISPATCH_COLD_CACHES: "${{ toJSON(inputs.cold_caches) }}" });
  assert.equal(selector.run, 'python3 .github/scripts/cold-caches.py >> "$GITHUB_OUTPUT"');
  assert.equal(selector.if, undefined);
  assert.equal(selector["continue-on-error"], undefined);
  top.jobs.prepare.steps = top.jobs.prepare.steps.filter(step => step !== selector);
  const forwarding = [];
  for (const [job, config] of Object.entries(top.jobs)) {
    if (config.with?.cold_caches !== undefined) {
      assert.equal(config.with.cold_caches, forward);
      forwarding.push(job);
      delete config.with.cold_caches;
    }
  }
  assert.deepEqual(forwarding.sort(), ["macos-native", "managed-fault", "managed-image", "managed-quality"]);
  for (const name of Object.keys(baseline).filter(name => name !== "stable-release")) {
    const declaration = normalized[name].on.workflow_call.inputs.cold_caches;
    assert.equal(declaration.type, "boolean");
    assert.equal(declaration.default, false);
    assert.equal(declaration.required, false);
    delete normalized[name].on.workflow_call.inputs.cold_caches;
  }
  for (const { name, job, step } of cacheSteps(normalized)) {
    assert.equal(step.with["prefix-key"], name === "stable-release" ? mainPrefix : prefix);
    assert.equal(step.with["save-if"], name === "stable-release" && readonlyBrowserCaches.has(job) ? "false" : trust);
    step.with["prefix-key"] = "nac-ci-v1";
  }
  assert.deepEqual(cacheSteps(values).map(({ name, job }) => `${name}/${job}`).sort(), [
    "macos-native/native", "managed-fault/fault", "managed-quality/quality",
    ...["lint", "test-server", "test-server-web", "browser-binary", "browser-shards", "browser-proof", "test-core", "test-workspace", "build"].map(job => `stable-release/${job}`),
  ].sort());
  let images = 0;
  for (const value of Object.values(normalized)) for (const config of Object.values(value.jobs)) {
    for (const step of config.steps ?? []) {
      if (image(step)) {
        images++;
        assert.equal(step.with["cache-from"], imageImport);
        assert.equal(step.with["no-cache"], childFlag);
        step.with["cache-from"] = normalImport;
        delete step.with["no-cache"];
      } else if (/cache/i.test(step.uses ?? "")) assert.ok(rust(step), "undisclosed cache action");
    }
  }
  assert.equal(images, 1);
  const beforeShared = structuredClone(top);
  for (const role of ["test-server", ...readonlyBrowserCaches]) {
    const cache = beforeShared.jobs[role].steps.find(rust);
    assert.equal(cache.with["shared-key"], "server-browser-linux-gnu-debug0-v1");
    assert.equal(cache.with.key, undefined);
    delete cache.with["shared-key"];
    cache.with.key = "${{ github.job }}";
    cache.with["save-if"] = trust;
  }
  assert.equal(digest(beforeShared), "54bc29daf0326f9b20563afba238525847c5319cf4fb44494198de9c192a9802",
    "reversing only S17 must recover the exact pre-shared workflow");
  for (const [name, expected] of Object.entries(baseline)) assert.equal(digest(normalized[name]), expected, `${name}: acceptance behavior changed outside cache control`);
  // No flag is allowed to affect a command, if/needs, receipt, privilege or role.
  assert.ok(!JSON.stringify(normalized).includes("cold_caches"));
}

// Execute the actual parsed workflow expression, rather than a separately
// reconstructed branch model. This bounded subset uses JS's identical &&/||/!
// and equality behavior for our canonical event strings and boolean contexts;
// actionlint separately validates Actions grammar. This is not a general
// Actions evaluator (e.g. arbitrary case-insensitive/numeric comparisons).
function evaluate(expression, event, flag, run = "101", attempt = "1", ref = "refs/heads/dev", hit = "false", selected = "false", payload = {}) {
  const source = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/\.([a-zA-Z_][a-zA-Z0-9_]*-[a-zA-Z0-9_-]+)/g, (_, key) => `[${JSON.stringify(key)}]`);
  return runInNewContext(`(${source})`, {
    github: { event_name: event, event: payload, ref, run_id: run, run_attempt: attempt }, inputs: { cold_caches: flag },
    toJSON: JSON.stringify,
    steps: { "release-cache": { outputs: { "cache-hit": hit } } },
    needs: { prepare: { outputs: { cold_caches: selected } } },
    format: (template, ...args) => template.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])),
  }, { timeout: 100 });
}

test('strict summary reversal follows the report into the split scan job', () => {
  const reports = value => Object.entries(value.jobs).flatMap(([job, config]) =>
    (config.steps ?? []).filter(step => step.name === 'Report exact-image security findings')
      .map(step => ({ job, step })));
  const config = read('managed-image-build');
  assert.equal(reports(config).length, 1);
  const { job, step: summary } = reports(config)[0];
  if (job === 'build-smoke') {
    config.jobs['build-candidate'] = config.jobs['build-smoke'];
    delete config.jobs['build-smoke'];
    config.jobs['build-candidate'].steps = config.jobs['build-candidate'].steps.filter(step => step !== summary);
    config.jobs['strict-scan'] = { steps: [summary] };
  } else {
    assert.equal(job, 'strict-scan');
  }
  reverseStrictImageSummary(config);
  assert.match(summary.run, /Image findings are advisory; enforcement is deferred/);

  const duplicate = read('managed-image-build');
  assert.equal(reports(duplicate).length, 1);
  const original = reports(duplicate)[0];
  const otherJob = original.job === 'strict-scan' ? 'build-smoke' : 'strict-scan';
  const target = duplicate.jobs[otherJob] ??= { steps: [] };
  target.steps.push(structuredClone(original.step));
  assert.throws(() => reverseStrictImageSummary(duplicate));
});

test("all reachable required caches isolate cold dispatch while every other parsed field stays identical", () => verify(graph()));

test("prepare records original event fields and a canonical boolean without changing execution", () => {
  const identity = read("stable-release").jobs.prepare.steps.find(step => step.id === "ci");
  for (const [event, payload, changed] of [
    ["pull_request", { action: "opened" }, "false"],
    ["pull_request", { action: "synchronize" }, "false"],
    ["pull_request", { action: "edited", changes: { body: { from: "data" } } }, "false"],
    ["pull_request", { action: "edited", changes: { base: { ref: { from: "old" } } } }, "true"],
    ["push", {}, "false"], ["workflow_dispatch", {}, "false"],
  ]) {
    const args = [event, false, "101", "1", "refs/heads/dev", "false", "false", { changes: {}, ...payload }];
    assert.equal(evaluate(identity.env.CI_EVENT_NAME, ...args), event);
    assert.equal(evaluate(identity.env.CI_EVENT_ACTION, ...args) ?? "", payload.action ?? "");
    assert.equal(evaluate(identity.env.CI_EVENT_BASE_CHANGED, ...args), changed);
  }
  for (const name of Object.keys(provenanceEnv)) {
    const missing = graph(); delete missing["stable-release"].jobs.prepare.steps.find(s => s.id === "ci").env[name];
    assert.throws(() => verify(missing));
  }
  const extra = graph();
  extra["stable-release"].jobs.prepare.steps.find(s => s.id === "ci").env.UNREVIEWED = "value";
  assert.throws(() => verify(extra), "normalization must not discard other environment fields");
});

const marker = "<!-- nac-ci-cold-caches -->";
function selector(event, payload, dispatch = "false", raw = false) {
  const root = mkdtempSync(join(tmpdir(), "nac-cold-event-"));
  try {
    const path = join(root, "event.json");
    writeFileSync(path, raw ? payload : JSON.stringify(payload));
    const env = { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: path, DISPATCH_COLD_CACHES: dispatch };
    return spawnSync("python3", [".github/scripts/cold-caches.py"], { env, encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("real event CLI selects only an exact first PR line or a typed manual boolean", () => {
  for (const body of [null, "", "ordinary body", " " + marker, "\n" + marker,
    "> " + marker, "```\n" + marker + "\n```", "example\n" + marker,
    marker + " extra", marker + "\rmore", marker + "\t", "\ufeff" + marker]) {
    const result = selector("pull_request", { action: "opened", pull_request: { body } }, "true");
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "cold_caches=false\n", JSON.stringify(body));
  }
  const noShell = join(tmpdir(), "nac-cold-must-not-execute-" + process.pid);
  assert.equal(existsSync(noShell), false);
  for (const body of [marker, marker + "\nbody", marker + "\r\nbody", marker + `\n$(touch ${noShell})`]) {
    const result = selector("pull_request", { action: "opened", pull_request: { body } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "cold_caches=true\n");
  }
  assert.equal(existsSync(noShell), false, "body is data and never shell");
  for (const value of ["false", "true"]) {
    const result = selector("workflow_dispatch", { inputs: { cold_caches: value } }, value);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, `cold_caches=${value}\n`);
  }
  for (const ref of ["refs/heads/dev", "refs/heads/main", "refs/tags/v0.1.4"]) {
    const result = selector("push", { ref, pull_request: { body: marker }, inputs: { cold_caches: "true" } }, "true");
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "cold_caches=false\n");
  }
});

test("real selector rejects malformed events/typed inputs before producing an output", () => {
  const cases = [
    ["pull_request", [], "false"], ["pull_request", {}, "false"],
    ["pull_request", { pull_request: { body: true } }, "false"],
    ["pull_request", '{"pull_request":{"body":"one","body":"two"}}', "false", true],
    ["pull_request", "{", "false", true], ["push", "x".repeat(8 * 1024**2 + 1), "true", true],
    ...["null", '"false"', '"true"', "1", "0", "{}", "[]", "bad", ""].map(value => ["workflow_dispatch", {}, value]),
    ["pull_request_target", { pull_request: { body: marker } }, "true"],
  ];
  for (const [event, payload, dispatch, raw] of cases) {
    const result = selector(event, payload, dispatch, raw);
    assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
  }
  const root = mkdtempSync(join(tmpdir(), "nac-cold-link-"));
  try {
    writeFileSync(join(root, "real"), "{}"); symlinkSync(join(root, "real"), join(root, "link"));
    const result = spawnSync("python3", [".github/scripts/cold-caches.py"], { encoding: "utf8", env: {
      ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: join(root, "link"),
    } });
    assert.notEqual(result.status, 0); assert.equal(result.stdout, "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("parsed expressions consume real selector outputs; defaults, trust and cold retries stay isolated", () => {
  const values = graph();
  const build = values["managed-image-build"].jobs["build-candidate"].steps.find(image);
  const stage = values["stable-release"].jobs.build.steps.find(step => step.run?.includes("ci-incremental.py stage"));
  for (const event of ["workflow_dispatch", "pull_request", "push"]) for (const requested of [false, true]) {
    const result = selector(event, event === "pull_request" ? { pull_request: { body: requested ? marker : "body" } } : {}, String(requested));
    assert.equal(result.status, 0, result.stderr);
    const selected = result.stdout.trim().split("=")[1];
    const flag = evaluate(forward, event, false, "101", "1", "refs/heads/dev", "false", selected);
    const cold = event !== "push" && requested;
    assert.equal(flag, cold);
    for (const ref of ["refs/heads/dev", "refs/heads/main", "refs/heads/topic", "refs/tags/v0.1.4"]) {
      const trusted = event === "push" && ["refs/heads/dev", "refs/heads/main"].includes(ref);
      for (const { name, job, step } of cacheSteps(values)) {
        assert.equal(evaluate(step.with["prefix-key"], event, flag, "101", "1", ref, "false", selected), cold ? "nac-ci-cold-101-1" : "nac-ci-v1");
        const readonly = name === "stable-release" && readonlyBrowserCaches.has(job);
        assert.equal(evaluate(step.with["save-if"], event, flag, "101", "1", ref), trusted && !readonly);
      }
      assert.equal(evaluate(build.with["cache-from"], event, flag), cold ? "" : normalImport);
      assert.equal(evaluate(build.with["no-cache"], event, flag), cold);
      assert.equal(evaluate(build.with["cache-to"], event, flag, "101", "1", ref), trusted ? "type=gha,mode=max,scope=nac-managed-linux-amd64-v1" : "");
      if (event !== "push") assert.equal(evaluate(stage.if, event, flag), false);
    }
  }
  for (const event of ["pull_request", "workflow_dispatch"]) {
    assert.notEqual(evaluate(prefix, event, true, "101", "1"), evaluate(prefix, event, true, "102", "1"));
    assert.notEqual(evaluate(prefix, event, true, "101", "1"), evaluate(prefix, event, true, "101", "2"));
    for (const flag of [undefined, false, "false", "true"]) assert.equal(evaluate(prefix, event, flag), "nac-ci-v1");
  }
  assert.equal(evaluate(prefix, "push", true), "nac-ci-v1", "callee cannot accept push/tag opt-in");
  assert.equal(evaluate(prefix.replace(" == true", ""), "workflow_dispatch", "false"), "nac-ci-cold-101-1", "negative control: nonempty false string is truthy");
  const wrongImport = "${{ (" + predicate + ") && '' || '" + normalImport + "' }}";
  assert.equal(evaluate(wrongImport, "workflow_dispatch", true), normalImport, "negative control: empty true branch falls through");
});

test("mutations cannot miss a cache role or change setup, quality, identity, privileges or required work", () => {
  for (let i = 0; i < cacheSteps(graph()).length; i++) {
    const values = graph();
    cacheSteps(values)[i].step.with["prefix-key"] = "nac-ci-v1";
    assert.throws(() => verify(values), undefined, `uncontrolled cache role ${i}`);
  }
  const mutations = [
    v => { v["stable-release"].jobs.prepare.steps.find(s => s.id === "ci").env.CI_EVENT_ACTION = "${{ github.actor }}"; },
    v => { v["stable-release"].jobs.prepare.steps.find(s => s.id === "ci").env.CI_EVENT_BASE_CHANGED = "false"; },
    v => { v["stable-release"].jobs.prepare.steps.find(s => s.id === "ci").env.CI_EVENT_BASE_CHANGED = "${{ toJSON(github.event.action == 'edited') }}"; },
    v => { v["stable-release"].on.workflow_dispatch.inputs.cold_caches.type = "string"; },
    v => { v["stable-release"].on.workflow_dispatch.inputs.cold_caches.default = "false"; },
    v => { v["stable-release"].on.workflow_dispatch.inputs.cold_caches.default = true; },
    v => { v["stable-release"].jobs["managed-fault"].with.cold_caches = "${{ inputs.cold_caches }}"; },
    v => { delete v["stable-release"].jobs["macos-native"].with.cold_caches; },
    v => { cacheSteps(v)[0].step.with["prefix-key"] = prefix.replace(" == true", ""); },
    v => { v["stable-release"].jobs.prepare.steps.find(s => s.id === "cache-mode").env.DISPATCH_COLD_CACHES = "${{ github.event.inputs.cold_caches }}"; },
    v => { v["stable-release"].jobs.prepare.steps.find(s => s.id === "cache-mode").if = "github.event_name == 'workflow_dispatch'"; },
    v => { cacheSteps(v)[0].step.with["prefix-key"] = prefix.replace("github.run_attempt", "'1'"); },
    v => { cacheSteps(v)[0].step.with["save-if"] = "true"; },
    v => { v["stable-release"].jobs["browser-binary"].steps.find(rust).with["save-if"] = trust; },
    v => { v["stable-release"].jobs["test-server"].steps.find(rust).with["save-if"] = "false"; },
    v => { cacheSteps(v)[0].step.if = "!inputs.cold_caches"; },
    v => { v["managed-quality"].jobs.quality.steps.find(s => s.run === "make ci").if += " && !inputs.cold_caches"; },
    v => { v["managed-fault"].jobs.fault.steps.find(s => s.run === "make test-managed-fault-fixture").if = "!inputs.cold_caches"; },
    v => { v["stable-release"].jobs.build.steps.find(s => s.run?.includes("ci-incremental.py stage")).if = "github.event_name == 'workflow_dispatch'"; },
    v => { v["stable-release"].jobs.build.steps.find(s => s.run?.includes("ci-incremental.py restore")).if = "!inputs.cold_caches"; },
    v => { v["stable-release"].jobs.build.steps.find(s => s.name === "Verify full release-local Guide identity").run = "true"; },
    v => { v["stable-release"].jobs.build.steps.find(s => s.name === "Build nac-web binary").if = "!inputs.cold_caches"; },
    v => { v["stable-release"].jobs.build.steps.find(s => s.name === "Install Rust").if = "!inputs.cold_caches"; },
    v => { v["managed-image-build"].jobs["build-candidate"].steps.find(image).with["cache-from"] = normalImport; },
    v => { v["managed-image-build"].jobs["build-candidate"].steps.find(image).with["no-cache"] = false; },
    v => { v["managed-image-build"].jobs["build-candidate"].steps.find(image).with["cache-to"] = "type=gha,scope=bad"; },
    v => { v["stable-release"].permissions.contents = "write"; },
    v => { v["stable-release"].jobs["required-pr-checks"].needs = ["prepare"]; },
    v => { v["stable-release"].jobs["browser-shards"].steps.push({ uses: "actions/cache@bad" }); },
  ];
  for (const mutate of mutations) {
    const values = graph(); mutate(values); assert.throws(() => verify(values));
  }
});

const imageEvidenceMutations = [
  steps => { const item = steps.find(step => step.id === 'inventory'); item.run = item.run.replace(' --collect-applicability', ''); },
  steps => { const item = steps.find(step => step.id === 'inventory'); item.run = item.run.replace(' --collect-applicability', ' --collect-applicability --collect-applicability'); },
];

const strictImageMutations = [
  steps => { const item = steps.find(step => step.name === 'Report exact-image security findings'); item.run = item.run.replace('### Strict exact-image security result', '### Image findings are advisory; enforcement is deferred'); },
  steps => { const item = steps.find(step => step.name === 'Report exact-image security findings'); item.run = item.run.replace('Blocking findings and incomplete scans fail this job.', 'Findings are advisory.'); },
  steps => { const item = steps.find(step => step.name === 'Scan the same tested image with reviewed policy'); item.run = item.run.replace('|| scan_status=$?', '|| true'); },
  steps => { const item = steps.find(step => step.name === 'Scan the same tested image with reviewed policy'); item.run = item.run.replace('--scanner-exit "$scan_status"', '--scanner-exit 0'); },
  steps => { const item = steps.find(step => step.name === 'Scan the same tested image with reviewed policy'); item.run = item.run.replace('--scan-output image-security-evidence/security', '--scan-output stale-evidence'); },
];

test('image evidence and reporting deltas cannot weaken the original cold-cache contract', () => {
  for (const mutate of imageEvidenceMutations) {
    const value = graph(); mutate(value['managed-image-build'].jobs['build-candidate'].steps);
    assert.throws(() => verify(value));
  }
  for (const mutate of strictImageMutations) {
    const value = graph(); mutate(value['managed-image-build'].jobs['strict-scan'].steps);
    assert.throws(() => verify(value));
  }
  const moved = graph();
  moved['managed-image-build'].jobs['strict-scan'].steps.find(step => step.name === 'Scan the same tested image with reviewed policy').run += ' --collect-applicability';
  assert.throws(() => verify(moved));
});
