import type { ReactNode } from "react";

import { Badge, BadgeColor, Icon, IconName } from "@/app/atoms";
import { PanelFailure, PanelListNote } from "@/app/components/inspector/PanelMessages";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
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

const statusTone = (status: string) => STATUS_TONE[status.toLowerCase()] ?? "text-basic-secondary";

/**
 * The design's Plex Mono Medium without tracking, at 14/20 and 12/16. `.code`
 * sets a 1.5 line height and tracking in unlayered CSS, which only `!`
 * utilities outrank.
 */
const CODE_SMALL = "code text-sm font-medium !leading-5 !tracking-normal";
const CODE_MICRO = "code text-xs font-medium !leading-4 !tracking-normal";

/** A field is labelled with the workset tool's own name for that argument. */
function Label({ children }: { children: ReactNode }) {
  return <span className="tag-label text-basic-tertiary">{children}</span>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Item({ item }: { item: WorksetItemSnapshot }) {
  return (
    <div className="flex flex-col gap-4 p-3 rounded-[4px] bg-elevation-sublevel-variant-A shadow-concave">
      {item.role ? <Badge text={item.role} color={BadgeColor.Blue} className="self-start" /> : null}
      <div className="flex flex-col gap-1">
        <span className="header-sm text-basic-primary">{item.title}</span>
        {item.scope ? (
          <span className={cn(CODE_MICRO, "text-danger-primary break-words")}>{item.scope}</span>
        ) : null}
      </div>
      {item.description ? (
        <p className="text-small text-basic-secondary">{item.description}</p>
      ) : null}
      {item.acceptance ? (
        <Field label="acceptance">
          <p className="text-small text-basic-secondary">{item.acceptance}</p>
        </Field>
      ) : null}
      {item.depends_on.length > 0 ? (
        <Field label="depends_on">
          <span className={cn(CODE_MICRO, "text-basic-secondary break-words")}>
            {item.depends_on.join(", ")}
          </span>
        </Field>
      ) : null}
      {item.notes ? (
        <div className="flex items-start gap-1 text-info-secondary">
          <Icon iconName={IconName.Info} size={16} className="shrink-0" />
          <p className="flex-1 min-w-0 text-micro">{item.notes}</p>
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
        "flex flex-col gap-8 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
        isMobile && "py-18",
      )}
    >
      <div className="flex flex-col gap-4">
        <Field label="id">
          <span className="header-md text-basic-primary break-words">{workset.id}</span>
        </Field>
        {workset.goal ? (
          <Field label="goal">
            <p className="text-medium text-basic-primary">{workset.goal}</p>
          </Field>
        ) : null}
        {workset.status ? (
          <Field label="status">
            <span className={cn(CODE_SMALL, statusTone(workset.status))}>{workset.status}</span>
          </Field>
        ) : null}
        {workset.summary ? (
          <Field label="summary">
            <p className="text-medium text-basic-primary">{workset.summary}</p>
          </Field>
        ) : null}
        {workset.verification_recipe ? (
          <Field label="verification_recipe">
            <p className="text-medium text-basic-primary whitespace-pre-wrap">
              {workset.verification_recipe}
            </p>
          </Field>
        ) : null}
      </div>
      {workset.items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>workset_items</Label>
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
  if (!snapshot) return <PanelLoading listTitle="Worksets" />;

  const worksets = snapshot.worksets;
  if (worksets.error) {
    return <PanelFailure listTitle="Worksets">{worksets.error}</PanelFailure>;
  }

  const current = worksets.items.find((item) => item.id === selected) ?? worksets.items[0] ?? null;
  // A phone opens on the list, so only a workset you opened is marked there.
  const marked = isMobile ? selected : current?.id;

  return (
    <PanelSplit
      listTitle="Worksets"
      title={current?.id}
      listClassName="px-2"
      list={
        worksets.items.length === 0 ? (
          <PanelListNote>No worksets defined for this session.</PanelListNote>
        ) : (
          <div className="flex flex-col gap-1">
            {worksets.items.map((workset) => (
              <PanelRow
                key={workset.id}
                label={workset.id}
                active={workset.id === marked}
                trailing={
                  isMobile ? (
                    <Icon iconName={IconName.Right} size={24} className="shrink-0" />
                  ) : null
                }
                onClick={() => onSelect(workset.id)}
              />
            ))}
          </div>
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
