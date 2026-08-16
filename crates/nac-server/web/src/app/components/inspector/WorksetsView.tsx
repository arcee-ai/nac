import type { ReactNode } from "react";

import { Badge, BadgeColor } from "@/app/atoms";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import type {
  SessionSnapshotResponse,
  WorksetItemSnapshot,
  WorksetSnapshot,
} from "@/app/types/api";

interface StatusToneMap {
  [status: string]: string;
}

const STATUS_TONE: StatusToneMap = {
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
    <div className="flex flex-col gap-4 p-4 rounded-[8px] border border-muted bg-elevation-level-1">
      {item.role ? (
        <Badge
          text={item.role}
          color={BadgeColor.Blue}
          className="self-start"
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <span className="header-small text-basic-primary">{item.title}</span>
        {item.scope ? (
          <span className="code code-small text-danger-primary break-words">
            {item.scope}
          </span>
        ) : null}
        {item.description ? (
          <p className="text-small text-basic-secondary">{item.description}</p>
        ) : null}
      </div>
      {item.acceptance ? (
        <Field label="Acceptance">
          <p className="text-small text-basic-secondary">{item.acceptance}</p>
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
        <p className="text-small text-basic-muted italic">{item.notes}</p>
      ) : null}
    </div>
  );
}

function Detail({ workset }: { workset: WorksetSnapshot }) {
  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0">
      <Field label="ID">
        <span className="header-medium text-basic-primary break-words">
          {workset.id}
        </span>
      </Field>
      {workset.goal ? (
        <Field label="Goal">
          <p className="paragraph-small text-basic-primary">{workset.goal}</p>
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
          <p className="paragraph-small text-basic-primary">
            {workset.summary}
          </p>
        </Field>
      ) : null}
      {workset.verification_recipe ? (
        <Field label="Verification recipe">
          <p className="paragraph-small text-basic-primary whitespace-pre-wrap">
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
  if (!snapshot) return <PanelLoading listTitle="Worksets" />;

  const worksets = snapshot.worksets;
  if (worksets.error) {
    return (
      <div className="p-6 label-small text-error-primary">{worksets.error}</div>
    );
  }

  const current =
    worksets.items.find((item) => item.id === selected) ??
    worksets.items[0] ??
    null;

  return (
    <PanelSplit
      listTitle="Worksets"
      title={current?.id}
      list={
        worksets.items.length === 0 ? (
          <div className="p-1 label-micro text-basic-muted">
            No worksets defined for this session.
          </div>
        ) : (
          worksets.items.map((workset) => (
            <PanelRow
              key={workset.id}
              label={workset.id}
              active={workset.id === current?.id}
              trailing={
                <span className="code code-micro text-basic-muted shrink-0">
                  {workset.items.length}
                </span>
              }
              onClick={() => onSelect(workset.id)}
            />
          ))
        )
      }
    >
      {current ? (
        <Detail workset={current} />
      ) : (
        <PanelEmpty>No worksets defined for this session.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
