import { Loader, LoaderSize } from "@/app/atoms";
import { FormSection } from "@/app/components/modals/FormSection";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import { ManagedUpgradePanel } from "@/app/features/managed/presentation/ManagedUpgradePanel";
import { managedHostErrorText } from "./managedErrorText";

export function StatusDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ready ? "bg-success-primary" : "bg-warning-primary"}`}
    />
  );
}

export function ManagedStatusPanel() {
  const status = useManagedHostStatus();
  if (status.isLoading) {
    return (
      <div role="status" className="flex items-center gap-3 text-small text-basic-secondary">
        <Loader size={LoaderSize.Small} />
        Checking managed host…
      </div>
    );
  }
  if (!status.data) {
    return (
      <p role="alert" className="text-small text-error-primary">
        Managed host status is unavailable. {status.error ? managedHostErrorText(status.error) : ""}
      </p>
    );
  }
  const host = status.data;
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="managed-host-status">
      {status.error ? (
        <p role="alert" className="text-small !leading-[22px] text-error-primary">
          Host status could not be refreshed. Last known status is shown below.{" "}
          {managedHostErrorText(status.error)}
        </p>
      ) : null}
      <FormSection
        title={host.logical_host_id}
        description={`Managed NAC · ${host.public_hostname}`}
      >
        <dl className="grid grid-cols-1 gap-4 border-y border-basic py-4 sm:grid-cols-2">
          <StatusSummary
            label={host.model.display_name}
            value={host.model_ready ? host.model.id : "Needs attention"}
            ready={host.model_ready}
          />
          <StatusSummary
            label="GitHub"
            value={host.github_status.replaceAll("-", " ")}
            ready={host.github_status === "connected"}
          />
          <StatusSummary label="Projects" value={String(host.project_count)} />
          <StatusSummary label="Host secrets" value={String(host.secret_count)} />
        </dl>
      </FormSection>
      <FormSection title="Readiness" description="Checks reported by this host.">
        <ul className="divide-y divide-basic">
          {host.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-1.5">
                <StatusDot ready={check.ready} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="label-small text-basic-primary">{check.name}</p>
                  <span
                    className={`text-small ${check.ready ? "text-success-primary" : "text-warning-primary"}`}
                  >
                    {check.ready ? "Ready" : "Needs attention"}
                  </span>
                </div>
                <p className="mt-1 text-small !leading-[22px] text-basic-secondary break-words">
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </FormSection>
      <FormSection title="Host details" className="border-t border-basic pt-6">
        <dl className="flex min-w-0 flex-col gap-4">
          <div>
            <dt className="text-small text-basic-secondary">Managed model endpoint</dt>
            <dd className="mt-1 code-small break-all text-basic-primary">{host.model.endpoint}</dd>
          </div>
          <div>
            <dt className="text-small text-basic-secondary">Repository root</dt>
            <dd className="mt-1 code-small break-all text-basic-primary">{host.repository_root}</dd>
          </div>
          <div>
            <dt className="text-small text-basic-secondary">NAC version</dt>
            <dd className="mt-1 text-small text-basic-primary">
              v{host.version} · schema {host.schema_version}
            </dd>
          </div>
        </dl>
      </FormSection>
      <ManagedUpgradePanel />
    </div>
  );
}

function StatusSummary({ label, value, ready }: { label: string; value: string; ready?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-basic-secondary">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 label-small text-basic-primary break-words">
        {ready !== undefined ? <StatusDot ready={ready} /> : null}
        {value}
      </dd>
    </div>
  );
}
