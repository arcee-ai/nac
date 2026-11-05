import assert from 'node:assert/strict';

// Exact relay additions on parent914782659a6183b89070a3516e2e44776b1eeb06.
// Match every added AST field before removing it; never normalize arbitrary steps.
// Existing cold guard then proves all remaining acceptance/cache/quality inputs.
const additions={
  "producer": [
    {
      "name": "Select same-run native package relay",
      "id": "apt-preflight",
      "env": {
        "COLD_APT": "${{ needs.prepare.outputs.cold_caches }}"
      },
      "run": "python3 .github/scripts/browser-apt.py preflight --state \"$RUNNER_TEMP/browser-apt\" --source \"$NAC_SOURCE_REVISION\" --cold \"$COLD_APT\" --github-output \"$GITHUB_OUTPUT\""
    },
    {
      "uses": "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "if": "steps.apt-preflight.outputs.enabled == 'true'",
      "with": {
        "node-version": "24.22.1"
      }
    },
    {
      "name": "Match native pager and locked browser setup for package authority",
      "if": "steps.apt-preflight.outputs.enabled == 'true'",
      "run": "sudo apt-get update && sudo apt-get install --yes less\nnpm --prefix crates/nac-server/web ci\n"
    },
    {
      "name": "Resolve fresh signed native package closure",
      "id": "apt-plan",
      "if": "steps.apt-preflight.outputs.enabled == 'true'",
      "run": "python3 .github/scripts/browser-apt.py plan --state \"$RUNNER_TEMP/browser-apt\" --github-output \"$GITHUB_OUTPUT\""
    },
    {
      "name": "Export authenticated same-run archive bytes",
      "id": "apt-export",
      "if": "steps.apt-plan.outputs.mode == 'ready'",
      "run": "python3 .github/scripts/browser-apt.py export --state \"$RUNNER_TEMP/browser-apt\" --github-output \"$GITHUB_OUTPUT\""
    },
    {
      "name": "Retain one package snapshot for this candidate and attempt",
      "id": "apt-upload",
      "if": "steps.apt-plan.outputs.mode == 'ready'",
      "uses": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "with": {
        "name": "browser-apt-packages-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
        "path": "${{ runner.temp }}/browser-apt/artifact/",
        "compression-level": 0,
        "retention-days": 7,
        "if-no-files-found": "error"
      }
    },
    {
      "name": "Retain package producer identity and cost evidence",
      "if": "always()",
      "uses": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "with": {
        "name": "browser-apt-evidence-producer-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
        "path": "${{ runner.temp }}/browser-apt/\n!${{ runner.temp }}/browser-apt/**/*.deb\n",
        "compression-level": 0,
        "retention-days": 7,
        "if-no-files-found": "error"
      }
    }
  ],
  "before": [
    {
      "name": "Select native package relay or controlled cold path",
      "id": "apt-preflight",
      "env": {
        "COLD_APT": "${{ needs.prepare.outputs.cold_caches }}"
      },
      "run": "python3 .github/scripts/browser-apt.py preflight --state \"$RUNNER_TEMP/browser-apt\" --source \"$NAC_SOURCE_REVISION\" --cold \"$COLD_APT\" --github-output \"$GITHUB_OUTPUT\""
    },
    {
      "name": "Resolve independent fresh signed package authority",
      "id": "apt-plan",
      "if": "steps.apt-preflight.outputs.enabled == 'true'",
      "run": "python3 .github/scripts/browser-apt.py plan --state \"$RUNNER_TEMP/browser-apt\" --github-output \"$GITHUB_OUTPUT\""
    },
    {
      "name": "Validate package selection before any download",
      "env": {
        "APT_MODE": "${{ needs.browser-binary.outputs.apt_mode }}",
        "APT_ID": "${{ needs.browser-binary.outputs.apt_artifact_id }}",
        "BROWSER_APT_RECEIPT": "${{ needs.browser-binary.outputs.apt_receipt }}",
        "COLD_APT": "${{ needs.prepare.outputs.cold_caches }}"
      },
      "run": "case \"$APT_MODE\" in\n  ready)\n    test \"$COLD_APT\" = false\n    [[ \"$APT_ID\" =~ ^[1-9][0-9]*$ ]]\n    test -n \"$BROWSER_APT_RECEIPT\"\n    mkdir \"$RUNNER_TEMP/browser-apt-download\"\n    ;;\n  disabled-cold)\n    test \"$COLD_APT\" = true\n    test -z \"$APT_ID\" && test -z \"$BROWSER_APT_RECEIPT\"\n    ;;\n  unsupported-platform|nothing-missing)\n    test \"$COLD_APT\" = false\n    test -z \"$APT_ID\" && test -z \"$BROWSER_APT_RECEIPT\"\n    ;;\n  *) exit 1 ;;\nesac\n"
    },
    {
      "name": "Download only the advertised current-run package snapshot",
      "if": "needs.browser-binary.outputs.apt_mode == 'ready' && needs.prepare.outputs.cold_caches != 'true'",
      "uses": "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
      "with": {
        "artifact-ids": "${{ needs.browser-binary.outputs.apt_artifact_id }}",
        "path": "${{ runner.temp }}/browser-apt-download",
        "merge-multiple": true
      }
    },
    {
      "name": "Validate complete archive before compatibility fallback or offer",
      "id": "apt-consume",
      "env": {
        "APT_MODE": "${{ needs.browser-binary.outputs.apt_mode }}",
        "BROWSER_APT_RECEIPT": "${{ needs.browser-binary.outputs.apt_receipt }}",
        "COLD_APT": "${{ needs.prepare.outputs.cold_caches }}"
      },
      "run": "apt_download=()\nif [ \"$APT_MODE\" = ready ]; then apt_download=(--download \"$RUNNER_TEMP/browser-apt-download\"); fi\npython3 .github/scripts/browser-apt.py consume --state \"$RUNNER_TEMP/browser-apt\" --source \"$NAC_SOURCE_REVISION\"             --producer-mode \"$APT_MODE\" --cold \"$COLD_APT\" \"${apt_download[@]}\" --github-output \"$GITHUB_OUTPUT\"\n"
    },
    {
      "name": "Offer only verified current package bytes to normal APT",
      "if": "steps.apt-consume.outputs.mode == 'verified-offer'",
      "run": "sudo python3 .github/scripts/browser-apt.py offer --state \"$RUNNER_TEMP/browser-apt\""
    }
  ],
  "after": [
    {
      "name": "Clean only exact offered package cache inodes",
      "if": "always() && steps.apt-preflight.outcome == 'success'",
      "run": "sudo python3 .github/scripts/browser-apt.py cleanup --state \"$RUNNER_TEMP/browser-apt\""
    },
    {
      "name": "Record configured native packages and installed font bytes",
      "if": "success() && steps.apt-plan.outputs.mode != ''",
      "run": "python3 .github/scripts/browser-apt.py installed --state \"$RUNNER_TEMP/browser-apt\""
    }
  ],
  "evidence": {
    "name": "Retain native package mode and cost evidence",
    "if": "always()",
    "uses": "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    "with": {
      "name": "browser-apt-evidence-shard-${{ matrix.shard }}-${{ needs.prepare.outputs.sha }}-${{ github.run_id }}-${{ github.run_attempt }}",
      "path": "${{ runner.temp }}/browser-apt/\n!${{ runner.temp }}/browser-apt/**/*.deb\n",
      "compression-level": 0,
      "retention-days": 7,
      "if-no-files-found": "error"
    }
  }
};

const oldOutputs={receipt:'${{ steps.pack.outputs.receipt }}',artifact_id:'${{ steps.upload.outputs.artifact-id }}'};
export function reverseBrowserApt(workflow) {
  const input=workflow.on.workflow_dispatch.inputs.cold_caches;
  assert.equal(input.description,'Measure Rust/image cache misses and bypass OS archive relay; run all acceptance work');
  input.description='Measure required Rust and image cache misses while running all acceptance work';
  const producer=workflow.jobs['browser-binary'];
  assert.deepEqual(producer.outputs,{...oldOutputs,
    apt_mode:'${{ steps.apt-plan.outputs.mode || steps.apt-preflight.outputs.mode }}',
    apt_receipt:'${{ steps.apt-export.outputs.receipt }}',
    apt_artifact_id:'${{ steps.apt-upload.outputs.artifact-id }}'});
  producer.outputs={...oldOutputs};
  const start=producer.steps.findIndex(s=>s.id==='upload')+1;
  assert.ok(start>0);assert.deepEqual(producer.steps.slice(start),additions.producer);
  producer.steps.splice(start,additions.producer.length);
  for(const role of ['browser-shards','browser-proof']) {
    const job=workflow.jobs[role];
    let normal=job.steps.findIndex(s=>s.name==='Install Playwright Chromium');
    assert.ok(normal>=additions.before.length);
    assert.deepEqual(job.steps.slice(normal-additions.before.length,normal),additions.before);
    job.steps.splice(normal-additions.before.length,additions.before.length);
    normal=job.steps.findIndex(s=>s.name==='Install Playwright Chromium');
    assert.deepEqual(job.steps.slice(normal+1,normal+1+additions.after.length),additions.after);
    job.steps.splice(normal+1,additions.after.length);
    const evidence=structuredClone(additions.evidence);
    if(role==='browser-proof')evidence.with.name=evidence.with.name.replace('shard-${{ matrix.shard }}','proof');
    assert.deepEqual(job.steps.at(-1),evidence);job.steps.pop();
  }
}
