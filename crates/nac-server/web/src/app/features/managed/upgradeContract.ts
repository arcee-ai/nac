import type {
  ManagedUpgradeBlocker,
  ManagedUpgradeBlockerAction,
  ManagedUpgradeBlockerKind,
  ManagedUpgradeBlockerTarget,
  ManagedUpgradeOperation,
  ManagedUpgradeOperationState,
  ManagedUpgradeReleaseIdentity,
  ManagedUpgradeSnapshot,
} from "@/app/features/managed/upgrade";

type UnknownRecord = Record<string, unknown>;

const operationStates = new Set<ManagedUpgradeOperationState>([
  "pending",
  "preparing",
  "blocked",
  "safe-to-stop",
  "replacing",
  "starting/migrating",
  "verifying",
  "succeeded",
  "failed",
]);
const blockerKinds = new Set<ManagedUpgradeBlockerKind>([
  "active_run",
  "compaction",
  "traditional_child",
  "managed_orchestrator",
  "terminal_process",
  "clone_operation",
  "workspace_mutation",
  "operation_lease",
  "resource_lease",
  "maintenance_operation",
  "host-release",
  "host-readiness",
  "maintenance",
]);
const blockerActions = new Set<ManagedUpgradeBlockerAction>([
  "wait",
  "cancel_active_run",
  "cancel_traditional_child",
  "cancel_managed_orchestrator",
  "terminate_terminal",
  "cancel_clone_operation",
]);
const blockerMessages: Record<ManagedUpgradeBlockerKind, readonly string[]> = {
  active_run: ["An active run must finish before maintenance can start"],
  compaction: ["An active compaction must finish before maintenance can start"],
  traditional_child: ["An active child session must finish before maintenance can start"],
  managed_orchestrator: ["An active orchestrator must finish before maintenance can start"],
  terminal_process: ["An active terminal process must finish before maintenance can start"],
  clone_operation: ["An active repository clone must finish before maintenance can start"],
  workspace_mutation: ["An active workspace mutation must finish before maintenance can start"],
  operation_lease: ["An active operation must finish before maintenance can start"],
  resource_lease: ["An active resource lease must clear before maintenance can start"],
  maintenance_operation: ["Another maintenance operation is active"],
  "host-release": [
    "Suspended release identity is not exactly verified",
    "Current release identity is not exactly verified",
  ],
  "host-readiness": ["Current NAC runtime is not ready"],
  maintenance: [
    "The failed candidate could not be superseded",
    "The failed candidate supersession acknowledgement is invalid",
    "NAC is not yet safe to stop",
    "NAC reported an unsupported maintenance blocker; wait for it to clear",
  ],
};

export class ManagedUpgradeContractError extends Error {
  constructor() {
    super("Managed upgrade status did not match the browser contract.");
    this.name = "ManagedUpgradeContractError";
  }
}

function invalid(): never {
  throw new ManagedUpgradeContractError();
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const record = value as UnknownRecord;
  if (Object.keys(record).some((key) => !allowed.includes(key))) invalid();
  if (required.some((key) => !Object.hasOwn(record, key))) invalid();
  return record;
}

function safeText(value: unknown, maximum: number, allowEmpty = true): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && value.length === 0) ||
    /\p{Cc}/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function closedValue<T extends string>(value: unknown, allowed: Set<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) invalid();
  return value as T;
}

function optionalText(record: UnknownRecord, key: string, maximum: number): string | undefined {
  return Object.hasOwn(record, key) ? safeText(record[key], maximum) : undefined;
}

function parseRelease(value: unknown): ManagedUpgradeReleaseIdentity {
  const record = exactRecord(
    value,
    ["release_id", "source_revision", "build_id", "product_version", "schema_version"],
    ["release_id", "source_revision", "build_id", "product_version", "schema_version"],
  );
  const sourceRevision = safeText(record.source_revision, 40, false);
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) invalid();
  return {
    release_id: safeText(record.release_id, 63, false),
    source_revision: sourceRevision,
    build_id: safeText(record.build_id, 128, false),
    product_version: safeText(record.product_version, 128, false),
    schema_version: nonnegativeInteger(record.schema_version),
  };
}

function optionalRelease(
  record: UnknownRecord,
  key: string,
): ManagedUpgradeReleaseIdentity | undefined {
  return Object.hasOwn(record, key) ? parseRelease(record[key]) : undefined;
}

function targetIdentifier(value: unknown): string {
  const text = safeText(value, 128, false);
  if (!/^[A-Za-z0-9_.:@-]+$/.test(text)) invalid();
  return text;
}

function parseTarget(value: unknown): ManagedUpgradeBlockerTarget {
  const keys = [
    "session_id",
    "run_id",
    "child_session_id",
    "orchestrator_session_id",
    "terminal_id",
    "clone_operation_id",
  ] as const;
  const record = exactRecord(value, keys, []);
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(record, key))
      .map((key) => [key, targetIdentifier(record[key])]),
  ) as ManagedUpgradeBlockerTarget;
}

function exactTarget(
  target: ManagedUpgradeBlockerTarget,
  required: readonly (keyof ManagedUpgradeBlockerTarget)[],
): boolean {
  const present = Object.keys(target).sort();
  return (
    present.length === required.length &&
    required.every((key) => present.includes(key) && Boolean(target[key]))
  );
}

function validActionTarget(
  kind: ManagedUpgradeBlockerKind,
  action: ManagedUpgradeBlockerAction,
  target: ManagedUpgradeBlockerTarget,
): boolean {
  switch (action) {
    case "cancel_active_run":
      return kind === "active_run" && exactTarget(target, ["session_id", "run_id"]);
    case "cancel_traditional_child":
      return (
        kind === "traditional_child" && exactTarget(target, ["session_id", "child_session_id"])
      );
    case "cancel_managed_orchestrator":
      return (
        kind === "managed_orchestrator" &&
        exactTarget(target, ["session_id", "orchestrator_session_id"])
      );
    case "terminate_terminal":
      return kind === "terminal_process" && exactTarget(target, ["session_id", "terminal_id"]);
    case "cancel_clone_operation":
      return kind === "clone_operation" && exactTarget(target, ["clone_operation_id"]);
    case "wait":
      return false;
  }
}

function parseBlocker(value: unknown): ManagedUpgradeBlocker {
  const record = exactRecord(
    value,
    ["selection_key", "kind", "message", "actionable", "action", "target"],
    ["selection_key", "kind", "message", "actionable", "action", "target"],
  );
  const selectionKey = safeText(record.selection_key, 71, false);
  if (!/^sha256:[a-f0-9]{64}$/.test(selectionKey)) invalid();
  const kind = closedValue(record.kind, blockerKinds);
  const message = safeText(record.message, 512, false);
  if (!blockerMessages[kind].includes(message)) invalid();
  if (typeof record.actionable !== "boolean") invalid();
  const action = closedValue(record.action, blockerActions);
  if (!record.actionable) {
    if (action !== "wait" || record.target !== null) invalid();
    return { selection_key: selectionKey, kind, message, actionable: false, action, target: null };
  }
  const target = parseTarget(record.target);
  if (!validActionTarget(kind, action, target)) invalid();
  return { selection_key: selectionKey, kind, message, actionable: true, action, target };
}

export function decodeManagedUpgradeOperation(value: unknown): ManagedUpgradeOperation {
  const record = exactRecord(
    value,
    [
      "operation_id",
      "managed_host_id",
      "kind",
      "state",
      "reason",
      "message",
      "target_release",
      "desired_release",
      "observed_release",
      "blockers",
      "created_at",
      "updated_at",
    ],
    ["operation_id", "managed_host_id", "kind", "state"],
  );
  if (record.kind !== "upgrade") invalid();
  let blockers: ManagedUpgradeBlocker[] | undefined;
  if (Object.hasOwn(record, "blockers")) {
    if (!Array.isArray(record.blockers) || record.blockers.length > 100) invalid();
    blockers = record.blockers.map(parseBlocker);
  }
  return {
    operation_id: safeText(record.operation_id, 128, false),
    managed_host_id: safeText(record.managed_host_id, 128, false),
    kind: "upgrade",
    state: closedValue(record.state, operationStates),
    reason: optionalText(record, "reason", 128),
    message: optionalText(record, "message", 512),
    target_release: optionalRelease(record, "target_release"),
    desired_release: optionalRelease(record, "desired_release"),
    observed_release: optionalRelease(record, "observed_release"),
    blockers,
    created_at: optionalText(record, "created_at", 64),
    updated_at: optionalText(record, "updated_at", 64),
  };
}

export function decodeManagedUpgradeSnapshot(value: unknown): ManagedUpgradeSnapshot {
  const record = exactRecord(value, ["preview", "operation"], ["preview", "operation"]);
  const preview = exactRecord(
    record.preview,
    ["current", "latest_beta", "upgrade_available", "distance"],
    ["current", "latest_beta", "upgrade_available", "distance"],
  );
  if (typeof preview.upgrade_available !== "boolean") invalid();
  let distance: { accepted_releases: number } | null = null;
  if (preview.distance !== null) {
    const distanceRecord = exactRecord(
      preview.distance,
      ["accepted_releases"],
      ["accepted_releases"],
    );
    distance = { accepted_releases: nonnegativeInteger(distanceRecord.accepted_releases) };
  }
  return {
    preview: {
      current: parseRelease(preview.current),
      latest_beta: parseRelease(preview.latest_beta),
      upgrade_available: preview.upgrade_available,
      distance,
    },
    operation: record.operation === null ? null : decodeManagedUpgradeOperation(record.operation),
  };
}
