import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url);
const YAML=require('yaml');
const workflow=YAML.parse(fs.readFileSync(new URL('../workflows/apt-runtime-parity.yml',import.meta.url),'utf8'));
const step=(job,pattern)=>{
  const found=job.steps.filter(s=>pattern.test(s.run??''));assert.equal(found.length,1,String(pattern));return found[0];
};
function validate(value) {
  assert.deepEqual(value.on,{push:{branches:['codex/all-582-apt-runtime-parity']}});
  assert.deepEqual(value.permissions,{contents:'read'});
  assert.deepEqual(Object.keys(value.jobs),['producer','consumer']);
  const {producer,consumer}=value.jobs;
  assert.equal(consumer.needs,'producer');
  assert.deepEqual(consumer.strategy,{'fail-fast':false,matrix:{lane:['cold','hit']}});
  const actions=new Set([
    'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
    'dtolnay/rust-toolchain@5059963b1731bf1580991b5f3b1eecfb5da406c0',
    'Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
  ]);
  for(const job of [producer,consumer]) {
    assert.equal(job['runs-on'],'ubuntu-latest');assert.equal(job['timeout-minutes'],35);
    assert.equal(job.permissions,undefined);
    assert.equal(job.env.CARGO_INCREMENTAL,'0');
    assert.equal(job.env.CARGO_PROFILE_DEV_DEBUG,'0');assert.equal(job.env.CARGO_PROFILE_TEST_DEBUG,'0');
    assert.equal(job.env.NAC_SOURCE_REVISION,'${{ github.sha }}');
    assert.equal(job.env.NAC_BUILD_TRACK,'dev');assert.equal(job.env.NAC_BUILD_ID,'dev-${{ github.sha }}');
    assert.equal(job.env.NAC_E2E_CLEANUP_ID,undefined,'only fixture children may carry cleanup marker');
    assert.equal(job.env.NAC_E2E_ARTIFACTS,undefined,'controller derives private runner-temp path at execution');
    for(const item of job.steps) {
      if(item.uses)assert.ok(actions.has(item.uses),item.uses);
      assert.doesNotMatch(JSON.stringify(item),/secrets\.|continue-on-error|allow-unauthenticated|--force|Debug::NoLocking/);
      if(item.uses?.startsWith('Swatinem/')) {
        assert.deepEqual(item.with,{'prefix-key':'nac-ci-v1','shared-key':'server-browser-linux-gnu-debug0-v1','save-if':'false'});
        if(job===consumer)assert.equal(item.if,"steps.binary.outputs.mode == 'source'");
      }
      if(item.uses?.startsWith('actions/checkout'))assert.deepEqual(item.with,{ref:'${{ github.sha }}','persist-credentials':false});
      if(item.uses?.startsWith('actions/setup-node'))assert.equal(item.with['node-version'],'24.22.1');
      if(item.uses?.startsWith('actions/upload-artifact')) {
        for(const identity of ['github.sha','github.run_id','github.run_attempt'])assert.ok(item.with.name.includes(identity));
        assert.equal(item.with['compression-level'],0);assert.equal(item.with['if-no-files-found'],'error');
      }
    }
    assert.match(step(job,/npm --prefix/).run,/sudo apt-get install --yes less\n.*npm --prefix crates\/nac-server\/web ci/);
    assert.match(step(job,/apt-runtime-parity\.py prepare/).run,/--source "\$NAC_SOURCE_REVISION"/);
    assert.match(step(job,/cargo build/).run.trim(),/cargo build --locked -p nac-server --bin nac-web$/);
    assert.equal(step(job,/cargo build/).env.CARGO_BUILD_JOBS,'4');
    const text=job.steps.find(s=>s.with?.name?.startsWith('apt-native-text-'));
    assert.equal(text.if,'always()');assert.match(text.with.path,/!.*\/\*\*\/\*\.deb/);
  }
  assert.equal(producer.outputs.package_id,'${{ steps.packages.outputs.artifact-id }}');
  assert.equal(producer.outputs.package_receipt,'${{ steps.snapshot.outputs.receipt }}');
  assert.equal(producer.outputs.binary_id,'${{ steps.binary-upload.outputs.artifact-id }}');
  assert.equal(producer.outputs.binary_receipt,'${{ steps.binary.outputs.receipt }}');
  const packages=producer.steps.find(s=>s.id==='packages');
  assert.equal(packages.with.path,'${{ runner.temp }}/apt-parity/package-artifact/');
  assert.match(step(producer,/apt-runtime-parity\.py snapshot/).run,/--github-output "\$GITHUB_OUTPUT"/);
  assert.match(step(producer,/browser-binary\.py pack/).run,/--runner-image "\$\{ImageOS:\?\}@\$\{ImageVersion:\?\}"/);
  assert.equal(consumer.env.APT_ARTIFACT_RECEIPT,'${{ needs.producer.outputs.package_receipt }}');
  assert.equal(consumer.env.BROWSER_BINARY_RECEIPT,'${{ needs.producer.outputs.binary_receipt }}');
  const ids=step(consumer,/PACKAGE_ID.*=~ /);
  for(const id of ['PACKAGE_ID','BINARY_ID'])assert.ok(ids.run.includes(`[[ "$${id}" =~ ^[1-9][0-9]*$ ]]`));
  assert.match(ids.run,/test -n "\$APT_ARTIFACT_RECEIPT"/);assert.match(ids.run,/test -n "\$BROWSER_BINARY_RECEIPT"/);
  assert.match(ids.run,/mkdir "\$GITHUB_WORKSPACE\/browser-binary-download"/);
  assert.match(ids.run,/if \[ "\$LANE" = hit \]; then mkdir "\$RUNNER_TEMP\/apt-package-download"; fi/);
  const downloads=consumer.steps.filter(s=>s.uses?.startsWith('actions/download-artifact'));
  assert.equal(downloads.length,2);
  const packageRead=downloads.find(s=>s.with['artifact-ids'].includes('package_id'));
  assert.equal(packageRead.if,"matrix.lane == 'hit'");
  assert.equal(packageRead.with.path,'${{ runner.temp }}/apt-package-download');
  assert.equal(downloads.find(s=>s!==packageRead).with['artifact-ids'],'${{ needs.producer.outputs.binary_id }}');
  assert.match(step(consumer,/apt-runtime-parity\.py admit/).run,/else\n.*admit --state "\$RUNNER_TEMP\/apt-parity"\n/);
  const binary=step(consumer,/browser-binary\.py consume/);
  assert.match(binary.run,/--receipt-env BROWSER_BINARY_RECEIPT --source "\$NAC_SOURCE_REVISION"/);
  assert.match(binary.run,/--run-id "\$GITHUB_RUN_ID" --attempt "\$GITHUB_RUN_ATTEMPT"/);
  assert.equal(step(consumer,/cargo build/).if,"steps.binary.outputs.mode == 'source'");
  assert.equal(step(consumer,/sudo python3 .* offer-root/).if,"matrix.lane == 'hit'");
  assert.equal(step(consumer,/cleanup-root/).if,"always() && matrix.lane == 'hit'");
  assert.equal(step(consumer,/cleanup-journeys/).if,'always()');
  assert.match(step(consumer,/--label normal-playwright/).run,/node crates\/nac-server\/web\/node_modules\/playwright\/cli.js install --with-deps chromium$/);
  const journeys=step(consumer,/--label journeys/);
  assert.match(journeys.run,/hosted-surfaces\.e2e\.ts nac-guide-context\.e2e\.ts/);
  assert.match(journeys.run,/--grep '\(injected outgoing MCP CRUD, test and runtime status \(desktop\|mobile\)\|joined installed guide and scoped navigation on desktop\)\$'/);
  assert.match(journeys.run,/--workers=1 --retries=0 --reporter=json$/);
  assert.doesNotMatch(journeys.run.split(' -- node ')[1],/--timeout|--fully-parallel|--update-snapshots/);
  assert.match(step(consumer,/--label browser-check/).run,/apt-runtime-browser\.mjs/);
  assert.ok(consumer.steps.indexOf(step(consumer,/apt-runtime-parity\.py admit/))<consumer.steps.indexOf(step(consumer,/offer-root/)));
  assert.equal(step(consumer,/apt-runtime-parity\.py finish/).if,'${{ success() }}');
}

test('three native jobs preserve admission, real APT and exact representative source coverage',()=>validate(workflow));
const mutations={
  'ordinary trigger':v=>v.on.pull_request={},
  'broader branch':v=>v.on.push.branches.push('dev'),
  'write permission':v=>v.permissions.actions='write',
  'cache save':v=>v.jobs.producer.steps.find(s=>s.uses?.startsWith('Swatinem')).with['save-if']='true',
  'cache fallback unconditional':v=>delete v.jobs.consumer.steps.find(s=>s.uses?.startsWith('Swatinem')).if,
  'source drift':v=>v.jobs.producer.env.NAC_SOURCE_REVISION='dev',
  'controller cleanup marker':v=>v.jobs.consumer.env.NAC_E2E_CLEANUP_ID='same-marker',
  'cold package read':v=>delete v.jobs.consumer.steps.find(s=>s.with?.['artifact-ids']?.includes('package_id')).if,
  'unanchored package name read':v=>{const s=v.jobs.consumer.steps.find(s=>s.with?.['artifact-ids']?.includes('package_id'));s.with['artifact-ids']='';s.with.name='guess';},
  'missing receipt':v=>delete v.jobs.consumer.env.APT_ARTIFACT_RECEIPT,
  'missing attempt artifact binding':v=>v.jobs.producer.steps.find(s=>s.id==='packages').with.name='apt-${{ github.sha }}-${{ github.run_id }}',
  'broad payload upload':v=>v.jobs.producer.steps.find(s=>s.id==='packages').with.path='${{ runner.temp }}/apt-parity/',
  'no ID guard':v=>step(v.jobs.consumer,/PACKAGE_ID.*=~ /).run='mkdir "$GITHUB_WORKSPACE/browser-binary-download"',
  'missing S09 attempt':v=>step(v.jobs.consumer,/browser-binary\.py consume/).run=step(v.jobs.consumer,/browser-binary\.py consume/).run.replace('--attempt "$GITHUB_RUN_ATTEMPT"',''),
  'installation omitted':v=>step(v.jobs.consumer,/--label normal-playwright/).run='echo already cached',
  'with-deps removed':v=>step(v.jobs.consumer,/--label normal-playwright/).run=step(v.jobs.consumer,/--label normal-playwright/).run.replace('--with-deps ',''),
  'journey deadline change':v=>step(v.jobs.consumer,/--label journeys/).run+=' --timeout=180000',
  'journey retry':v=>step(v.jobs.consumer,/--label journeys/).run=step(v.jobs.consumer,/--label journeys/).run.replace('--retries=0','--retries=1'),
  'journey omission':v=>step(v.jobs.consumer,/--label journeys/).run=step(v.jobs.consumer,/--label journeys/).run.replace('desktop|mobile','desktop'),
  'cleanup success-only':v=>step(v.jobs.consumer,/cleanup-root/).if="matrix.lane == 'hit'",
  'failure evidence omitted':v=>delete v.jobs.consumer.steps.find(s=>s.with?.name?.startsWith('apt-native-text-')).if,
};
for(const [name,mutate]of Object.entries(mutations))test(`rejects ${name}`,()=>{
  const changed=structuredClone(workflow);mutate(changed);assert.throws(()=>validate(changed));
});

// Actual locked runner collection, not a model of grep/full-title semantics.
test('locked native list selects exactly the three unchanged cases without launching a fixture',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const selected=step(workflow.jobs.consumer,/--label journeys/).run.match(/--grep '([^']+)'/)[1];
  const raw=execFileSync(process.execPath,[
    'crates/nac-server/web/node_modules/playwright/cli.js','test','--config',
    'crates/nac-server/web/playwright.config.ts','hosted-surfaces.e2e.ts','nac-guide-context.e2e.ts',
    '--grep',selected,'--workers=1','--retries=0','--reporter=json','--list'],
    {cwd:root,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  if(process.env.APT_PARITY_LIST_EVIDENCE)fs.writeFileSync(process.env.APT_PARITY_LIST_EVIDENCE,raw);
  const report=JSON.parse(raw);
  const titles=[];
  function visit(suites){for(const suite of suites){for(const spec of suite.specs??[])titles.push(spec.title);visit(suite.suites??[]);}}
  visit(report.suites);
  assert.deepEqual(titles.sort(),[
    'injected outgoing MCP CRUD, test and runtime status desktop',
    'injected outgoing MCP CRUD, test and runtime status mobile',
    'joined installed guide and scoped navigation on desktop',
  ]);
  assert.deepEqual(report.errors,[]);assert.equal(report.config.workers,1);
  assert.ok(report.config.projects.every(p=>p.retries===0));
});
