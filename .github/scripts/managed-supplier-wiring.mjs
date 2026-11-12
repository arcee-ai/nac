// Test-only reversal of the exact i386 supplier control added to the managed
// image workflow. Older whole-workflow fingerprints still bind every field
// outside this reviewed step.
import assert from "node:assert/strict";

export function reverseManagedSupplierControl(workflow, job = "build-smoke") {
  const steps = workflow.jobs[job].steps;
  const matches = steps.filter(step => step.name === "Check libssh2 supplier overflow on i386 source");
  assert.equal(matches.length, 1, "exactly one i386 supplier control is required");
  const control = matches[0];
  assert.deepEqual(control, {
    name: "Check libssh2 supplier overflow on i386 source",
    run: "docker buildx build --builder '${{ steps.buildx.outputs.name }}' \\\n  --platform linux/386 \\\n  --target libssh2-i386-supplier-control \\\n  --file docker/managed/Dockerfile .\n",
  });
  const index = steps.indexOf(control);
  assert.equal(steps[index - 1]?.id, "build-image");
  assert.equal(steps[index + 1]?.id, "image");
  steps.splice(index, 1);
}
