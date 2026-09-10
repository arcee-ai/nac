import { describe, expect, it } from "vitest";

import {
  managedUpgradeActionLabel,
  managedUpgradeAuthorityChanged,
  managedUpgradeDistanceLabel,
  managedUpgradeIsActive,
  managedUpgradePhaseLabel,
  managedUpgradeRecovery,
  managedUpgradeRequiresFreshSnapshot,
  sameManagedRelease,
  type ManagedUpgradeReleaseIdentity,
} from "@/app/features/managed/upgrade";

const release: ManagedUpgradeReleaseIdentity = {
  release_id: "0-2-0-beta-1",
  source_revision: "a".repeat(40),
  build_id: "build-1",
  product_version: "0.2.0-beta.1",
  schema_version: 24,
};

describe("managed upgrade model", () => {
  it("keeps only terminal operation states inactive", () => {
    for (const state of [
      "pending",
      "preparing",
      "blocked",
      "safe-to-stop",
      "replacing",
      "starting/migrating",
      "verifying",
    ] as const) {
      expect(managedUpgradeIsActive(state)).toBe(true);
    }
    expect(managedUpgradeIsActive("succeeded")).toBe(false);
    expect(managedUpgradeIsActive("failed")).toBe(false);
  });

  it("presents closed phase, action, and accepted-distance vocabulary", () => {
    expect(managedUpgradePhaseLabel("starting/migrating")).toBe("Starting and migrating");
    expect(managedUpgradePhaseLabel("failed")).toBe("Upgrade failed");
    expect(managedUpgradeActionLabel("terminate_terminal")).toBe("Stop terminal");
    expect(managedUpgradeActionLabel("wait")).toBe("Wait");
    expect(managedUpgradeDistanceLabel(null)).toBe("Accepted-release distance unavailable");
    expect(managedUpgradeDistanceLabel(1)).toBe("1 accepted release ahead");
    expect(managedUpgradeDistanceLabel(3)).toBe("3 accepted releases ahead");
  });

  it("compares every exact release identity field", () => {
    expect(sameManagedRelease(release, { ...release })).toBe(true);
    expect(sameManagedRelease(release, { ...release, build_id: "build-2" })).toBe(false);
    expect(sameManagedRelease(release, { ...release, source_revision: "b".repeat(40) })).toBe(
      false,
    );
  });

  it("gives distinct recovery guidance for authorization, incarnation, and availability failures", () => {
    for (const status of [401, 403]) {
      expect(managedUpgradeRecovery({ status })).toEqual({
        message:
          "This managed session is no longer authorized. Reopen this host from the Arcee portal.",
        retryLabel: null,
      });
    }
    expect(managedUpgradeRecovery({ status: 409 })).toEqual({
      message:
        "This host session changed. Refresh status or reopen this host from the Arcee portal.",
      retryLabel: "Refresh status",
    });
    for (const error of [{ status: 503 }, new TypeError("network interrupted")]) {
      expect(managedUpgradeRecovery(error)).toEqual({
        message:
          "The upgrade service is temporarily unavailable. Try again to resume the same request safely.",
        retryLabel: "Try again",
      });
    }
  });

  it("requires a fresh snapshot after authority, incarnation, or contract failures", () => {
    for (const error of [{ status: 401 }, { status: 403 }, { status: 409 }]) {
      expect(managedUpgradeAuthorityChanged(error)).toBe(true);
      expect(managedUpgradeRequiresFreshSnapshot(error)).toBe(true);
    }
    const contractError = new Error("invalid controller response");
    contractError.name = "ManagedUpgradeContractError";
    expect(managedUpgradeRequiresFreshSnapshot(contractError)).toBe(true);
    expect(managedUpgradeRequiresFreshSnapshot({ status: 503 })).toBe(false);
    expect(managedUpgradeRequiresFreshSnapshot(new TypeError("network interrupted"))).toBe(false);
    expect(managedUpgradeAuthorityChanged(contractError)).toBe(false);
    expect(managedUpgradeAuthorityChanged({ status: 503 })).toBe(false);
  });
});
