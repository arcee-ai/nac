import assert from 'node:assert/strict';

const source='${{ needs.prepare.outputs.sha }}';
const binaryOutputs={receipt:'${{ steps.pack.outputs.receipt }}',artifact_id:'${{ steps.upload.outputs.artifact-id }}'};
const aptOutputs={
  apt_mode:'${{ steps.apt-plan.outputs.mode || steps.apt-preflight.outputs.mode }}',
  apt_receipt:'${{ steps.apt-export.outputs.receipt }}',
  apt_artifact_id:'${{ steps.apt-upload.outputs.artifact-id }}',
};
const oldNeeds={
  'browser-shards':['prepare','browser-binary'],
  'browser-proof':['prepare','browser-binary'],
  browser:['prepare','browser-binary','browser-shards','browser-proof'],
  'required-pr-checks':['prepare','lint','test-server','test-server-web','test-core','test-workspace','quality',
    'browser-binary','browser-shards','browser-proof','browser','test','build','managed-image','managed-fault',
    'managed-quality','managed','source-security','workflow-lint','macos-native'],
};

function named(job,name) {
  const matches=job.steps.filter(step=>step.name===name);
  assert.equal(matches.length,1,name);
  return matches[0];
}

function relocate(object,key,before,after) {
  assert.equal(object[key],after);
  object[key]=before;
}

// Run only AFTER exact current admission is reversed. Authenticate every split
// field, then recover the colocated graph at0cfae9c3c999721a9e1e78c0801ccbc974c5d0da.
// Historical APT/admission/cold projections retain their existing fingerprints.
export function reverseParallelApt(workflow,nativeSteps) {
  assert.equal(nativeSteps.length,7);
  assert.deepEqual(workflow.jobs['browser-apt'],{
    if:"${{ needs.prepare.outputs.run == 'true' }}",needs:'prepare','runs-on':'ubuntu-latest',
    outputs:aptOutputs,env:{NAC_SOURCE_REVISION:source},steps:[{
      uses:'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      with:{'persist-credentials':false,ref:source},
    },...nativeSteps],
  });
  const binary=workflow.jobs['browser-binary'];
  assert.deepEqual(binary.outputs,binaryOutputs);
  assert.equal(binary.steps.at(-1).id,'upload');
  binary.outputs={...binaryOutputs,...aptOutputs};
  binary.steps.push(...structuredClone(nativeSteps));
  delete workflow.jobs['browser-apt'];
  for(const[role,before]of Object.entries(oldNeeds)) {
    const after=[...before];after.splice(after.indexOf('browser-binary')+1,0,'browser-apt');
    assert.deepEqual(workflow.jobs[role].needs,after);
    workflow.jobs[role].needs=[...before];
  }
  for(const role of ['browser-shards','browser-proof']) {
    const job=workflow.jobs[role];
    const guard=named(job,'Validate package selection before any download');
    for(const[key,output]of Object.entries({APT_MODE:'apt_mode',APT_ID:'apt_artifact_id',BROWSER_APT_RECEIPT:'apt_receipt'}))
      relocate(guard.env,key,'${{ needs.browser-binary.outputs.'+output+' }}','${{ needs.browser-apt.outputs.'+output+' }}');
    const fetch=named(job,'Download only the advertised current-run package snapshot');
    relocate(fetch,'if',"needs.browser-binary.outputs.apt_mode == 'ready' && needs.prepare.outputs.cold_caches != 'true'",
      "needs.browser-apt.outputs.apt_mode == 'ready' && needs.prepare.outputs.cold_caches != 'true'");
    relocate(fetch.with,'artifact-ids','${{ needs.browser-binary.outputs.apt_artifact_id }}','${{ needs.browser-apt.outputs.apt_artifact_id }}');
    const consume=named(job,'Validate complete archive before compatibility fallback or offer');
    for(const[key,output]of Object.entries({APT_MODE:'apt_mode',BROWSER_APT_RECEIPT:'apt_receipt'}))
      relocate(consume.env,key,'${{ needs.browser-binary.outputs.'+output+' }}','${{ needs.browser-apt.outputs.'+output+' }}');
  }
  const join=workflow.jobs.browser.steps[0];
  assert.deepEqual(join,{
    name:'Require both producers, every browser shard and complete goal proof',
    env:{BINARY_RESULT:'${{ needs.browser-binary.result }}',APT_RESULT:'${{ needs.browser-apt.result }}',
      SHARD_RESULT:'${{ needs.browser-shards.result }}',PROOF_RESULT:'${{ needs.browser-proof.result }}'},
    run:'test "$BINARY_RESULT" = success\ntest "$APT_RESULT" = success\ntest "$SHARD_RESULT" = success\ntest "$PROOF_RESULT" = success\n',
  });
  join.name='Require the exact binary, every browser shard and complete goal proof';
  delete join.env.APT_RESULT;
  join.run='test "$BINARY_RESULT" = success\ntest "$SHARD_RESULT" = success\ntest "$PROOF_RESULT" = success\n';
}
