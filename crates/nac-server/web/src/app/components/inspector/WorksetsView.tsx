import type { ReactNode } from "react";

import { Badge, BadgeColor } from "@/app/atoms";
import {
  PanelEmpty,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import type {
  SessionSnapshotResponse,
  WorksetItemSnapshot,
  WorksetSnapshot,
} from "@/app/types/api";

const STATUS_TONE: Record<string, string> = {
  done: "text-success-primary",
  completed: "text-success-primary",
  finished: "text-success-primary",
  active: "text-info-primary",
  running: "text-info-primary",
  in_progress: "text-info-primary",
  blocked: "text-error-primary",
  failed: "text-error-primary",
};

const statusTone = (status: string) =>
  STATUS_TONE[status.toLowerCase()] ?? "text-basic-secondary";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="tag-label text-basic-muted">{label}</span>
      {children}
    </div>
  );
}

function Item({ item }: { item: WorksetItemSnapshot }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-[8px] border border-muted bg-elevation-level-0-5">
      {item.role ? (
        <Badge text={item.role} color={BadgeColor.Blue} className="self-start" />
      ) : null}
      <span className="label-small text-basic-primary">{item.title}</span>
      {item.scope ? (
        <span className="code code-small text-danger-primary break-words">
          {item.scope}
        </span>
      ) : null}
      {item.description ? (
        <p className="paragraph-small text-basic-secondary">{item.description}</p>
      ) : null}
      {item.acceptance ? (
        <Field label="Acceptance">
          <p className="paragraph-small text-basic-secondary">{item.acceptance}</p>
        </Field>
      ) : null}
      {item.depends_on.length > 0 ? (
        <Field label="Depends on">
          <span className="code code-small text-basic-tertiary">
            {item.depends_on.join(", ")}
          </span>
        </Field>
      ) : null}
      {item.notes ? (
        <p className="paragraph-small text-basic-muted italic">{item.notes}</p>
      ) : null}
    </div>
  );
}

function Detail({ workset }: { workset: WorksetSnapshot }) {
  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0">
      <Field label="ID">
        <span className="label-big text-basic-primary break-words">{workset.id}</span>
      </Field>
      {workset.goal ? (
        <Field label="Goal">
          <p className="paragraph-medium text-basic-secondary">{workset.goal}</p>
        </Field>
      ) : null}
      {workset.status ? (
        <Field label="Status">
          <span className={cn("code code-medium", statusTone(workset.status))}>
            {workset.status}
          </span>
        </Field>
      ) : null}
      {workset.summary ? (
        <Field label="Summary">
          <p className="paragraph-medium text-basic-secondary">{workset.summary}</p>
        </Field>
      ) : null}
      {workset.verification_recipe ? (
        <Field label="Verification recipe">
          <p className="paragraph-medium text-basic-secondary whitespace-pre-wrap">
            {workset.verification_recipe}
          </p>
        </Field>
      ) : null}
      {workset.items.length > 0 ? (
        <Field label="Workset items">
          <div className="flex flex-col gap-2 pt-1">
            {workset.items.map((item) => (
              <Item key={item.position} item={item} />
            ))}
          </div>
        </Field>
      ) : null}
    </div>
  );
}

/** Structured plans attached to the session: the list, and one plan in full. */
export function WorksetsView({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: SessionSnapshotResponse | null;
  /** Workset the chat pointed at, if any. */
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  if (!snapshot) return <PanelEmpty>Loading…</PanelEmpty>;

  const worksets = snapshot.worksets;
  if (worksets.error) {
    return <div className="p-6 label-small text-error-primary">{worksets.error}</div>;
  }
  if (worksets.items.length === 0) {
    return <PanelEmpty>No worksets defined for this session.</PanelEmpty>;
  }

  const current =
    worksets.items.find((item) => item.id === selected) ?? worksets.items[0];

  return (
    <PanelSplit
      list={worksets.items.map((workset) => (
        <PanelRow
          key={workset.id}
          label={workset.id}
          active={workset.id === current.id}
          trailing={
            <span className="code code-micro text-basic-muted shrink-0">
              {workset.items.length}
            </span>
          }
          onClick={() => onSelect(workset.id)}
        />
      ))}
    >
      <Detail workset={current} />
    </PanelSplit>
  );
}
