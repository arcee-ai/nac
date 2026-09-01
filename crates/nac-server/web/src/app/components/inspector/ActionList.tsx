import {
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
  Select,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { ReactNode } from "react";

import {
  actionListFailed,
  actionListIcon,
  actionListLabel,
  actionListTrailing,
  configForSegment,
} from "@/app/lib/agentSegments";
import type {
  ActionFilter,
  ActionItem,
  ActionTurnSection,
} from "@/app/lib/actionsTimeline";
import { formatStoreTime } from "@/app/lib/format";

const FILTER_LABEL: Record<ActionFilter, string> = {
  all: "All actions",
  threads: "Threads",
  tools: "Thoughts & tools",
  sessions: "Sessions",
};

export function ActionFilterBar({
  value,
  options,
  onChange,
}: {
  value: ActionFilter;
  options: readonly ActionFilter[];
  onChange: (value: ActionFilter) => void;
}) {
  return (
    <div className="flex items-center gap-3 shrink-0 border-b border-muted bg-elevation-level-1 pl-3 pr-2 py-2">
      <span className="flex-1 min-w-0 label-micro text-basic-primary">
        Show:
      </span>
      <Select
        size={ButtonSize.Small}
        variant={ButtonVariant.Secondary}
        value={value}
        items={options.map((id) => ({ id, label: FILTER_LABEL[id] }))}
        onValueChange={(id) => {
          if (
            id === "all" ||
            id === "threads" ||
            id === "tools" ||
            id === "sessions"
          ) {
            onChange(id);
          }
        }}
      />
    </div>
  );
}

export function ActionTurnHeader({ section }: { section: ActionTurnSection }) {
  const when = section.createdAt ? formatStoreTime(section.createdAt) : null;
  return (
    <div className="flex items-center gap-1 h-[33px] px-1 pt-4 pb-0.5 border-b border-muted whitespace-nowrap">
      <span className="shrink-0 text-[10px] leading-[14px] text-basic-tertiary">
        #{section.number}
      </span>
      <span className="flex-1 min-w-0 truncate text-[11px] leading-[14px] text-basic-tertiary">
        {section.prompt || "Untitled turn"}
      </span>
      {when ? (
        <span className="shrink-0 text-[10px] leading-[14px] text-basic-tertiary">
          {when}
        </span>
      ) : null}
    </div>
  );
}

function ActionListButton({
  label,
  trailing,
  icon,
  running = false,
  failed = false,
  pending = false,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  label: string;
  trailing?: string;
  icon: IconName;
  running?: boolean;
  failed?: boolean;
  pending?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 h-9 px-2 py-1 rounded-[4px] disabled:opacity-100",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--blue-500)]",
        disabled && "cursor-default",
        active
          ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
          : "bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
      )}
    >
      {running ? (
        <Loader
          size={LoaderSize.Micro}
          variant={LoaderVariant.Neutral}
          className="shrink-0"
        />
      ) : (
        <Icon
          iconName={failed ? IconName.Close : pending ? IconName.Clock : icon}
          size={16}
          className={cn(
            "shrink-0",
            failed && "text-error-primary",
            pending && "text-basic-primary opacity-40",
          )}
        />
      )}
      <span
        className={cn(
          "flex-1 min-w-0 truncate text-left label-micro",
          running
            ? "text-shimmer-basic"
            : pending
              ? "text-basic-tertiary"
              : "text-basic-secondary",
        )}
      >
        {label}
      </span>
      {trailing ? (
        <span className="shrink-0 font-medium text-[10px] leading-[12px] uppercase text-basic-muted whitespace-nowrap overflow-hidden text-ellipsis">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

export function ActionGroupRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "group" }>;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const failed = actionListFailed(item.group);
  return (
    <ActionListButton
      label={actionListLabel(item.group)}
      trailing={actionListTrailing(item.group)}
      icon={actionListIcon(item.group)}
      running={item.group.inProgress}
      failed={failed}
      active={active}
      onClick={() => onSelect(item.id)}
    />
  );
}

export function ActionSpawnRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "spawn" }>;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const lead = item.group.segments[0];
  const icon = lead ? configForSegment(lead).icon : IconName.Plane;
  const failed = actionListFailed(item.group);
  return (
    <ActionListButton
      label={item.title}
      trailing={failed || item.group.inProgress ? undefined : "Spawn"}
      icon={icon}
      running={item.group.inProgress}
      failed={failed}
      active={active}
      onClick={() => onSelect(item.id)}
    />
  );
}

export function ActionThreadRow({
  item,
  active,
  episodeCount,
  pending,
  running,
  cancelled,
  errored,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "thread" }>;
  active: boolean;
  episodeCount: number;
  pending?: boolean;
  running?: boolean;
  cancelled?: boolean;
  errored?: boolean;
  onSelect: (name: string, episodeKey: string) => void;
}) {
  const failed = Boolean(cancelled || errored);
  return (
    <ActionListButton
      label={item.name}
      trailing={`Thread, ${episodeCount}`}
      icon={IconName.Chat}
      running={running && !failed}
      failed={failed}
      pending={pending}
      active={active}
      disabled={pending}
      title={pending ? "Waiting on source threads" : item.action || undefined}
      onClick={() => onSelect(item.name, item.episodeKey)}
    />
  );
}

function renderItem(
  item: ActionItem,
  args: {
    selectedGroupId: string | null;
    selectedThreadEpisode: string | null;
    episodeCount: (name: string) => number;
    threadFlags?: (name: string) => {
      pending: boolean;
      running: boolean;
      cancelled: boolean;
      errored: boolean;
    };
    onSelectGroup: (id: string) => void;
    onSelectThread: (name: string, episodeKey: string) => void;
  },
) {
  if (item.kind === "group") {
    return (
      <ActionGroupRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        onSelect={args.onSelectGroup}
      />
    );
  }
  if (item.kind === "spawn") {
    return (
      <ActionSpawnRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        onSelect={args.onSelectGroup}
      />
    );
  }
  const flags = args.threadFlags?.(item.name) ?? {
    pending: false,
    running: item.state === "running" || item.state === "pending",
    cancelled: item.state === "cancelled",
    errored: item.state === "error",
  };
  return (
    <ActionThreadRow
      key={item.id}
      item={item}
      active={args.selectedThreadEpisode === item.episodeKey}
      episodeCount={args.episodeCount(item.name)}
      pending={flags.pending}
      running={flags.running}
      cancelled={flags.cancelled}
      errored={flags.errored}
      onSelect={args.onSelectThread}
    />
  );
}

/** Consecutive nested threads share one left-border gutter, as in the design. */
export function ActionItemList({
  items,
  selectedGroupId,
  selectedThreadEpisode,
  episodeCount,
  threadFlags,
  onSelectGroup,
  onSelectThread,
}: {
  items: readonly ActionItem[];
  selectedGroupId: string | null;
  selectedThreadEpisode: string | null;
  episodeCount: (name: string) => number;
  threadFlags?: (name: string) => {
    pending: boolean;
    running: boolean;
    cancelled: boolean;
    errored: boolean;
  };
  onSelectGroup: (id: string) => void;
  onSelectThread: (name: string, episodeKey: string) => void;
}) {
  const args = {
    selectedGroupId,
    selectedThreadEpisode,
    episodeCount,
    threadFlags,
    onSelectGroup,
    onSelectThread,
  };
  const nodes: ReactNode[] = [];
  let nested: ActionItem[] = [];
  const flushNested = () => {
    if (nested.length === 0) return;
    nodes.push(
      <div
        key={`nested-${nested[0].id}`}
        className="flex flex-col w-full border-l border-primary pl-0.5 py-1"
      >
        {nested.map((item) => renderItem(item, args))}
      </div>,
    );
    nested = [];
  };
  for (const item of items) {
    if (item.kind === "thread" && item.nested) {
      nested.push(item);
      continue;
    }
    flushNested();
    nodes.push(renderItem(item, args));
  }
  flushNested();
  return <>{nodes}</>;
}
