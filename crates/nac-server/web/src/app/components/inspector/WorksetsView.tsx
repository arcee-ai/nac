import type { ReactNode } from "react";

import { Badge, BadgeColor, Icon, IconName } from "@/app/atoms";
import { PanelEmptyState, PanelFailure } from "@/app/components/inspector/PanelMessages";
import { PanelLoading, PanelRow, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { usePanelListMarksOpen } from "@/app/hooks/usePanelListMarksOpen";
import { cn } from "@/app/lib/cn";
import type {
  SessionSnapshotResponse,
  WorksetItemSnapshot,
  WorksetSnapshot,
} from "@/app/types/api";

interface StatusToneMap {
  [status: string]: string;
}

/** Signal colours only where they mean something: done, blocked, in flight. */
const STATUS_TONE: StatusToneMap = {
  done: "bg-success-primary text-success-primary",
  completed: "bg-success-primary text-success-primary",
  finished: "bg-success-primary text-success-primary",
  active: "bg-[var(--f-wash-2)] text-basic-primary",
  running: "bg-[var(--f-wash-2)] text-basic-primary",
  in_progress: "bg-[var(--f-wash-2)] text-basic-primary",
  blocked: "bg-error-primary text-error-primary",
  failed: "bg-error-primary text-error-primary",
};

const statusTone = (status: string) =>
  STATUS_TONE[status.toLowerCase()] ?? "bg-[var(--f-wash-1)] text-basic-secondary";

/** Focus mono at 12.5px for identifiers the tool wrote. */
const CODE = "code text-[length:var(--type-mono)] !leading-5 !tracking-normal";

/** A field is labelled with the workset tool's own name for that argument. */
function Label({ children }: { children: ReactNode }) {
  return <span className="type-meta text-basic-tertiary">{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center self-start rounded-pill px-2 type-tag",
        statusTone(status),
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Item({ item }: { item: WorksetItemSnapshot }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-tertiary bg-elevation-level-1 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 type-strong text-basic-primary break-words">
          {item.title}
        </span>
        {item.role ? <Badge text={item.role} color={BadgeColor.Gray} className="shrink-0" /> : null}
      </div>
      {item.scope ? (
        <span className={cn(CODE, "-mt-1.5 text-basic-tertiary break-words")}>{item.scope}</span>
      ) : null}
      {item.description ? (
        <p className="type-body-chrome text-basic-secondary">{item.description}</p>
      ) : null}
      {item.acceptance ? (
        <Field label="acceptance">
          <p className="type-body-chrome text-basic-secondary">{item.acceptance}</p>
        </Field>
      ) : null}
      {item.depends_on.length > 0 ? (
        <Field label="depends_on">
          <span className={cn(CODE, "text-basic-secondary break-words")}>
            {item.depends_on.join(", ")}
          </span>
        </Field>
      ) : null}
      {item.notes ? (
        <div className="flex items-start gap-2 rounded-md bg-[var(--f-wash-1)] px-2.5 py-2 text-basic-secondary">
          <Icon
            iconName={IconName.Info}
            size={14}
            className="mt-0.5 shrink-0 text-basic-tertiary"
          />
          <p className="flex-1 min-w-0 type-meta">{item.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ workset }: { workset: WorksetSnapshot }) {
  // A phone's header floats over the top of the body rather than above it.
  const isMobile = useIsMobile();
  return (
    <div
      className={cn(
        "flex flex-col gap-6 flex-1 min-h-0 overflow-auto px-5 py-5 [&>*]:shrink-0",
        isMobile && "px-4 py-18",
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="type-heading text-basic-primary break-words">{workset.id}</span>
          {workset.status ? <StatusPill status={workset.status} /> : null}
        </div>
        {workset.goal ? (
          <Field label="goal">
            <p className="type-body-chrome text-basic-primary">{workset.goal}</p>
          </Field>
        ) : null}
        {workset.summary ? (
          <Field label="summary">
            <p className="type-body-chrome text-basic-primary">{workset.summary}</p>
          </Field>
        ) : null}
        {workset.verification_recipe ? (
          <Field label="verification_recipe">
            <p className="type-body-chrome text-basic-primary whitespace-pre-wrap">
              {workset.verification_recipe}
            </p>
          </Field>
        ) : null}
      </div>
      {workset.items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>
            workset_items · <span className="tabular">{workset.items.length}</span>
          </Label>
          {workset.items.map((item) => (
            <Item key={item.position} item={item} />
          ))}
        </div>
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
  const isMobile = useIsMobile();
  const marksOpen = usePanelListMarksOpen();
  if (!snapshot) return <PanelLoading listTitle="Worksets" />;

  const worksets = snapshot.worksets;
  if (worksets.error) {
    return <PanelFailure listTitle="Worksets">{worksets.error}</PanelFailure>;
  }
  if (worksets.items.length === 0) {
    return (
      <PanelEmptyState
        listTitle="Worksets"
        title="No worksets yet"
        description="Worksets will appear here once the Orchestrator decides to create them."
      />
    );
  }

  const current = worksets.items.find((item) => item.id === selected) ?? worksets.items[0];

  return (
    <PanelSplit
      listTitle="Worksets"
      title={current.id}
      listClassName="px-2"
      list={
        <div className="flex flex-col gap-1">
          {worksets.items.map((workset) => (
            <PanelRow
              key={workset.id}
              label={workset.id}
              active={marksOpen && workset.id === current.id}
              trailing={
                isMobile ? <Icon iconName={IconName.Right} size={24} className="shrink-0" /> : null
              }
              onClick={() => onSelect(workset.id)}
            />
          ))}
        </div>
      }
    >
      <Detail workset={current} />
    </PanelSplit>
  );
}
