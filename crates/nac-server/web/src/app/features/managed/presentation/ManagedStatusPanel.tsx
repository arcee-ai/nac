import { Loader, LoaderSize } from "@/app/atoms";
import { useManagedHostStatus } from "@/app/features/managed/queries";

export function StatusDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${ready ? "bg-success-primary" : "bg-warning-primary"}`}
    />
  );
}

export function ManagedStatusPanel() {
  const status = useManagedHostStatus();
  if (status.isLoading) return <Loader size={LoaderSize.Medium} />;
  if (!status.data) {
    return <p className="text-error-primary">Managed host status is unavailable.</p>;
  }
  const host = status.data;
  return (
    <div className="flex flex-col gap-5" data-testid="managed-host-status">
      <div>
        <p className="header-xl text-basic-primary">{host.logical_host_id}</p>
        <p className="text-small text-basic-tertiary">Managed NAC · {host.public_hostname}</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatusCard
          label="Arcee model"
          value={host.model_ready ? "Ready" : "Needs attention"}
          ready={host.model_ready}
        />
        <StatusCard
          label="GitHub"
          value={host.github_status.replace("-", " ")}
          ready={host.github_status === "connected"}
        />
        <StatusCard label="Projects" value={String(host.project_count)} ready />
        <StatusCard label="Host secrets" value={String(host.secret_count)} ready />
      </div>
      <div className="rounded-lg bg-elevation-level-2 p-4">
        <p className="label-small text-basic-secondary">Repository root</p>
        <p className="code-small break-all text-basic-primary">{host.repository_root}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="label-medium text-basic-primary">Readiness</p>
          <span className="text-small text-basic-tertiary">
            v{host.version} · schema {host.schema_version}
          </span>
        </div>
        {host.checks.map((check) => (
          <div
            key={check.name}
            className="flex items-start gap-2 rounded-lg border border-basic p-3"
          >
            <span className="mt-2">
              <StatusDot ready={check.ready} />
            </span>
            <div className="min-w-0">
              <p className="label-small text-basic-primary">{check.name}</p>
              <p className="text-small text-basic-tertiary break-words">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusCard({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="rounded-lg border border-basic p-4">
      <p className="text-small text-basic-tertiary">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <StatusDot ready={ready} />
        <p className="label-medium capitalize text-basic-primary">{value}</p>
      </div>
    </div>
  );
}
