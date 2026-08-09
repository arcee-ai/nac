import { describe, expect, it } from "vitest";

import { dispatchControlLabel } from "@/app/lib/threadActivity";

describe("thread dispatch controls", () => {
  it.each([
    ["completed", false, false, "Completed"],
    ["failed", false, false, "Failed"],
    ["cancelled", false, false, "Cancelled"],
    ["running", true, false, "Cancelling…"],
    ["running", false, false, "Cancel dispatch"],
  ] as const)("labels %s accurately", (status, cancelling, cancelledByRequest, label) => {
    expect(dispatchControlLabel(status, cancelling, cancelledByRequest)).toBe(label);
  });
});
