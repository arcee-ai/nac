// Shared source/image exception contract. Callers supply already-normalized findings.
const fields = ["advisory", "package", "context", "reason", "owner", "linked_issue", "expires"];

function object(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  ) {
    throw new Error(`${label}: expected exactly ${keys.join(", ")}`);
  }
}

function identity(value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    /[\x00-\x1f\x7f*?]/u.test(value)
  ) {
    throw new Error(`${label}: expected a nonempty exact identity (no wildcards)`);
  }
}

export function validatePolicy(document, { now = new Date() } = {}) {
  object(document, ["schema_version", "exceptions"], "security policy");
  if (
    document.schema_version !== 1 ||
    !Array.isArray(document.exceptions) ||
    !Number.isFinite(new Date(now).getTime())
  ) {
    throw new Error("security policy: invalid version, exceptions, or clock");
  }
  const seen = new Set();
  for (const entry of document.exceptions) {
    object(entry, fields, "exception");
    for (const field of fields) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) {
        throw new Error(`exception.${field}: expected a nonempty string`);
      }
    }
    for (const field of ["advisory", "package", "context"])
      identity(entry[field], `exception.${field}`);
    if (!/^[^:\s]+:.+$/u.test(entry.package))
      throw new Error("exception.package: use ecosystem:name");
    const issue = new URL(entry.linked_issue);
    if (
      issue.protocol !== "https:" ||
      issue.username ||
      issue.password ||
      !issue.pathname.slice(1)
    ) {
      throw new Error("exception.linked_issue: expected an HTTPS remediation issue URL");
    }
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(entry.expires) ||
      !Number.isFinite(Date.parse(entry.expires)) ||
      new Date(entry.expires).toISOString() !== entry.expires.replace("Z", ".000Z")
    ) {
      throw new Error("exception.expires: expected a valid UTC timestamp YYYY-MM-DDTHH:mm:ssZ");
    }
    if (Date.parse(entry.expires) <= new Date(now).getTime()) {
      throw new Error(`expired exception: ${entry.advisory} ${entry.package} ${entry.context}`);
    }
    const key = JSON.stringify([entry.advisory, entry.package, entry.context]);
    if (seen.has(key)) throw new Error(`duplicate exception: ${key}`);
    seen.add(key);
  }
  return document;
}

export function evaluateFindings(findings, policy, options = {}) {
  validatePolicy(policy, options);
  if (!Array.isArray(findings)) throw new Error("findings must be an array");
  const blocking = [];
  const excepted = [];
  for (const finding of findings) {
    for (const field of ["advisory", "package", "context"])
      identity(finding[field], `finding.${field}`);
    const exception = policy.exceptions.find(
      (entry) =>
        entry.advisory === finding.advisory &&
        entry.package === finding.package &&
        entry.context === finding.context,
    );
    if (exception) excepted.push({ ...finding, exception });
    else blocking.push(finding);
  }
  return { blocking, excepted };
}
