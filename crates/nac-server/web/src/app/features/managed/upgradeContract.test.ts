import { describe, expect, it } from "vitest";

import {
  decodeManagedUpgradeOperation,
  decodeManagedUpgradeSnapshot,
  ManagedUpgradeContractError,
} from "@/app/features/managed/upgradeContract";

const release = {
  release_id: "0-2-0-beta-1",
  source_revision: "a".repeat(40),
  build_id: "build-1",
  product_version: "0.2.0-beta.1",
  schema_version: 25,
};

const operation = {
  operation_id: "018f47a5-34a7-7c91-bf7e-8f1042757001",
  managed_host_id: "018f47a5-34a7-7c91-bf7e-8f1042757301",
  kind: "upgrade",
  state: "blocked",
  reason: "UnsafeToStop",
  message: "Upgrade is waiting for active work",
  target_release: release,
  blockers: [
    {
      selection_key: `sha256:${"1".repeat(64)}`,
      kind: "active_run",
      message: "An active run must finish before maintenance can start",
      actionable: true,
      action: "cancel_active_run",
      target: { session_id: "session-1", run_id: "run-1" },
    },
    {
      selection_key: `sha256:${"2".repeat(64)}`,
      kind: "compaction",
      message: "An active compaction must finish before maintenance can start",
      actionable: false,
      action: "wait",
      target: null,
    },
  ],
  created_at: "2026-09-09T12:00:00Z",
  updated_at: "2026-09-09T12:01:00Z",
};

const snapshot = {
  preview: {
    current: { ...release, release_id: "0-1-4", product_version: "0.1.4" },
    latest_beta: release,
    upgrade_available: true,
    distance: { accepted_releases: 2 },
  },
  operation,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("managed upgrade facade decoder", () => {
  it("accepts only the closed snapshot and operation model", () => {
    expect(decodeManagedUpgradeSnapshot(snapshot)).toEqual(snapshot);
    expect(decodeManagedUpgradeOperation(operation)).toEqual(operation);
  });

  it.each([
    ["top-level unknown field", () => ({ ...clone(snapshot), image: "registry/private" })],
    [
      "release unknown field",
      () => ({
        ...clone(snapshot),
        preview: {
          ...clone(snapshot.preview),
          latest_beta: { ...release, digest: "sha256:private" },
        },
      }),
    ],
    [
      "unknown operation state",
      () => ({ ...clone(snapshot), operation: { ...clone(operation), state: "rolling-back" } }),
    ],
    [
      "unsanitized blocker message",
      () => ({
        ...clone(snapshot),
        operation: {
          ...clone(operation),
          blockers: operation.blockers.map((blocker, index) =>
            index === 0 ? { ...blocker, message: "pod managed-nac-0 is still running" } : blocker,
          ),
        },
      }),
    ],
    [
      "action-kind mismatch",
      () => ({
        ...clone(snapshot),
        operation: {
          ...clone(operation),
          blockers: operation.blockers.map((blocker, index) =>
            index === 0 ? { ...blocker, action: "terminate_terminal" } : blocker,
          ),
        },
      }),
    ],
    [
      "incomplete active-run target",
      () => ({
        ...clone(snapshot),
        operation: {
          ...clone(operation),
          blockers: operation.blockers.map((blocker, index) =>
            index === 0 ? { ...blocker, target: { session_id: "session-1" } } : blocker,
          ),
        },
      }),
    ],
    [
      "wait-only target",
      () => ({
        ...clone(snapshot),
        operation: {
          ...clone(operation),
          blockers: operation.blockers.map((blocker, index) =>
            index === 1 ? { ...blocker, target: { session_id: "session-1" } } : blocker,
          ),
        },
      }),
    ],
    [
      "oversized target",
      () => ({
        ...clone(snapshot),
        operation: {
          ...clone(operation),
          blockers: operation.blockers.map((blocker, index) =>
            index === 0
              ? { ...blocker, target: { session_id: "session-1", run_id: "x".repeat(129) } }
              : blocker,
          ),
        },
      }),
    ],
  ])("rejects %s without retaining foreign fields", (_label, malformed) => {
    expect(() => decodeManagedUpgradeSnapshot(malformed())).toThrow(ManagedUpgradeContractError);
  });

  it("rejects excessive blocker inventories and malformed release identity", () => {
    const excessive = {
      ...clone(snapshot),
      operation: {
        ...clone(operation),
        blockers: Array.from({ length: 101 }, () => clone(operation.blockers[1]!)),
      },
    };
    expect(() => decodeManagedUpgradeSnapshot(excessive)).toThrow(ManagedUpgradeContractError);

    const malformedRelease = {
      ...clone(snapshot),
      preview: {
        ...clone(snapshot.preview),
        latest_beta: { ...release, source_revision: "NOT-A-SHA" },
      },
    };
    expect(() => decodeManagedUpgradeSnapshot(malformedRelease)).toThrow(
      ManagedUpgradeContractError,
    );
  });

  it("keeps SSH and Podman terminal cleanup paths wait-only and out of action targets", () => {
    for (const [index, rawTerminalPath] of [
      "~/.cache/nac/exec/0123456789abcdef0123456789abcdef.pid",
      "/tmp/nac-exec-0123456789abcdef0123456789abcdef.pid",
    ].entries()) {
      // The exact controller contract hashes an unsafe raw ID into selection_key
      // and deliberately omits it from the browser-facing wait-only blocker.
      const projected = {
        selection_key: `sha256:${String(index + 3).repeat(64)}`,
        kind: "terminal_process",
        message: "An active terminal process must finish before maintenance can start",
        actionable: false,
        action: "wait",
        target: null,
      };
      expect(JSON.stringify(projected)).not.toContain(rawTerminalPath);
      expect(
        decodeManagedUpgradeOperation({ ...clone(operation), blockers: [projected] }).blockers,
      ).toEqual([projected]);

      const unsafeAction = {
        ...projected,
        actionable: true,
        action: "terminate_terminal",
        target: { session_id: "session-1", terminal_id: rawTerminalPath },
      };
      expect(() =>
        decodeManagedUpgradeOperation({ ...clone(operation), blockers: [unsafeAction] }),
      ).toThrow(ManagedUpgradeContractError);
    }
  });
});
