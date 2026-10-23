import { Fragment, useState } from "react";
import { BoxSurface, IconName } from "@/app/atoms";
import ActionListButton, { ActionListButtonStatus } from "@/app/atoms/action-list-button";

interface ActionSample {
  type: string;
  icon: IconName;
  label: string;
  meta?: string;
  failedLabel?: string;
  runningLabel?: string;
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
    icon: IconName.MenuHorizontal,
    label: "Thoughts, Edit File and more",
    meta: "12",
    runningLabel: "Thoughts, Edit File and more…",
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

const GROUP_CHILDREN = [
  { key: "thoughts", icon: IconName.Brain, label: "Thoughts", meta: "13.8 s" },
  { key: "read", icon: IconName.ReadFile, label: "index.tsx", meta: "Read" },
  { key: "write", icon: IconName.FileUpload, label: "index.tsx", meta: "Write" },
];

function sampleLabel(sample: ActionSample, status: ActionListButtonStatus): string {
  if (status === ActionListButtonStatus.Running) return sample.runningLabel ?? sample.label;
  if (status === ActionListButtonStatus.Failed) return sample.failedLabel ?? sample.label;
  return sample.label;
}

function ActionStatesGrid() {
  const selectedSample = ACTION_SAMPLES.find((sample) => sample.type === "Read File");

  return (
    <div className="grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-0.5">
      <span className="label-micro text-basic-muted">Type</span>
      {STATUS_COLUMNS.map(({ status, title }) => (
        <span key={status} className="px-2 label-micro text-basic-muted">
          {title}
        </span>
      ))}
      {ACTION_SAMPLES.map((sample) => (
        <Fragment key={sample.type}>
          <span className="truncate label-micro text-basic-tertiary">{sample.type}</span>
          {STATUS_COLUMNS.map(({ status }) => (
            <ActionListButton
              key={status}
              icon={sample.icon}
              label={sampleLabel(sample, status)}
              meta={sample.meta}
              status={status}
              prominent={sample.type === "Thread"}
            />
          ))}
        </Fragment>
      ))}
      {selectedSample ? (
        <>
          <span className="truncate label-micro text-basic-tertiary">Read File, selected</span>
          {STATUS_COLUMNS.map(({ status }) => (
            <ActionListButton
              key={status}
              icon={selectedSample.icon}
              label={sampleLabel(selectedSample, status)}
              meta={selectedSample.meta}
              status={status}
              selected
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function ExpandedGroupPreview() {
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState("thoughts");

  return (
    <div className="flex w-[252px] flex-col gap-0.5">
      <ActionListButton
        icon={IconName.Brain}
        label="Thoughts"
        meta="2.1 s"
        selected={selected === "first"}
        onClick={() => setSelected("first")}
      />
      <ActionListButton
        icon={IconName.MenuHorizontal}
        label="Thoughts, Read File and more"
        meta={String(GROUP_CHILDREN.length)}
        expanded={expanded}
        selected={selected === "group"}
        onClick={() => {
          setExpanded((open) => !open);
          setSelected("group");
        }}
      />
      {expanded
        ? GROUP_CHILDREN.map((child) => (
            <ActionListButton
              key={child.key}
              depth={1}
              icon={child.icon}
              label={child.label}
              meta={child.meta}
              selected={selected === child.key}
              onClick={() => setSelected(child.key)}
            />
          ))
        : null}
      <ActionListButton
        icon={IconName.Chat}
        label="impl/calendar"
        meta="Thread, 3"
        prominent
        selected={selected === "thread"}
        onClick={() => setSelected("thread")}
      />
      <ActionListButton
        icon={IconName.Plane}
        label="Calendar sync agent"
        meta="Spawn"
        onClick={() => {}}
      />
    </div>
  );
}

function LongLabelsPreview() {
  return (
    <div className="flex w-[252px] flex-col gap-0.5">
      <ActionListButton
        icon={IconName.Chat}
        label="impl/calendar-sync-recurring-events-and-time-zones"
        meta="Thread, 12"
        prominent
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
          <ExpandedGroupPreview />
          <LongLabelsPreview />
        </div>
      </div>
    </BoxSurface>
  );
}
