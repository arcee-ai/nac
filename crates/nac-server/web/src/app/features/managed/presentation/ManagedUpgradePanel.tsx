import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { useManagedUpgrade } from "@/app/features/managed/controller/useManagedUpgrade";
import {
  managedUpgradeActionLabel,
  managedUpgradeDistanceLabel,
  managedUpgradeIsActive,
  managedUpgradePhaseLabel,
  managedUpgradeRecovery,
  sameManagedRelease,
  type ManagedUpgradeBlocker,
  type ManagedUpgradeOperation,
  type ManagedUpgradeReleaseIdentity,
} from "@/app/features/managed/upgrade";

export function ManagedUpgradePanel() {
  const upgrade = useManagedUpgrade();
  const snapshot = upgrade.snapshot;

  if (snapshot.isLoading) {
    return (
      <section
        aria-labelledby="managed-upgrade-heading"
        className="rounded-lg border border-basic p-4"
      >
        <h2 id="managed-upgrade-heading" className="label-medium text-basic-primary">
          Managed NAC upgrade
        </h2>
        <div className="mt-3">
          <Loader size={LoaderSize.Small} />
        </div>
      </section>
    );
  }

  if (!snapshot.data) {
    const recovery = managedUpgradeRecovery(snapshot.error);
    return (
      <section
        aria-labelledby="managed-upgrade-heading"
        className="rounded-lg border border-basic p-4"
        data-testid="managed-upgrade-unavailable"
      >
        <h2 id="managed-upgrade-heading" className="label-medium text-basic-primary">
          Managed NAC upgrade
        </h2>
        <p className="mt-1 text-small text-error-primary">{recovery.message}</p>
        {recovery.retryLabel ? (
          <Button
            className="mt-3"
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={() => void snapshot.refetch()}
            loading={snapshot.isFetching}
          >
            {recovery.retryLabel}
          </Button>
        ) : null}
      </section>
    );
  }

  const { preview, operation } = snapshot.data;
  const active = operation ? managedUpgradeIsActive(operation.state) : false;
  const canStart = preview.upgrade_available && !active;
  const acceptedTarget = operation?.target_release;
  const showAcceptedTarget =
    acceptedTarget && !sameManagedRelease(acceptedTarget, preview.latest_beta);

  return (
    <section
      aria-labelledby="managed-upgrade-heading"
      className="rounded-lg border border-basic p-4"
      data-testid="managed-upgrade"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="managed-upgrade-heading" className="label-medium text-basic-primary">
            Managed NAC upgrade
          </h2>
          <p className="mt-1 text-small text-basic-tertiary">
            {managedUpgradeDistanceLabel(preview.distance?.accepted_releases ?? null)}
          </p>
        </div>
        {canStart ? (
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={upgrade.requestStart}
          >
            {operation?.state === "failed"
              ? "Retry upgrade to latest beta"
              : "Upgrade to latest beta"}
          </Button>
        ) : !preview.upgrade_available && !active ? (
          <span className="rounded-full bg-success-secondary px-3 py-1 text-small text-success-primary">
            Up to date
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ReleaseIdentity label="Current" release={preview.current} />
        <ReleaseIdentity label="Latest beta" release={preview.latest_beta} />
        {showAcceptedTarget ? (
          <ReleaseIdentity
            label="Accepted target"
            release={acceptedTarget}
            className="lg:col-span-2"
          />
        ) : null}
      </div>

      {operation ? (
        <OperationStatus
          operation={operation}
          settlements={upgrade.settlements}
          onSettle={(blocker) => void upgrade.requestSettlement(blocker)}
        />
      ) : null}

      <Modal
        open={upgrade.confirmationOpen}
        onClose={upgrade.cancelStart}
        title="Upgrade Managed NAC?"
        size={ModalSize.Small}
        footer={
          <>
            <Button
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.Text}
              onClick={upgrade.cancelStart}
              disabled={upgrade.startPending}
            >
              Cancel
            </Button>
            <Button
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={() => void upgrade.confirmStart()}
              loading={upgrade.startPending}
            >
              Start upgrade
            </Button>
          </>
        }
      >
        <p className="text-small text-basic-secondary">
          Upgrade from <strong>{preview.current.product_version}</strong> to the exact accepted
          latest beta, <strong>{preview.latest_beta.product_version}</strong>. Active work must
          finish or be explicitly stopped before this host is replaced. The page may disconnect
          briefly while NAC starts and verifies the replacement.
        </p>
        {upgrade.startError ? (
          <p role="alert" className="mt-3 text-small text-error-primary">
            {upgrade.startError}
          </p>
        ) : null}
      </Modal>
    </section>
  );
}

function ReleaseIdentity({
  label,
  release,
  className = "",
}: {
  label: string;
  release: ManagedUpgradeReleaseIdentity;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg bg-elevation-level-2 p-3 ${className}`}>
      <p className="label-small text-basic-secondary">{label}</p>
      <p className="mt-1 label-medium text-basic-primary">{release.product_version}</p>
      <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
        <dt className="text-basic-tertiary">Release</dt>
        <dd className="code-small break-all text-basic-primary">{release.release_id}</dd>
        <dt className="text-basic-tertiary">Source</dt>
        <dd className="code-small break-all text-basic-primary">{release.source_revision}</dd>
        <dt className="text-basic-tertiary">Build</dt>
        <dd className="code-small break-all text-basic-primary">{release.build_id}</dd>
        <dt className="text-basic-tertiary">Schema</dt>
        <dd className="code-small text-basic-primary">{release.schema_version}</dd>
      </dl>
    </div>
  );
}

function OperationStatus({
  operation,
  settlements,
  onSettle,
}: {
  operation: ManagedUpgradeOperation;
  settlements: ReturnType<typeof useManagedUpgrade>["settlements"];
  onSettle: (blocker: ManagedUpgradeBlocker) => void;
}) {
  const blockers = operation.blockers ?? [];
  const failed = operation.state === "failed";
  const succeeded = operation.state === "succeeded";
  return (
    <div
      className={`mt-4 rounded-lg border p-4 ${
        failed ? "border-error-primary" : succeeded ? "border-success-primary" : "border-basic"
      }`}
      aria-live="polite"
      data-testid="managed-upgrade-operation"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="label-medium text-basic-primary">
            {managedUpgradePhaseLabel(operation.state)}
          </p>
          {operation.message ? (
            <p className="mt-1 text-small text-basic-tertiary">{operation.message}</p>
          ) : null}
        </div>
        <span className="code-small break-all text-basic-muted">{operation.operation_id}</span>
      </div>

      {blockers.length > 0 ? (
        <div className="mt-4">
          <p className="label-small text-basic-secondary">Before replacement can begin</p>
          <ul className="mt-2 flex flex-col gap-2">
            {blockers.map((blocker) => {
              const settlement = settlements[blocker.selection_key];
              return (
                <li key={blocker.selection_key} className="rounded-lg bg-elevation-level-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-small text-basic-primary">{blocker.message}</p>
                      {!blocker.actionable ? (
                        <p className="mt-1 text-small text-basic-tertiary">
                          Wait for this work to finish safely.
                        </p>
                      ) : settlement === "settling" ? (
                        <p className="mt-1 text-small text-basic-tertiary">
                          Stop requested. Waiting for cleanup to finish.
                        </p>
                      ) : settlement === "failed" ? (
                        <p role="alert" className="mt-1 text-small text-error-primary">
                          The stop request failed. Refresh status or try again.
                        </p>
                      ) : null}
                    </div>
                    {blocker.actionable ? (
                      <Button
                        size={ButtonSize.Small}
                        variant={ButtonVariant.SecondaryDestructive}
                        content={ButtonContent.Text}
                        onClick={() => onSettle(blocker)}
                        loading={settlement === "requesting"}
                        disabled={settlement === "settling"}
                      >
                        {settlement === "settling"
                          ? "Waiting for cleanup"
                          : settlement === "failed"
                            ? `Try again: ${managedUpgradeActionLabel(blocker.action)}`
                            : managedUpgradeActionLabel(blocker.action)}
                      </Button>
                    ) : (
                      <span className="rounded-full border border-basic px-2 py-1 text-small text-basic-tertiary">
                        Wait only
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
