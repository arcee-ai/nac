import {
  DropdownContent,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

import {
  actionButtonLabel,
  actionChildLabel,
  actionListFailed,
  actionListIcon,
  actionListIsSegmentsGroup,
  actionListTrailing,
  configForSegment,
  segmentIsLive,
  toolSegmentFailed,
} from "@/app/lib/agentSegments";
import type {
  ActionFilter,
  ActionItem,
  ActionTurnSection,
} from "@/app/lib/actionsTimeline";
import { formatStoreTime } from "@/app/lib/format";
import {
  collapseActionGroup,
  expandActionGroup,
  focusActionSegment,
  toggleActionGroup,
  useExpandedActionGroupId,
  useSelectedActionSegmentKey,
} from "@/app/lib/actionExpand";

export function actionFilterEmptyCopy(
  filter: ActionFilter,
  kind: "agent" | "orchestrator",
): { title: string; body: string } {
  switch (filter) {
    case "sessions":
      return {
        title: "No sessions yet.",
        body: "They appear here as the agent starts them.",
      };
    case "threads":
      return {
        title: "No threads yet.",
        body: "They appear here as the orchestrator assigns work.",
      };
    case "worksets":
      return {
        title: "No worksets yet.",
        body: "They appear here as the orchestrator defines them.",
      };
    case "tools":
      return {
        title: "No thoughts or tools yet.",
        body:
          kind === "orchestrator"
            ? "They appear here as the orchestrator works."
            : "They appear here as the agent works.",
      };
    default:
      return {
        title: "No actions yet.",
        body:
          kind === "orchestrator"
            ? "Start a conversation to create one."
            : "They appear here as the agent works.",
      };
  }
}

export function ActionListEmpty({
  filter,
  kind,
}: {
  filter: ActionFilter;
  kind: "agent" | "orchestrator";
}) {
  const copy = actionFilterEmptyCopy(filter, kind);
  return (
    <div className="flex flex-col px-2 pb-4 pt-2 text-micro">
      <p className="text-basic-tertiary">{copy.title}</p>
      <p className="text-basic-muted">{copy.body}</p>
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

function nearestScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

export function ActionListButton({
  label,
  trailing,
  icon,
  running = false,
  failed = false,
  pending = false,
  active = false,
  disabled = false,
  expanded,
  controls,
  title,
  onClick,
  preventFocusScroll = false,
}: {
  label: string;
  trailing?: string;
  icon: IconName;
  running?: boolean;
  failed?: boolean;
  pending?: boolean;
  active?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  title?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  preventFocusScroll?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      aria-expanded={expanded}
      aria-controls={controls}
      onMouseDown={
        preventFocusScroll
          ? (event) => {
              event.preventDefault();
            }
          : undefined
      }
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
  expanded,
  selectedSegmentKey,
  onSelect,
  onSelectSegment,
}: {
  item: Extract<ActionItem, { kind: "group" }>;
  active: boolean;
  expanded: boolean;
  selectedSegmentKey: string | null;
  onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  onSelectSegment: (groupId: string, segmentKey: string) => void;
}) {
  const expandable = actionListIsSegmentsGroup(item.group);
  const panelId = `${item.id}-segments`;
  return (
    <div
      data-action-anchor={item.id}
      className="flex flex-col w-full [overflow-anchor:auto]"
    >
      <ActionListButton
        label={actionButtonLabel(item.group)}
        trailing={actionListTrailing(item.group)}
        icon={actionListIcon(item.group)}
        running={item.group.inProgress}
        active={active}
        expanded={expandable ? expanded : undefined}
        controls={expandable ? panelId : undefined}
        onClick={(event) => onSelect(item.id, event)}
      />
      {expandable ? (
        <DropdownContent
          id={panelId}
          isOpen={expanded}
          className="w-full [overflow-anchor:none]"
          aria-hidden={!expanded}
          inert={!expanded || undefined}
        >
          <div className="flex flex-col gap-0 pl-4">
            {[...item.group.segments].reverse().map((segment) => {
              const config = configForSegment(segment);
              return (
                <ActionListButton
                  key={segment.key}
                  label={actionChildLabel(segment)}
                  icon={config.icon}
                  running={segmentIsLive(segment)}
                  failed={toolSegmentFailed(segment)}
                  active={selectedSegmentKey === segment.key}
                  preventFocusScroll
                  onClick={() => onSelectSegment(item.id, segment.key)}
                />
              );
            })}
          </div>
        </DropdownContent>
      ) : null}
    </div>
  );
}

export function ActionSpawnRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "spawn" }>;
  active: boolean;
  onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const lead = item.group.segments[0];
  const icon = lead ? configForSegment(lead).icon : IconName.Plane;
  const failed = actionListFailed(item.group);
  return (
    <div data-action-anchor={item.id} className="[overflow-anchor:auto]">
      <ActionListButton
        label={item.title}
        trailing={failed || item.group.inProgress ? undefined : "Session"}
        icon={icon}
        running={item.group.inProgress}
        failed={failed}
        active={active}
        onClick={(event) => onSelect(item.id, event)}
      />
    </div>
  );
}

export function ActionWorksetRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "workset" }>;
  active: boolean;
  onSelect: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div data-action-anchor={item.id} className="[overflow-anchor:auto]">
      <ActionListButton
        label={item.title}
        trailing={item.pending ? undefined : "Workset"}
        icon={IconName.Checklist}
        running={item.pending}
        active={active}
        onClick={(event) => onSelect(item.id, event)}
      />
    </div>
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
  onSelect: (
    name: string,
    episodeKey: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const failed = Boolean(cancelled || errored);
  return (
    <div data-action-anchor={item.id} className="[overflow-anchor:auto]">
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
        onClick={(event) => onSelect(item.name, item.episodeKey, event)}
      />
    </div>
  );
}

interface ActionListHandlers {
  selectedGroupId: string | null;
  selectedThreadEpisode: string | null;
  expandedGroupId: string | null;
  selectedSegmentKey: string | null;
  episodeCount: (name: string) => number;
  threadFlags?: (name: string) => {
    pending: boolean;
    running: boolean;
    cancelled: boolean;
    errored: boolean;
  };
  onSelectGroup: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  onSelectSpawn: (id: string, event: MouseEvent<HTMLButtonElement>) => void;
  onSelectThread: (
    name: string,
    episodeKey: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  onSelectSegment: (groupId: string, segmentKey: string) => void;
}

function renderItem(item: ActionItem, args: ActionListHandlers) {
  if (item.kind === "group") {
    return (
      <ActionGroupRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        expanded={args.expandedGroupId === item.id}
        selectedSegmentKey={args.selectedSegmentKey}
        onSelect={args.onSelectGroup}
        onSelectSegment={args.onSelectSegment}
      />
    );
  }
  if (item.kind === "spawn") {
    return (
      <ActionSpawnRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        onSelect={args.onSelectSpawn}
      />
    );
  }
  if (item.kind === "workset") {
    return (
      <ActionWorksetRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        onSelect={args.onSelectSpawn}
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
  pinToNewest = false,
  onSelectGroup,
  onSelectThread,
}: {
  items: readonly ActionItem[];
  selectedGroupId: string | null;
  selectedThreadEpisode: string | null;
  pinToNewest?: boolean;
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
  const expandedGroupId = useExpandedActionGroupId();
  const selectedSegmentKey = useSelectedActionSegmentKey();
  const prevSelected = useRef<string | null | undefined>(undefined);
  const pendingAnchor = useRef<{
    id: string;
    top: number;
    scroller: HTMLElement;
  } | null>(null);

  const rememberAnchor = (id: string, el: HTMLElement) => {
    const scroller = nearestScrollParent(el);
    if (!scroller) return;
    pendingAnchor.current = {
      id,
      top: el.getBoundingClientRect().top,
      scroller,
    };
  };

  const newestId = items[0]?.id;
  useLayoutEffect(() => {
    if (!pinToNewest || !newestId) return;
    const el = document.querySelector(
      `[data-action-anchor="${CSS.escape(newestId)}"]`,
    );
    if (!(el instanceof HTMLElement)) return;
    const scroller = nearestScrollParent(el);
    if (scroller) scroller.scrollTop = 0;
  }, [pinToNewest, newestId]);

  useEffect(() => {
    if (selectedGroupId === prevSelected.current) return;
    prevSelected.current = selectedGroupId;
    const selected = items.find((item) => item.id === selectedGroupId);
    if (
      selected?.kind === "group" &&
      actionListIsSegmentsGroup(selected.group)
    ) {
      expandActionGroup(selected.id);
    } else {
      collapseActionGroup();
    }
  }, [items, selectedGroupId]);

  useLayoutEffect(() => {
    const pending = pendingAnchor.current;
    if (!pending) return;
    pendingAnchor.current = null;
    const el = pending.scroller.querySelector(
      `[data-action-anchor="${CSS.escape(pending.id)}"]`,
    );
    if (!(el instanceof HTMLElement)) return;
    pending.scroller.scrollTop += el.getBoundingClientRect().top - pending.top;
  }, [expandedGroupId]);

  const handleSelectGroup = (
    id: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    rememberAnchor(id, event.currentTarget);
    const selected = items.find((item) => item.id === id);
    if (
      selected?.kind === "group" &&
      actionListIsSegmentsGroup(selected.group)
    ) {
      toggleActionGroup(id);
    } else {
      collapseActionGroup();
    }
    onSelectGroup(id);
  };

  const handleSelectSpawn = (
    id: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    rememberAnchor(id, event.currentTarget);
    collapseActionGroup();
    onSelectGroup(id);
  };

  const handleSelectThread = (
    name: string,
    episodeKey: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    rememberAnchor(episodeKey, event.currentTarget);
    collapseActionGroup();
    onSelectThread(name, episodeKey);
  };

  const handleSelectSegment = (groupId: string, segmentKey: string) => {
    focusActionSegment(segmentKey);
    onSelectGroup(groupId);
  };

  const args: ActionListHandlers = {
    selectedGroupId,
    selectedThreadEpisode,
    expandedGroupId,
    selectedSegmentKey,
    episodeCount,
    threadFlags,
    onSelectGroup: handleSelectGroup,
    onSelectSpawn: handleSelectSpawn,
    onSelectThread: handleSelectThread,
    onSelectSegment: handleSelectSegment,
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
