import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import YAML from "yaml";
import {managedApplicable} from "./pr-checks.mjs";
const unit=YAML.parse(fs.readFileSync(new URL("../workflows/ci-admission.yml",import.meta.url),"utf8"));
const policy=JSON.parse(fs.readFileSync(new URL("./ci-admission-applicability.json",import.meta.url)));
function verify(w) {
  assert.deepEqual(Object.keys(w.on),["workflow_call"]);
  assert.deepEqual(w.permissions,{contents:"read"});
  assert.deepEqual(Object.keys(w.jobs),["identity","marker"]);
  assert.equal(w.jobs.identity["timeout-minutes"],2);
  assert.equal(w.jobs.marker["timeout-minutes"],1);
  assert.equal(w.jobs.marker.needs,"identity");
  assert.equal(w.jobs.marker.name,"${{ needs.identity.outputs.marker_name || 'NAC admission unavailable' }}");
  assert.equal(w.jobs.identity.steps[0].with.ref,"${{ github.sha }}");
  assert.equal(w.jobs.identity.steps[0].with["persist-credentials"],false);
  const step=w.jobs.identity.steps[1];
  assert.equal(step.env.ORIGINAL_BASE_SHA,"${{ github.event.pull_request.base.sha }}");
  assert.match(step.run,/git --no-replace-objects show "\$ORIGINAL_BASE_SHA:.github\/scripts\/ci-admission-bootstrap.py"/);
  assert.match(step.run,/python3 "\$trusted"/);
  assert.match(step.run,/mode=full\\nmarker_name=NAC admission unavailable/);
  assert.doesNotMatch(JSON.stringify(w),/github.token|secrets|cache|retry|managed_applicable/);
}
test("always-callable nonprotected unit obtains bootstrap only from immutable original base",()=>verify(unit));
test("unit trust and marker dependency mutations fail",()=>{
 for(const mutate of [w=>w.permissions.actions="write",w=>w.jobs.marker.needs="candidate",w=>w.jobs.identity.steps[1].run="python3 .github/scripts/ci-admission.py",w=>w.jobs.identity.steps[0].with.ref="dev"]){
  const w=structuredClone(unit);mutate(w);assert.throws(()=>verify(w));
 }
});
test("BASE policy binds exact existing managed applicability function and complete path semantics",()=>{
 const bytes=fs.readFileSync(new URL("./pr-checks.mjs",import.meta.url));
 assert.equal(policy.pr_checks_sha256,createHash("sha256").update(bytes).digest("hex"));
 for(const paths of [[],["docs/a.md"],["Cargo.toml"],["scripts/x"],[".github/x"],["crates/x"],["docker/managed/x"],["docker/other/x"],["Makefile"],["Makefile.old"],["docs/a.md","crates/x"]]){
  const selected=paths.some(p=>policy.prefixes.some(prefix=>p.startsWith(prefix))||policy.exact_paths.includes(p));
  assert.equal(selected,managedApplicable(paths));
 }
});
