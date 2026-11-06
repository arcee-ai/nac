import { pathToFileURL } from "node:url";

const receiptFields = ["schema_version", "sha", "repository", "run_id", "run_attempt", "fixture_result"];

function identity(sha, context) {
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha) ||
      typeof context?.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(context.repository) ||
      typeof context?.run_id !== "string" || !/^[1-9][0-9]*$/.test(context.run_id) ||
      typeof context?.run_attempt !== "string" || !/^[1-9][0-9]*$/.test(context.run_attempt)) {
    throw new Error("invalid managed fault identity");
  }
  return { sha, repository: context.repository, run_id: context.run_id, run_attempt: context.run_attempt };
}

export function faultReceipt(checkoutSha, fixtureResult, sha, context) {
  const bound = identity(sha, context);
  if (checkoutSha !== sha) throw new Error("managed fault checkout differs from the prepared candidate");
  if (fixtureResult !== "success") throw new Error("complete managed fault fixture did not succeed");
  return { schema_version: 1, ...bound, fixture_result: "success" };
}

export function verifyFaultReceipt(receipt, sha, context) {
  const bound = identity(sha, context);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
      Object.keys(receipt).sort().join() !== [...receiptFields].sort().join() ||
      receipt.schema_version !== 1 || receipt.fixture_result !== "success") {
    throw new Error("invalid complete managed fault receipt");
  }
  for (const [field, value] of Object.entries(bound)) {
    if (receipt[field] !== value) throw new Error(`managed fault receipt ${field} differs from this attempt`);
  }
}

// A failed-job rerun may retain upstream outputs from an earlier attempt. Check
// the entire old receipt first, then repeat the fixture instead of reusing it.
// Only an absent receipt represents the explicit standalone/full fallback.
export function faultMode(receipt, sha, context) {
  identity(sha, context);
  if (receipt === undefined) return "full";
  verifyFaultReceipt(receipt, sha, { ...context, run_attempt: receipt?.run_attempt });
  if (BigInt(receipt.run_attempt) > BigInt(context.run_attempt)) {
    throw new Error("managed fault receipt is from a future attempt");
  }
  return receipt.run_attempt === context.run_attempt ? "reuse" : "full";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = { repository: process.env.GITHUB_REPOSITORY, run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT };
  const sha = process.env.EXPECTED_SHA;
  switch (process.argv[2]) {
    case "receipt":
      console.log(`fault_receipt=${JSON.stringify(faultReceipt(process.env.CHECKOUT_SHA, process.env.FIXTURE_RESULT, sha, context))}`);
      break;
    case "mode": {
      const raw = process.env.FAULT_RECEIPT ?? "";
      console.log(`mode=${faultMode(raw === "" ? undefined : JSON.parse(raw), sha, context)}`);
      break;
    }
    case "verify":
      verifyFaultReceipt(JSON.parse(process.env.FAULT_RECEIPT), sha, context);
      console.log("Verified complete managed fault fixture for this exact candidate/run/attempt");
      break;
    default:
      throw new Error("usage: managed-fault.mjs receipt | mode | verify");
  }
}
