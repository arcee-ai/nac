import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Checkbox,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import {
  useManagedUpgrade,
  useSettleManagedUpgradeBlockers,
  useStartManagedUpgrade,
} from "@/app/features/managed/queries";
import { ApiError } from "@/app/services/api";
import type {
  ManagedReleaseIdentity,
  ManagedUpgradeBlocker,
  ManagedUpgradeOperation,
  ManagedUpgradeState,
} from "@/app/types/api";

const IDEMPOTENCY_STORAGE_KEY = "nac-managed-upgrade-idempotency-v1";

const progress: ReadonlyArray<{ states: ManagedUpgradeState[]; label: string }> = [
  { states: ["pending", "preparing", "blocked"], label: "Preparing" },
  { states: ["safe-to-stop"], label: "Maintenance confirmed" },
  { states: ["replacing"], label: "Replacing runtime" },
  { states: ["starting/migrating"], label: "Starting and migrating" },
  { states: ["verifying"], label: "Verifying" },
  { states: ["succeeded"], label: "Complete" },
];

function operationIndex(state: ManagedUpgradeState): number {
  if (state === "failed") return -1;
  return progress.findIndex((step) => step.states.includes(state));
}

interface PendingUpgradeRequest {
  key: string;
  baselineOperationId: string | null;
}

function readPendingRequest(): PendingUpgradeRequest | null {
  try {
    const encoded = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
    if (encoded == null) return null;
    const parsed = JSON.parse(encoded) as Partial<PendingUpgradeRequest>;
    if (
      typeof parsed.key === "string" &&
      parsed.key.length >= 16 &&
      parsed.key.length <= 128 &&
      parsed.key.trim() === parsed.key &&
      (parsed.baselineOperationId === null || typeof parsed.baselineOperationId === "string")
    ) {
      return parsed as PendingUpgradeRequest;
    }
  } catch {
    // Treat inaccessible or malformed storage as empty.
  }
  return null;
}

function pendingIdempotencyKey(baselineOperationId: string | null): string {
  try {
    const retained = readPendingRequest();
    if (retained != null && retained.baselineOperationId === baselineOperationId) {
      return retained.key;
    }
    const created = `browser-${window.crypto.randomUUID()}`;
    window.sessionStorage.setItem(
      IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify({ key: created, baselineOperationId } satisfies PendingUpgradeRequest),
    );
    return created;
  } catch {
    return `browser-${window.crypto.randomUUID()}`;
  }
}

function clearPendingIdempotencyKey(): void {
  try {
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy-restricted browsers. The durable
    // operation recovered by GET remains authoritative.
  }
}

function clearRecoveredIdempotencyKey(operationId: string | null): void {
  const pending = readPendingRequest();
  if (pending != null && operationId != null && operationId !== pending.baselineOperationId) {
    clearPendingIdempotencyKey();
  }
}

function unavailableMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return "Your managed session can no longer access upgrade controls. Relaunch this host from Arcee to continue.";
  }
  return "Upgrade status is temporarily unavailable. Your existing host and any durable upgrade operation are unchanged.";
}

function startFailureMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return "The upgrade request was denied. Relaunch this host from Arcee before trying again.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "Upgrade state changed before the request was accepted. Review the refreshed status before retrying.";
  }
  return "The request response was lost or the control service was unavailable. Checking durable upgrade status before you retry.";
}

export function ManagedUpgradePanel() {
  const query = useManagedUpgrade();
  const start = useStartManagedUpgrade();
  const settle = useSettleManagedUpgradeBlockers();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const operation = query.data?.operation ?? null;
  const blockers = useMemo(() => operation?.blockers ?? [], [operation?.blockers]);
  const actionable = useMemo(() => blockers.filter((blocker) => blocker.actionable), [blockers]);

  useEffect(() => {
    clearRecoveredIdempotencyKey(operation?.operation_id ?? null);
  }, [operation?.operation_id]);

  const begin = () =>
    start.mutate(pendingIdempotencyKey(operation?.operation_id ?? null), {
      onSuccess: clearPendingIdempotencyKey,
    });
  const stop = (targets: ManagedUpgradeBlocker[]) => {
    if (
      targets.some((blocker) => blocker.action === "terminate_terminal") &&
      !window.confirm(
        "Stop the selected terminal process? Its retained output stays available, but the process cannot be resumed.",
      )
    ) {
      return;
    }
    settle.mutate(targets, { onSuccess: () => setSelected(new Set()) });
  };

  if (query.isLoading) {
    return (
      <section aria-label="Managed runtime upgrade" className="flex items-center gap-2">
        <Loader size={LoaderSize.Small} />
        <span className="text-small text-basic-tertiary">Checking the latest beta…</span>
      </section>
    );
  }
  if (!query.data) {
    return (
      <section aria-label="Managed runtime upgrade" className="rounded-lg border border-basic p-4">
        <p className="label-medium text-basic-primary">Runtime upgrade</p>
        <p role="alert" className="mt-1 text-small text-error-primary">
          {unavailableMessage(query.error)}
        </p>
        <Button
          className="mt-3"
          size={ButtonSize.Small}
          variant={ButtonVariant.Secondary}
          content={ButtonContent.Text}
          onClick={() => void query.refetch()}
        >
          Check again
        </Button>
      </section>
    );
  }

  const { preview } = query.data;
  const terminal = operation?.state === "failed" || operation?.state === "succeeded";
  const canStart = preview.upgrade_available && (operation == null || terminal);
  const chosen = actionable.filter((blocker) => selected.has(blocker.selection_key));

  return (
    <section
      aria-labelledby="managed-upgrade-heading"
      className="flex flex-col gap-4 rounded-lg border border-basic p-4"
      data-testid="managed-upgrade"
    >
      <div>
        <p id="managed-upgrade-heading" className="label-medium text-basic-primary">
          Runtime upgrade
        </p>
        <p className="text-small text-basic-tertiary">
          Upgrade only to the latest accepted beta. Automatic upgrades, rollbacks, and version
          selection are not available.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReleaseCard label="Current build" release={preview.current} />
        <ReleaseCard label="Latest beta" release={preview.latest_beta} />
      </div>
      <p className="text-small text-basic-tertiary">
        {preview.distance == null
          ? "Release distance is not available for this build."
          : preview.distance.accepted_releases === 0
            ? "This host is on the latest accepted beta."
            : `${preview.distance.accepted_releases} accepted beta ${preview.distance.accepted_releases === 1 ? "release" : "releases"} ahead.`}
      </p>

      {operation ? <OperationProgress operation={operation} /> : null}
      {operation?.target_release != null &&
      operation.target_release.build_id !== preview.latest_beta.build_id ? (
        <ReleaseCard label="Upgrade attempt target" release={operation.target_release} />
      ) : null}

      {operation?.state === "blocked" ? (
        <BlockerList
          blockers={blockers}
          selected={selected}
          onSelectionChange={setSelected}
          busy={settle.isPending}
          onStopSelected={() => stop(chosen)}
          onStopAll={() => stop(actionable)}
        />
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-2">
        {start.isError && (operation == null || terminal) ? (
          <p className="text-small text-warning-primary">{startFailureMessage(start.error)}</p>
        ) : null}
        {settle.isError ? (
          <p role="alert" className="text-small text-error-primary">
            Some selected work could not be stopped. The blocker list will refresh; retry only the
            work that remains.
          </p>
        ) : null}
        {canStart ? (
          <Button
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={begin}
            loading={start.isPending}
          >
            {operation?.state === "failed" ? "Retry latest beta" : "Upgrade to latest beta"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ReleaseCard({ label, release }: { label: string; release: ManagedReleaseIdentity }) {
  return (
    <div className="min-w-0 rounded-lg bg-elevation-level-2 p-3">
      <p className="label-small text-basic-secondary">{label}</p>
      <p className="label-medium break-words text-basic-primary">{release.product_version}</p>
      <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-2 gap-y-1 text-small">
        <dt className="text-basic-muted">Build</dt>
        <dd className="code-small break-all text-basic-secondary">{release.build_id}</dd>
        <dt className="text-basic-muted">Release</dt>
        <dd className="code-small break-all text-basic-secondary">{release.release_id}</dd>
        <dt className="text-basic-muted">Source</dt>
        <dd className="code-small break-all text-basic-secondary">{release.source_revision}</dd>
        <dt className="text-basic-muted">Schema</dt>
        <dd className="text-basic-secondary">{release.schema_version}</dd>
      </dl>
    </div>
  );
}

function OperationProgress({ operation }: { operation: ManagedUpgradeOperation }) {
  const current = operationIndex(operation.state);
  if (operation.state === "failed") {
    return (
      <div role="status" className="rounded-lg border border-error-primary p-3">
        <p className="label-medium text-error-primary">Upgrade failed</p>
        <p className="text-small text-basic-secondary">
          {operation.message ?? "The latest attempt did not complete. It is safe to retry."}
        </p>
      </div>
    );
  }
  return (
    <div aria-live="polite">
      <p className="label-small text-basic-secondary">Upgrade progress</p>
      <ol className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {progress.map((step, index) => (
          <li
            key={step.label}
            aria-current={index === current ? "step" : undefined}
            className={`rounded px-2 py-1 text-small ${
              index === current
                ? "bg-elevation-level-2 text-basic-primary"
                : index < current
                  ? "text-success-primary"
                  : "text-basic-muted"
            }`}
          >
            {index < current ? "✓ " : ""}
            {step.label}
            {operation.state === "blocked" && index === current ? " — blocked" : ""}
          </li>
        ))}
      </ol>
      {operation.message ? (
        <p className="mt-2 text-small text-basic-secondary">{operation.message}</p>
      ) : null}
    </div>
  );
}

function BlockerList({
  blockers,
  selected,
  onSelectionChange,
  busy,
  onStopSelected,
  onStopAll,
}: {
  blockers: ManagedUpgradeBlocker[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  busy: boolean;
  onStopSelected: () => void;
  onStopAll: () => void;
}) {
  const actionable = blockers.filter((blocker) => blocker.actionable);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="label-medium text-basic-primary">Work must settle first</p>
        <p className="text-small text-basic-tertiary">
          Select work to stop, or wait for it to finish. NAC will not enter maintenance until every
          blocker has durably cleared.
        </p>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Upgrade blockers">
        {blockers.map((blocker) => (
          <li key={blocker.selection_key} className="rounded-lg border border-basic p-3">
            {blocker.actionable ? (
              <Checkbox
                checked={selected.has(blocker.selection_key)}
                disabled={busy}
                onChange={(checked) => {
                  const next = new Set(selected);
                  if (checked) next.add(blocker.selection_key);
                  else next.delete(blocker.selection_key);
                  onSelectionChange(next);
                }}
              >
                {blocker.message}
              </Checkbox>
            ) : (
              <div>
                <p className="label-small text-basic-primary">{blocker.message}</p>
                <p className="text-small text-basic-tertiary">Wait for this condition to clear.</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {actionable.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            disabled={!actionable.some((blocker) => selected.has(blocker.selection_key))}
            loading={busy}
            onClick={onStopSelected}
          >
            Stop selected
          </Button>
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={onStopAll}
          >
            Stop all actionable work
          </Button>
        </div>
      ) : null}
    </div>
  );
}
