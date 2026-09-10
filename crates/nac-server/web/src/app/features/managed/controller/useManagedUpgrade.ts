import { useCallback, useEffect, useRef, useState } from "react";

import { useManagedUpgradeSnapshot, useStartManagedUpgrade } from "@/app/features/managed/queries";
import {
  managedUpgradeAuthorityChanged,
  managedUpgradeRecovery,
  sameManagedRelease,
  type ManagedUpgradeBlocker,
  type ManagedUpgradeOperation,
  type ManagedUpgradeReleaseIdentity,
} from "@/app/features/managed/upgrade";
import { api } from "@/app/services/api";

export type UpgradeBlockerSettlement = "requesting" | "settling" | "failed";

function idempotencyKey(): string {
  return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}

function required(value: string | undefined): string {
  if (!value) throw new Error("managed upgrade action target is unavailable");
  return value;
}

async function settleBlocker(blocker: ManagedUpgradeBlocker): Promise<void> {
  if (!blocker.actionable || blocker.action === "wait" || !blocker.target) {
    throw new Error("managed upgrade blocker is wait-only");
  }
  const target = blocker.target;
  switch (blocker.action) {
    case "cancel_active_run": {
      const sessionId = required(target.session_id);
      const runId = required(target.run_id);
      await api.cancelExactRun(sessionId, runId);
      return;
    }
    case "cancel_traditional_child":
      await api.cancelTraditionalChild(
        required(target.session_id),
        required(target.child_session_id),
      );
      return;
    case "cancel_managed_orchestrator":
      await api.cancelManagedOrchestrator(
        required(target.session_id),
        required(target.orchestrator_session_id),
      );
      return;
    case "terminate_terminal":
      await api.terminateTerminal(required(target.session_id), required(target.terminal_id));
      return;
    case "cancel_clone_operation":
      await api.cancelManagedClone(required(target.clone_operation_id));
      return;
  }
}

function rediscoveredAcceptedStart(
  prior: ManagedUpgradeOperation | null,
  current: ManagedUpgradeOperation | null | undefined,
  expectedTarget: ManagedUpgradeReleaseIdentity,
): boolean {
  if (!current) return false;
  const currentTarget = current.target_release ?? current.desired_release;
  if (!currentTarget || !sameManagedRelease(currentTarget, expectedTarget)) return false;
  return (
    !prior ||
    current.operation_id !== prior.operation_id ||
    current.state !== prior.state ||
    current.updated_at !== prior.updated_at
  );
}

/**
 * Browser controller for the externally-owned durable upgrade. It never
 * invents a host, incarnation, channel, or target: the only start payload is
 * the controller contract's exact empty object, and blocker controls invoke
 * the ordinary NAC operations named by the sanitized facade projection.
 */
export function useManagedUpgrade() {
  const snapshot = useManagedUpgradeSnapshot();
  const startMutation = useStartManagedUpgrade();
  const retryKey = useRef<string | null>(null);
  const operationId = snapshot.data?.operation?.operation_id ?? null;
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [startError, setStartError] = useState("");
  const [settlements, setSettlements] = useState<Record<string, UpgradeBlockerSettlement>>({});
  const priorOperationId = useRef<string | null>(operationId);

  useEffect(() => {
    if (priorOperationId.current !== operationId) {
      priorOperationId.current = operationId;
      setSettlements({});
      return;
    }
    const present = new Set(
      (snapshot.data?.operation?.blockers ?? []).map((blocker) => blocker.selection_key),
    );
    setSettlements((current) => {
      const retained = Object.fromEntries(
        Object.entries(current).filter(([selectionKey]) => present.has(selectionKey)),
      );
      return Object.keys(retained).length === Object.keys(current).length ? current : retained;
    });
  }, [operationId, snapshot.data?.operation?.blockers]);

  const requestStart = useCallback(() => {
    setStartError("");
    setConfirmationOpen(true);
  }, []);

  const cancelStart = useCallback(() => {
    if (startMutation.isPending) return;
    setConfirmationOpen(false);
    setStartError("");
  }, [startMutation.isPending]);

  const confirmStart = useCallback(async () => {
    if (startMutation.isPending) return;
    const key = retryKey.current ?? idempotencyKey();
    const priorOperation = snapshot.data?.operation ?? null;
    const expectedTarget = snapshot.data?.preview.latest_beta;
    retryKey.current = key;
    setStartError("");
    try {
      await startMutation.mutateAsync(key);
      retryKey.current = null;
      setConfirmationOpen(false);
    } catch (error) {
      setStartError(managedUpgradeRecovery(error).message);
      if (managedUpgradeAuthorityChanged(error)) {
        retryKey.current = null;
        setConfirmationOpen(false);
      }
      const refreshed = await snapshot.refetch();
      if (
        !managedUpgradeAuthorityChanged(error) &&
        !refreshed.error &&
        expectedTarget &&
        rediscoveredAcceptedStart(priorOperation, refreshed.data?.operation, expectedTarget)
      ) {
        retryKey.current = null;
        setStartError("");
        setConfirmationOpen(false);
      }
    }
  }, [snapshot, startMutation]);

  const requestSettlement = useCallback(
    async (blocker: ManagedUpgradeBlocker) => {
      setSettlements((current) => ({ ...current, [blocker.selection_key]: "requesting" }));
      try {
        await settleBlocker(blocker);
        setSettlements((current) => ({ ...current, [blocker.selection_key]: "settling" }));
        await snapshot.refetch();
      } catch {
        setSettlements((current) => ({ ...current, [blocker.selection_key]: "failed" }));
      }
    },
    [snapshot],
  );

  return {
    snapshot,
    confirmationOpen,
    startError,
    startPending: startMutation.isPending,
    settlements,
    requestStart,
    cancelStart,
    confirmStart,
    requestSettlement,
  };
}
