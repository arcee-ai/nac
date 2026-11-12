import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../../.github/scripts/package.json', import.meta.url));
const YAML = require('yaml');
const workflow = () => YAML.parse(readFileSync('.github/workflows/managed-image-build.yml', 'utf8'));

test('live scanner qualification overlaps construction and remains a mandatory result dependency', () => {
  const config = workflow();
  const qualification = config.jobs['scanner-qualification'];
  const build = config.jobs['build-candidate'];
  assert.deepEqual(qualification.needs, ['prepare', 'contract']);
  assert.deepEqual(build.needs, qualification.needs);
  assert.equal(qualification.if, undefined);
  assert.equal(qualification['continue-on-error'], undefined);
  assert.equal(qualification['runs-on'], 'ubuntu-latest');
  assert.ok(config.jobs.result.needs.includes('scanner-qualification'));
  assert.equal(config.jobs.result.if, '${{ always() }}');
  assert.equal(qualification.steps[0].with.ref, '${{ needs.prepare.outputs.sha }}');
  assert.equal(qualification.steps[0].with['persist-credentials'], false);
  const live = qualification.steps.find(s => s.name === 'Qualify real OS/Node advisory matching and runtime/DB negatives');
  assert.equal(live.run, 'python3 scripts/security/image_qualify.py --output image-security-fixtures \\\n  --tool-cache "$RUNNER_TEMP/image-security-tools" --db-cache "$RUNNER_TEMP/image-security-db"\n');
  assert.equal(live.if, undefined);
  assert.equal(live['continue-on-error'], undefined);
  const artifact = qualification.steps.find(s => s.with?.name === 'managed-image-security-fixtures-${{ needs.prepare.outputs.sha }}');
  assert.equal(artifact.if, 'always()');
  assert.equal(artifact.with.path, 'image-security-fixtures/\n!image-security-fixtures/**/root/**\n');
  assert.equal(artifact.with['retention-days'], 14);
  assert.equal(artifact.with['if-no-files-found'], 'error');
  assert.ok(!build.steps.some(s => s.run?.includes('image_qualify.py')));
  assert.ok(!qualification.steps.some(s => s.uses?.startsWith('actions/download-artifact@')));
});

test('candidate inventory and frozen-image scan use live independent tools/database', () => {
  const jobs = workflow().jobs;
  for (const [job, expectedImage] of [
    [jobs['build-candidate'], '${{ steps.image.outputs.id }}'],
    [jobs['strict-scan'], '${{ needs.build-candidate.outputs.image_id }}'],
  ]) for (const step of job.steps.filter(s => s.run?.includes('image_scan.py'))) {
    assert.ok(step.run.includes('--tool-cache "$RUNNER_TEMP/image-security-tools"'));
    assert.ok(step.run.includes('--db-cache "$RUNNER_TEMP/image-security-db"'));
    assert.equal(step.env.IMAGE_ID, expectedImage);
    assert.equal(step.env.SOURCE_SHA, '${{ needs.prepare.outputs.sha }}');
  }
  assert.equal(jobs['build-candidate'].steps.filter(s => s.run?.includes('image_scan.py')).length, 1);
  assert.equal(jobs['strict-scan'].steps.filter(s => s.run?.includes('image_scan.py')).length, 1);
  assert.ok(!jobs['build-candidate'].steps.some(s => s.uses?.startsWith('actions/download-artifact@')));
});
