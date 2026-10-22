// ALL-451 owns reviewed policy authority/matching; this adapter binds image context and severity.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePolicy, evaluateFindings } from '../../.github/scripts/security-policy.mjs';
import { loadTrustedPolicy, POLICY } from '../../.github/scripts/source-security.mjs';
import { selectPolicyInputs } from '../../.github/scripts/publication-policy.mjs';

export function selectImagePolicyInputs(candidateSha, {
  requestedMode = '', requestedSha = '', environment = process.env, readRef,
} = {}) {
  const selected = selectPolicyInputs(candidateSha, environment, readRef);
  if (requestedMode && requestedMode !== selected.mode) {
    throw new Error('image caller policy mode differs from eligible event');
  }
  if (requestedSha && requestedSha !== selected.policy_sha) {
    throw new Error('image caller cannot select a different trusted policy revision');
  }
  return selected;
}

export function loadImagePublicationPolicy({
  policyFile, candidatePolicyFile, candidateRoot, trustedRoot, candidateSha, receipt,
}, options = {}) {
  if (!receipt || !/^[a-f0-9]{40}$/.test(candidateSha || '') || receipt.candidate_sha !== candidateSha) {
    throw new Error('publication receipt differs from the scanned image source revision');
  }
  if (resolve(policyFile) !== resolve(trustedRoot, POLICY) ||
      resolve(candidatePolicyFile) !== resolve(candidateRoot, POLICY)) {
    throw new Error('image publication policy paths differ from the pinned checkouts');
  }
  // Reuse the source owner's complete event/run/repository/commit/byte boundary.
  // Only its validated publication mode may ignore historical candidate grants.
  return loadTrustedPolicy(candidateRoot, trustedRoot, { ...options, publicationPolicy: receipt });
}

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
  const args = process.argv.slice(2);
  if (args[0] === 'select' && args.length === 2) {
    const selected = selectImagePolicyInputs(args[1], {
      requestedMode: process.env.REQUESTED_POLICY_MODE,
      requestedSha: process.env.REQUESTED_POLICY_SHA,
    });
    for (const [key, value] of Object.entries(selected)) console.log(`${key}=${value}`);
  } else {
    if (args.length !== 3 && !(args.length === 9 && args[3] === '--publication-policy')) {
      throw new Error('invalid image policy evaluation arguments');
    }
    const [policyFile, findingsFile, outputFile] = args;
    let policy, receipt;
    if (args.length === 9) {
      const [, receiptFile, candidateRoot, trustedRoot, candidateSha, candidatePolicyFile] = args.slice(3);
      receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      policy = loadImagePublicationPolicy({ policyFile, candidatePolicyFile, candidateRoot,
        trustedRoot, candidateSha, receipt });
    } else policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
    const result = evaluateImage(JSON.parse(fs.readFileSync(findingsFile, 'utf8')), policy);
    if (receipt) result.policy_source = receipt;
    fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  }
}
