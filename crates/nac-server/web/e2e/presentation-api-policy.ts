/** Policy expected from the exact API revision, independent of presentation source. */
export type CaptureApiPolicy = "retired" | "legacy-enabled" | "legacy-disabled";

export function isCaptureApiPolicy(value: unknown): value is CaptureApiPolicy {
  return value === "retired" || value === "legacy-enabled" || value === "legacy-disabled";
}

export function captureApiEnvironment(policy: CaptureApiPolicy): Record<string, string> {
  return policy === "retired" ? {} : { NAC_ORCHESTRATION: policy === "legacy-enabled" ? "1" : "0" };
}

export function matchesCaptureApiPolicy(
  policy: CaptureApiPolicy,
  status: number,
  body: unknown,
): boolean {
  if (policy === "retired") return status === 404;
  return (
    status === 200 &&
    typeof body === "object" &&
    body !== null &&
    "orchestration_enabled" in body &&
    body.orchestration_enabled === (policy === "legacy-enabled")
  );
}
