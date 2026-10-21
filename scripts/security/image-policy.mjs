// ALL-451 owns policy validation/matching; this adapter owns only image severity.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validatePolicy, evaluateFindings } from '../../.github/scripts/security-policy.mjs';

export function evaluateImage(findings, policy, options = {}) {
  validatePolicy(policy, options);
  const severities = new Set(['Negligible', 'Low', 'Medium', 'High', 'Critical', 'Unknown']);
  if (!Array.isArray(findings) || findings.some(f => f.context !== 'managed-image' || !severities.has(f.severity))) {
    throw new Error('invalid image finding/context/severity');
  }
  // An advisory with no usable severity cannot be asserted below High.
  const candidates = findings.filter(f => ['High', 'Critical', 'Unknown'].includes(f.severity));
  return {
    ...evaluateFindings(candidates, policy, options),
    reporting: findings.filter(f => !candidates.includes(f)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [policyFile, findingsFile, outputFile] = process.argv.slice(2);
  const result = evaluateImage(JSON.parse(fs.readFileSync(findingsFile, 'utf8')),
    JSON.parse(fs.readFileSync(policyFile, 'utf8')));
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
}
