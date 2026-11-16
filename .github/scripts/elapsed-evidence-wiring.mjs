import assert from "node:assert/strict";

const upload = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const directory = "crates/nac-server/web/test-results";
const selected = `${directory}/fresh-interval-tasks.e2e.t-*-ndependently-continues-both*/`;
const evidence = {
  name: "Upload selected elapsed interval evidence",
  if: "${{ always() && hashFiles('crates/nac-server/web/test-results/**/elapsed-*.png', 'crates/nac-server/web/test-results/**/elapsed-qualification-*.json') != '' }}",
  uses: upload,
  with: {
    name: "nac-web-elapsed-interval-${{ matrix.shard }}-${{ github.run_attempt }}",
    path: [
      "elapsed-human-two-tasks.png",
      "elapsed-human-both-continued.png",
      "elapsed-model-native-two-tasks.png",
      "elapsed-model-native-both-continued.png",
      "elapsed-qualification-human.json",
      "elapsed-qualification-model-native.json",
    ].map((name) => selected + name).join("\n") + "\n",
    "if-no-files-found": "ignore",
    "retention-days": 3,
  },
};
const failure = {
  name: "Upload browser shard failure artifacts",
  if: "failure()",
  uses: upload,
  with: {
    name: "nac-web-playwright-${{ matrix.shard }}-${{ github.run_attempt }}",
    path: `${directory}\n!${selected}**\n`,
    "if-no-files-found": "ignore",
  },
};

// Authenticate the entire interval-evidence addition before projecting it out
// of guards pinned to the earlier CI graph. Historical digests stay unchanged.
export function reverseElapsedEvidence(workflow) {
  const steps = workflow.jobs["browser-shards"].steps;
  const find = (name) => {
    const indices = steps.flatMap((step, index) => step.name === name ? [index] : []);
    assert.equal(indices.length, 1, name);
    return indices[0];
  };
  const at = find(evidence.name);
  assert.equal(find(failure.name), at + 1);
  assert.equal(find("Run production-embedded browser shard"), at - 1);
  assert.deepEqual(steps[at], evidence);
  assert.deepEqual(steps[at + 1], failure);
  steps.splice(at, 1);
  steps[at].with.path = directory;
}
