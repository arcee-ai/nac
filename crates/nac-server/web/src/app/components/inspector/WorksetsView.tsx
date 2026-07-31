import { useState } from "react";

import { Badge, BadgeColor, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type {
  SessionSnapshotResponse,
  WorksetItemSnapshot,
  WorksetSnapshot,
} from "@/app/types/api";

const STATUS_COLOR: Record<string, BadgeColor> = {
  done: BadgeColor.Green,
  completed: BadgeColor.Green,
  active: BadgeColor.Blue,
  in_progress: BadgeColor.Blue,
  blocked: BadgeColor.Red,
  failed: BadgeColor.Red,
  planned: BadgeColor.Gray,
  pending: BadgeColor.Gray,
};

const statusColor = (status: string) =>
  STATUS_COLOR[status.toLowerCase()] ?? BadgeColor.Neutral;

function Item({ item }: { item: WorksetItemSnapshot }) {
  return (
    <div className="rounded-lg border border-secondary bg-elevation-level-0-5 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-micro text-basic-muted font-mono shrink-0">
          {item.position}
        </span>
        <span className="label-small text-basic-primary truncate flex-grow">
          {item.title}
        </span>
        {item.role ? <Badge text={item.role} color={BadgeColor.Gray} /> : null}
      </div>
      {item.scope ? (
        <div className="text-micro text-basic-muted mb-1 font-mono truncate">
          {item.scope}
        </div>
      ) : null}
      {item.description ? (
        <p className="paragraph-medium text-basic-secondary">{item.description}</p>
      ) : null}
      {item.acceptance ? (
        <p className="text-micro text-basic-tertiary mt-1">
          <span className="text-basic-muted">Acceptance:</span> {item.acceptance}
        </p>
      ) : null}
      {item.depends_on.length > 0 ? (
        <p className="text-micro text-basic-tertiary mt-1">
          <span className="text-basic-muted">Depends on:</span>{" "}
          {item.depends_on.join(", ")}
        </p>
      ) : null}
      {item.notes ? (
        <p className="text-micro text-basic-muted mt-1 italic">{item.notes}</p>
      ) : null}
    </div>
  );
}

function Workset({ workset }: { workset: WorksetSnapshot }) {
  const [open, setOpen] = useState(true);
  const items = workset.items;

  return (
    <div className="rounded-xl border border-secondary bg-elevation-level-1">
      <button
        type="button"
        className="w-full flex items-center gap-2 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          iconName={IconName.Down}
          className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")}
        />
        <span className="label-small text-basic-primary truncate flex-grow">
          {workset.goal || workset.id}
        </span>
        <Badge text={workset.status || "?"} color={statusColor(workset.status)} />
        <Badge text={`${items.length} items`} color={BadgeColor.Gray} />
      </button>

      {open ? (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="text-micro text-basic-muted font-mono">{workset.id}</div>
          {workset.summary ? (
            <p className="paragraph-medium text-basic-secondary">{workset.summary}</p>
          ) : null}
          {workset.verification_recipe ? (
            <div className="rounded-lg border border-secondary bg-elevation-level-0-5 p-2">
              <div className="tag-label text-basic-muted mb-1">
                Verification recipe
              </div>
              <pre className="text-micro text-basic-secondary whitespace-pre-wrap font-mono">
                {workset.verification_recipe}
              </pre>
            </div>
          ) : null}
          {items.map((item) => (
            <Item key={item.position} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Structured plans (goal plus items) attached to the session. */
export function WorksetsView({
  snapshot,
}: {
  snapshot: SessionSnapshotResponse | null;
}) {
  if (!snapshot) {
    return <div className="p-6 text-basic-muted label-small">Loading…</div>;
  }
  const worksets = snapshot.worksets;
  if (worksets.error) {
    return <div className="p-6 text-error-primary label-small">{worksets.error}</div>;
  }
  if (worksets.items.length === 0) {
    return (
      <div className="p-6 text-basic-muted label-small">
        No worksets defined for this session.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 flex flex-col gap-3 [&>*]:shrink-0">
      {worksets.items.map((workset) => (
        <Workset key={workset.id} workset={workset} />
      ))}
    </div>
  );
}
