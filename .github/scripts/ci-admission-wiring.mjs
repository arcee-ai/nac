import {reverseNativeQualification} from './native-qualification-wiring.mjs';
import assert from 'node:assert/strict';

// Exact coalescing-only projection. FULL execution must recover landed APT source.
export const sourceGroup="${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}";
export const routingGroup="${{ github.workflow }}-${{ github.event_name == 'pull_request' && (github.event.action == 'ready_for_review' || (github.event.action == 'edited' && github.event.changes.base == null)) && format('metadata-{0}-{1}', github.run_id, github.run_attempt) || (github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id)) }}";
export const purePredicate="needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure'";
export const fullPredicate="!(needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure')";
export const forwardedMode="${{ github.event_name == 'pull_request' && github.event.action == 'edited' && github.event.changes.base == null && needs.ci-admission.result == 'success' && needs.ci-admission.outputs.mode == 'pure' && 'pure' || 'full' }}";
export const sourceJobs={
  "workflow-lint": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "lint": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "test-server": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "test-server-web": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "browser-binary": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "browser-apt": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "browser-shards": {
    "needs": [
      "prepare",
      "browser-binary",
      "browser-apt"
    ],
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "browser-proof": {
    "needs": [
      "prepare",
      "browser-binary",
      "browser-apt"
    ],
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "browser": {
    "needs": [
      "prepare",
      "browser-binary",
      "browser-apt",
      "browser-shards",
      "browser-proof"
    ],
    "if": "${{ always() && needs.prepare.outputs.run == 'true' }}"
  },
  "test-core": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "test-workspace": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "quality": {
    "needs": [
      "prepare",
      "lint",
      "workflow-lint",
      "test-server",
      "test-server-web",
      "test-core",
      "test-workspace"
    ],
    "if": "${{ always() && needs.prepare.outputs.run == 'true' }}"
  },
  "test": {
    "needs": [
      "prepare",
      "quality",
      "browser"
    ],
    "if": "${{ always() && needs.prepare.outputs.run == 'true' }}"
  },
  "build": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "macos-native": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.run == 'true' }}"
  },
  "managed-image": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.managed_applicable == 'true' }}"
  },
  "managed-fault": {
    "needs": "prepare",
    "if": "${{ needs.prepare.outputs.managed_applicable == 'true' }}"
  },
  "managed-quality": {
    "needs": [
      "prepare",
      "quality",
      "managed-fault"
    ],
    "if": "${{ needs.prepare.outputs.managed_applicable == 'true' }}"
  },
  "managed": {
    "needs": [
      "prepare",
      "managed-image",
      "managed-fault",
      "managed-quality"
    ],
    "if": "${{ always() && needs.prepare.outputs.managed_applicable == 'true' }}"
  },
  "source-security": {
    "needs": "prepare",
    "if": null
  },
  "required-pr-checks": {
    "needs": [
      "prepare",
      "lint",
      "test-server",
      "test-server-web",
      "test-core",
      "test-workspace",
      "quality",
      "browser-binary",
      "browser-apt",
      "browser-shards",
      "browser-proof",
      "browser",
      "test",
      "build",
      "managed-image",
      "managed-fault",
      "managed-quality",
      "managed",
      "source-security",
      "workflow-lint",
      "macos-native"
    ],
    "if": "${{ always() }}"
  },
  "publish": {
    "needs": [
      "prepare",
      "test",
      "build",
      "required-pr-checks",
      "source-security"
    ],
    "if": "needs.prepare.outputs.run == 'true' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')"
  }
};
export const protectedNames={
  "required-pr-checks": "${{ needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure' && 'NAC metadata checks omitted' || 'Required PR checks' }}",
  "source-security": "${{ needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure' && 'NAC metadata source security omitted' || 'source-security' }}",
  "macos-native": "${{ needs.prepare.result == 'success' && needs.prepare.outputs.admission_mode == 'pure' && 'NAC metadata native omitted' || 'macos-native' }}"
};
export const unitCaller={name:'ci-admission',uses:'./.github/workflows/ci-admission.yml'};

export function fullGuard(config){
 const body=config.if?.replace(/^\$\{\{\s*|\s*\}\}$/g,'')??'true';
 if(body.includes('always()'))return '\u0024{{ ('+body+') && '+fullPredicate+' }}';
 const deps=(Array.isArray(config.needs)?config.needs:[config.needs]).map(n=>'needs.'+n+".result == 'success'").join(' && ');
 return '\u0024{{ !cancelled() && '+deps+' && ('+body+') && '+fullPredicate+' }}';
}

export function reverseAdmission(w){
 reverseNativeQualification(w);
 if(!w.jobs['ci-admission'])return;
 assert.equal(w.concurrency.group,routingGroup);w.concurrency.group=sourceGroup;
 assert.deepEqual(w.jobs['ci-admission'],unitCaller);delete w.jobs['ci-admission'];
 assert.deepEqual(Object.keys(w.jobs).sort(),['prepare',...Object.keys(sourceJobs)].sort());
 const prepare=w.jobs.prepare;assert.equal(prepare.needs,'ci-admission');delete prepare.needs;
 assert.equal(prepare.if,'\u0024{{ always() }}');delete prepare.if;
 assert.equal(prepare.outputs.admission_mode,forwardedMode);delete prepare.outputs.admission_mode;
 for(const [id,config]of Object.entries(sourceJobs)){
  const job=w.jobs[id];assert.deepEqual(job.needs,config.needs);
  if(id==='required-pr-checks'){
   assert.equal(job.if,config.if);
   for(const step of job.steps){assert.equal(step.if,'\u0024{{ '+fullPredicate+' }}');delete step.if;}
  }else{assert.equal(job.if,fullGuard(config));if(config.if===null)delete job.if;else job.if=config.if;}
  if(protectedNames[id]){assert.equal(job.name,protectedNames[id]);if(id==='required-pr-checks')job.name='Required PR checks';else delete job.name;}
 }
}
