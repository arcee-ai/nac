import { DropdownContent, Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import {
  configForSegment,
  segmentIsLive,
  toolSegmentFailed,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import {
  collapseActionGroup,
  expandActionGroup,
  focusActionSegment,
  toggleActionGroup,
  useExpandedActionGroupId,
  useSelectedActionSegmentKey,
} from "@/app/lib/actionExpand";
import {
  actionFilterEmptyCopy,
  filterActionTimeline,
  type ActionFilter,
  type ActionItem,
  type ActionTurnSection,
} from "@/app/lib/actionsTimeline";
import { cn } from "@/app/lib/cn";
import { formatSeconds, formatStoreTime } from "@/app/lib/format";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

function thoughtsOnly(group: AgentToolsGroup): boolean {
  return (
    group.segments.length > 0 && group.segments.every((segment) => segment.kind === "thinking")
  );
}

function groupIsExpandable(group: AgentToolsGroup): boolean {
  const tools = group.segments.filter((segment) => segment.kind === "tool");
  return (
    tools.length > 0 && (tools.length > 1 || group.segments.some((s) => s.kind === "thinking"))
  );
}

function settledGroupLabel(group: AgentToolsGroup): string {
  const labels = group.segments
    .map((segment) => configForSegment(segment).regularLabel)
    .filter((label, index, all) => all.indexOf(label) === index);
  if (labels.length === 0) return group.label;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]}, ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and more`;
}

function actionButtonLabel(group: AgentToolsGroup): string {
  if (group.inProgress) {
    if (thoughtsOnly(group)) return "Thinking…";
    if (group.segments.length === 1) {
      return configForSegment(group.segments[0]).inProgressLabel;
    }
    return `${settledGroupLabel(group)}…`;
  }
  const label = settledGroupLabel(group);
  if (!thoughtsOnly(group)) return label;
  const duration = formatSeconds(group.durationMs);
  return duration ? `${label}, ${duration}` : label;
}

function actionChildLabel(segment: AgentSegment): string {
  const config = configForSegment(segment);
  if (segmentIsLive(segment)) return config.inProgressLabel;
  if (segment.kind === "thinking") {
    const duration = formatSeconds(segment.durationMs);
    return duration ? `${config.regularLabel}, ${duration}` : config.regularLabel;
  }
  return config.regularLabel;
}

function groupFailed(group: AgentToolsGroup): boolean {
  return group.segments.some(toolSegmentFailed);
}

function groupTrailing(group: AgentToolsGroup): string | undefined {
  if (group.inProgress || thoughtsOnly(group)) return undefined;
  const tools = group.segments.filter((segment) => segment.kind === "tool");
  if (tools.length === 1 && group.segments.length === 1) return "Tool";
  return String(group.segments.length);
}

function groupIcon(group: AgentToolsGroup): IconName {
  if (groupIsExpandable(group)) return IconName.MenuHorizontal;
  const tool = group.segments.find((segment) => segment.kind === "tool");
  return tool ? configForSegment(tool).icon : IconName.Brain;
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
    <div className="flex h-[33px] items-center gap-1 whitespace-nowrap border-b border-muted px-1 pb-0.5 pt-4">
      <span className="shrink-0 text-[10px] leading-[14px] text-basic-tertiary">
        #{section.number}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] leading-[14px] text-basic-tertiary">
        {section.prompt || "Untitled turn"}
      </span>
      {when ? (
        <span className="shrink-0 text-[10px] leading-[14px] text-basic-tertiary">{when}</span>
      ) : null}
    </div>
  );
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
      onMouseDown={preventFocusScroll ? (event) => event.preventDefault() : undefined}
      onClick={onClick}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-1 rounded-[4px] px-2 py-1 disabled:opacity-100",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--blue-500)]",
        disabled && "cursor-default",
        active
          ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
          : "bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
      )}
    >
      {running ? (
        <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} className="shrink-0" />
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
          "min-w-0 flex-1 truncate text-left label-micro",
          running ? "text-shimmer-basic" : pending ? "text-basic-tertiary" : "text-basic-secondary",
        )}
      >
        {label}
      </span>
      {trailing ? (
        <span className="shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-medium uppercase leading-[12px] text-basic-muted">
          {trailing}
        </span>
      ) : null}
    </button>
  );
}

function ActionGroupRow({
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
  onSelect: (id: string) => void;
  onSelectSegment: (groupId: string, segmentKey: string) => void;
}) {
  const expandable = groupIsExpandable(item.group);
  const panelId = `${item.id}-segments`;
  return (
    <div data-action-anchor={item.id} className="flex w-full flex-col [overflow-anchor:auto]">
      <ActionListButton
        label={actionButtonLabel(item.group)}
        trailing={groupTrailing(item.group)}
        icon={groupIcon(item.group)}
        running={item.group.inProgress}
        failed={groupFailed(item.group)}
        active={active}
        expanded={expandable ? expanded : undefined}
        controls={expandable ? panelId : undefined}
        onClick={() => onSelect(item.id)}
      />
      {expandable ? (
        <DropdownContent
          id={panelId}
          isOpen={expanded}
          className="w-full [overflow-anchor:none]"
          aria-hidden={!expanded}
          inert={!expanded || undefined}
        >
          <div className="flex flex-col pl-4">
            {[...item.group.segments].reverse().map((segment) => (
              <ActionListButton
                key={segment.key}
                label={actionChildLabel(segment)}
                icon={configForSegment(segment).icon}
                running={segmentIsLive(segment)}
                failed={toolSegmentFailed(segment)}
                active={selectedSegmentKey === segment.key}
                preventFocusScroll
                onClick={() => onSelectSegment(item.id, segment.key)}
              />
            ))}
          </div>
        </DropdownContent>
      ) : null}
    </div>
  );
}

function ActionWorksetRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "workset" }>;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div data-action-anchor={item.id} className="[overflow-anchor:auto]">
      <ActionListButton
        label={item.title}
        trailing={item.pending ? undefined : "Workset"}
        icon={IconName.Checklist}
        running={item.pending}
        active={active}
        onClick={() => onSelect(item.id)}
      />
    </div>
  );
}

function ActionThreadRow({
  item,
  active,
  episodeCount,
  onSelect,
}: {
  item: Extract<ActionItem, { kind: "thread" }>;
  active: boolean;
  episodeCount: number;
  onSelect: (name: string, episodeKey: string) => void;
}) {
  const pending = item.state === "pending";
  const running = item.state === "running";
  const failed = item.state === "cancelled" || item.state === "error";
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
        onClick={() => onSelect(item.name, item.episodeKey)}
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
  onSelectGroup: (id: string) => void;
  onSelectWorkset: (id: string) => void;
  onSelectThread: (name: string, episodeKey: string) => void;
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
  if (item.kind === "workset") {
    return (
      <ActionWorksetRow
        key={item.id}
        item={item}
        active={args.selectedGroupId === item.id}
        onSelect={args.onSelectWorkset}
      />
    );
  }
  return (
    <ActionThreadRow
      key={item.id}
      item={item}
      active={args.selectedThreadEpisode === item.episodeKey}
      episodeCount={args.episodeCount(item.name)}
      onSelect={args.onSelectThread}
    />
  );
}

/** Render one turn's action rows, preserving grouped thread gutters and list scroll position. */
export function ActionItemList({
  items,
  selectedGroupId,
  selectedThreadEpisode,
  episodeCount,
  onSelectGroup,
  onSelectThread,
}: {
  items: readonly ActionItem[];
  selectedGroupId: string | null;
  selectedThreadEpisode: string | null;
  episodeCount: (name: string) => number;
  onSelectGroup: (id: string) => void;
  onSelectThread: (name: string, episodeKey: string) => void;
}) {
  const expandedGroupId = useExpandedActionGroupId();
  const selectedSegmentKey = useSelectedActionSegmentKey();
  const previousSelection = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (selectedGroupId == null) {
      previousSelection.current = null;
      collapseActionGroup();
      return;
    }
    const selected = items.find((item) => item.id === selectedGroupId);
    if (!selected) {
      previousSelection.current = null;
      return;
    }
    if (selectedGroupId === previousSelection.current) return;
    previousSelection.current = selectedGroupId;
    if (selected.kind === "group" && groupIsExpandable(selected.group)) {
      expandActionGroup(selected.id);
    } else {
      collapseActionGroup();
    }
  }, [items, selectedGroupId]);

  const handleSelectGroup = (id: string) => {
    const selected = items.find((item) => item.id === id);
    if (selected?.kind === "group" && groupIsExpandable(selected.group)) {
      toggleActionGroup(id);
    } else {
      collapseActionGroup();
    }
    onSelectGroup(id);
  };

  const handleSelectWorkset = (id: string) => {
    collapseActionGroup();
    onSelectGroup(id);
  };

  const handleSelectThread = (name: string, episodeKey: string) => {
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
    onSelectGroup: handleSelectGroup,
    onSelectWorkset: handleSelectWorkset,
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
        className="flex w-full flex-col border-l border-primary py-1 pl-0.5"
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

export function ActionList({
  sections,
  filter = "all",
  kind,
  selectedGroupId,
  selectedThreadEpisode,
  episodeCount = () => 1,
  onSelectGroup,
  onSelectThread,
}: {
  sections: readonly ActionTurnSection[];
  filter?: ActionFilter;
  kind: "agent" | "orchestrator";
  selectedGroupId: string | null;
  selectedThreadEpisode: string | null;
  episodeCount?: (name: string) => number;
  onSelectGroup: (id: string) => void;
  onSelectThread: (name: string, episodeKey: string) => void;
}) {
  const visibleSections = filterActionTimeline(sections, filter);
  if (visibleSections.length === 0) return <ActionListEmpty filter={filter} kind={kind} />;
  return (
    <div className="flex w-full flex-col">
      {visibleSections.map((section) => (
        <section key={section.key} aria-label={`Turn ${section.number}`}>
          <ActionTurnHeader section={section} />
          <div className="flex flex-col py-1">
            <ActionItemList
              items={section.items}
              selectedGroupId={selectedGroupId}
              selectedThreadEpisode={selectedThreadEpisode}
              episodeCount={episodeCount}
              onSelectGroup={onSelectGroup}
              onSelectThread={onSelectThread}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
