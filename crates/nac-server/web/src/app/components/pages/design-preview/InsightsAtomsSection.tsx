import { Fragment, useState } from "react";
import {
  ActionListButton,
  ActionListButtonStatus,
  ActionListSegment,
  BoxSurface,
  IconName,
} from "@/app/atoms";
import { InsightItemsPreview } from "@/app/components/pages/design-preview/InsightItemsPreview";

interface ActionSample {
  type: string;
  icon: IconName;
  label: string;
  meta?: string;
  failedLabel?: string;
  runningLabel?: string;
  /** A group row, which shows the disclosure chevron. */
  group?: boolean;
}

const ACTION_SAMPLES: ActionSample[] = [
  { type: "Thread", icon: IconName.Chat, label: "impl/calendar", meta: "Thread, 3" },
  {
    type: "Thoughts",
    icon: IconName.Brain,
    label: "Thoughts",
    meta: "13.8 s",
    runningLabel: "Thinking…",
  },
  {
    type: "Define Workset",
    icon: IconName.Checklist,
    label: "calendar-sync",
    meta: "Workset",
    failedLabel: "Define Workset",
    runningLabel: "Defining Workset…",
  },
  {
    type: "Delete Workset",
    icon: IconName.Trash,
    label: "Deleted: impl/calendar",
    failedLabel: "Delete thread",
    runningLabel: "Deleting…",
  },
  {
    type: "Read File",
    icon: IconName.ReadFile,
    label: "index.tsx",
    meta: "Read",
    failedLabel: "Read File",
    runningLabel: "Reading File…",
  },
  {
    type: "Write File",
    icon: IconName.FileUpload,
    label: "index.tsx",
    meta: "Write",
    failedLabel: "Create File",
    runningLabel: "Creating File…",
  },
  {
    type: "Edit File",
    icon: IconName.Edit,
    label: "index.tsx",
    meta: "Edit",
    failedLabel: "Edit File",
    runningLabel: "Editing File…",
  },
  {
    type: "Glob",
    icon: IconName.SearchFiles,
    label: "Find files",
    meta: "Glob",
    runningLabel: "Find files…",
  },
  {
    type: "Grep",
    icon: IconName.SearchFile,
    label: "Search files",
    meta: "Grep",
    runningLabel: "Search files…",
  },
  {
    type: "Run Terminal",
    icon: IconName.Terminal,
    label: "Run command",
    meta: "Exec",
    runningLabel: "Running command…",
  },
  {
    type: "Use Terminal",
    icon: IconName.WriteCommand,
    label: "Write command",
    meta: "Write",
    runningLabel: "Write command…",
  },
  {
    type: "Read Output Command",
    icon: IconName.ScreenView,
    label: "Read Output Command",
    meta: "Read",
    runningLabel: "Read Output Command…",
  },
  {
    type: "Create goal",
    icon: IconName.Flag,
    label: "Create goal",
    meta: "Create",
    runningLabel: "Creating goal…",
  },
  {
    type: "Read goal",
    icon: IconName.Important,
    label: "Get goal",
    meta: "Read",
    runningLabel: "Get goal…",
  },
  {
    type: "Update goal",
    icon: IconName.Checklist,
    label: "Update goal",
    meta: "Edit",
    runningLabel: "Updating goal…",
  },
  {
    type: "Spawn Session - Agent",
    icon: IconName.Plane,
    label: "Calendar sync agent",
    meta: "Spawn",
    failedLabel: "Spawn Agent",
    runningLabel: "Spawn Agent…",
  },
  {
    type: "Spawn Session - Orchestrator",
    icon: IconName.Orchestrator,
    label: "Calendar rollout",
    meta: "Spawn",
    failedLabel: "Spawn Orchestrator",
    runningLabel: "Spawn Orchestrator…",
  },
  {
    type: "Check session status",
    icon: IconName.Info,
    label: "Calendar sync agent",
    meta: "Check",
    failedLabel: "Check session status",
    runningLabel: "Checking session status…",
  },
  {
    type: "Steer Session",
    icon: IconName.AddChat,
    label: "Calendar rollout",
    meta: "Steer",
    failedLabel: "Steer session",
    runningLabel: "Steer session…",
  },
  {
    type: "Session Read",
    icon: IconName.Eye,
    label: "Calendar rollout",
    meta: "Read",
    failedLabel: "Read session",
    runningLabel: "Reading session…",
  },
  {
    type: "Session Wait",
    icon: IconName.Timelaps,
    label: "Calendar rollout",
    meta: "Wait",
    failedLabel: "Wait for session",
    runningLabel: "Wait for session…",
  },
  {
    type: "Cancel session",
    icon: IconName.Trash,
    label: "Calendar sync agent",
    meta: "Delete",
    failedLabel: "Delete session",
    runningLabel: "Deleting session…",
  },
  {
    type: "ToolsSegment",
    icon: IconName.Right,
    label: "Worked for 13.3s",
    meta: "12",
    runningLabel: "Working…",
    group: true,
  },
  {
    type: "Web search",
    icon: IconName.Search,
    label: "tokio select timeout",
    meta: "Search",
    runningLabel: "Searching the web…",
  },
  {
    type: "Web fetch",
    icon: IconName.Globe,
    label: "docs.rs",
    meta: "Fetch",
    runningLabel: "Fetching docs.rs…",
  },
  {
    type: "Other tool",
    icon: IconName.Code,
    label: "MCP · list_issues",
    meta: "Tool",
    runningLabel: "Running list_issues…",
  },
];

const STATUS_COLUMNS = [
  { status: ActionListButtonStatus.Ready, title: "Ready" },
  { status: ActionListButtonStatus.Pending, title: "Pending" },
  { status: ActionListButtonStatus.Running, title: "Running" },
  { status: ActionListButtonStatus.Failed, title: "Failed or canceled" },
];

/** Repeated as active rows; an active group row is also the expanded one. */
const ACTIVE_TYPES = ["Thread", "Read File", "ToolsSegment"];

const GROUP_CHILDREN = [
  { key: "thoughts", icon: IconName.Brain, label: "Thoughts", meta: "13.8 s" },
  { key: "read", icon: IconName.ReadFile, label: "index.tsx", meta: "Read" },
  { key: "write", icon: IconName.FileUpload, label: "index.tsx", meta: "Write" },
];

const WAVE_THREADS = ["impl/calendar", "impl/recurring-events", "review/calendar", "docs/calendar"];

/** A side panel list column: 252px rows on the panel ground. */
const LIST_COLUMN = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2";

function sampleLabel(sample: ActionSample, status: ActionListButtonStatus): string {
  if (status === ActionListButtonStatus.Running) return sample.runningLabel ?? sample.label;
  if (status === ActionListButtonStatus.Failed) return sample.failedLabel ?? sample.label;
  return sample.label;
}

function ActionStatesGrid() {
  const rows = [
    ...ACTION_SAMPLES.map((sample) => ({ sample, active: false })),
    ...ACTION_SAMPLES.filter((sample) => ACTIVE_TYPES.includes(sample.type)).map((sample) => ({
      sample,
      active: true,
    })),
  ];

  return (
    <div className="grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1">
      <span className="label-micro text-basic-muted">Type</span>
      {STATUS_COLUMNS.map(({ status, title }) => (
        <span key={status} className="px-2 label-micro text-basic-muted">
          {title}
        </span>
      ))}
      {rows.map(({ sample, active }) => (
        <Fragment key={`${sample.type}-${active}`}>
          <span className="truncate label-micro text-basic-tertiary">
            {active ? `${sample.type}, active` : sample.type}
          </span>
          {STATUS_COLUMNS.map(({ status }) => (
            <ActionListButton
              key={status}
              icon={sample.icon}
              label={sampleLabel(sample, status)}
              meta={sample.meta}
              status={status}
              selected={active || undefined}
              expanded={sample.group ? active : undefined}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** The agent list: an expanded group whose children share one segment line. */
function GroupSegmentPreview() {
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState("thoughts");
  const groupShown = selected === "group" || GROUP_CHILDREN.some(({ key }) => key === selected);

  return (
    <div className={LIST_COLUMN}>
      <ActionListButton
        icon={IconName.Right}
        label="Worked for 13.3s"
        meta={String(GROUP_CHILDREN.length)}
        expanded={expanded}
        selected={groupShown}
        onClick={() => {
          setExpanded((open) => !open);
          setSelected("group");
        }}
      />
      {expanded ? (
        <ActionListSegment>
          {GROUP_CHILDREN.map((child) => (
            <ActionListButton
              key={child.key}
              icon={child.icon}
              label={child.label}
              meta={child.meta}
              selected={selected === child.key}
              onClick={() => setSelected(child.key)}
            />
          ))}
        </ActionListSegment>
      ) : null}
      <ActionListButton
        icon={IconName.Eye}
        label="Calendar rollout"
        meta="Read"
        onClick={() => {}}
      />
      <ActionListButton icon={IconName.Right} label="Worked for 4.1s" meta="5" expanded={false} />
      <ActionListButton
        icon={IconName.Orchestrator}
        label="Calendar rollout"
        meta="Spawn"
        onClick={() => {}}
      />
      <ActionListButton
        icon={IconName.Brain}
        label="Thoughts"
        meta="2.1 s"
        selected={selected === "last"}
        onClick={() => setSelected("last")}
      />
    </div>
  );
}

/** The orchestrator list: each wave of threads shares one segment line. */
function ThreadWavePreview() {
  const [selected, setSelected] = useState(WAVE_THREADS[0]);
  const thread = (name: string) => (
    <ActionListButton
      key={name}
      icon={IconName.Chat}
      label={name}
      meta="Thread, 3"
      selected={selected === name}
      onClick={() => setSelected(name)}
    />
  );

  return (
    <div className={LIST_COLUMN}>
      <ActionListButton icon={IconName.Brain} label="Thoughts" meta="13.8 s" />
      <ActionListSegment>{WAVE_THREADS.map(thread)}</ActionListSegment>
      <ActionListButton icon={IconName.Right} label="Worked for 13.3s" meta="12" expanded={false} />
      <ActionListSegment>{thread("impl/time-zones")}</ActionListSegment>
      <ActionListButton icon={IconName.Brain} label="Thoughts" meta="2.1 s" />
    </div>
  );
}

function LongLabelsPreview() {
  return (
    <div className={LIST_COLUMN}>
      <ActionListButton
        icon={IconName.Chat}
        label="impl/calendar-sync-recurring-events-and-time-zones"
        meta="Thread, 12"
      />
      <ActionListButton
        icon={IconName.Orchestrator}
        label="Roll the recurring-events fix out to every calendar provider"
        meta="Spawn"
      />
      <ActionListButton
        icon={IconName.Plane}
        label="Investigate why the nightly export drops recurring events"
        meta="Spawn"
        status={ActionListButtonStatus.Pending}
        selected
      />
    </div>
  );
}

export function InsightsAtomsSection() {
  return (
    <BoxSurface title="Insights">
      <div className="p-4 flex flex-col gap-6">
        <ActionStatesGrid />
        <div className="flex flex-wrap items-start gap-6">
          <GroupSegmentPreview />
          <ThreadWavePreview />
          <LongLabelsPreview />
        </div>
        <InsightItemsPreview />
      </div>
    </BoxSurface>
  );
}
