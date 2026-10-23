import { Fragment, useState, type ReactNode } from "react";
import { BoxSurface, IconName } from "@/app/atoms";
import ActionListButton, { ActionListButtonStatus } from "@/app/atoms/action-list-button";
import InsightItem, {
  InsightCodeBox,
  InsightItemState,
  InsightLinkButton,
} from "@/app/atoms/insight-item";

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

const REASONING =
  "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.";
const RUN_INPUT = "npm run typecheck";
const RUN_OUTPUT =
  "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.";
const STEER_MESSAGE =
  "Pause after the staging deploy and wait for my review before touching production.";
const SEARCH_PATTERN = "resetIndent\\(";
const SEARCH_MATCHES =
  "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7";

interface ItemSample {
  type: string;
  icon: IconName;
  title: string;
  loadingTitle: string;
  copyText: string;
  errorMessage: string;
  body: (state: InsightItemState) => ReactNode;
}

const ITEM_SAMPLES: ItemSample[] = [
  {
    type: "Reasoning",
    icon: IconName.Brain,
    title: "Thoughts, 2.3 s",
    loadingTitle: "Thinking",
    copyText: REASONING,
    errorMessage: "The model stopped before it finished reasoning.",
    body: (state) => (state === InsightItemState.Default ? <p>{REASONING}</p> : null),
  },
  {
    type: "Run Command (Error keeps the input)",
    icon: IconName.Terminal,
    title: "Run command",
    loadingTitle: "Running command",
    copyText: RUN_INPUT,
    errorMessage: "Command exited with code 2.",
    body: (state) => {
      if (state === InsightItemState.Loading) return null;
      const input = <InsightCodeBox label="Input">{RUN_INPUT}</InsightCodeBox>;
      if (state === InsightItemState.Error) return input;
      return (
        <>
          {input}
          <InsightCodeBox label="Output">{RUN_OUTPUT}</InsightCodeBox>
        </>
      );
    },
  },
  {
    type: "Steer Session (Loading keeps the link)",
    icon: IconName.AddChat,
    title: "Steer session",
    loadingTitle: "Steer session",
    copyText: STEER_MESSAGE,
    errorMessage: "The session is no longer running.",
    body: (state) => {
      if (state === InsightItemState.Error) return null;
      if (state === InsightItemState.Loading) {
        return <InsightLinkButton label="Calendar rollout" onClick={() => {}} />;
      }
      return (
        <>
          <p>{STEER_MESSAGE}</p>
          <InsightLinkButton label="Calendar rollout" href="#/design" />
        </>
      );
    },
  },
  {
    type: "Search File (unlabelled boxes)",
    icon: IconName.SearchFile,
    title: "Search files",
    loadingTitle: "Search files",
    copyText: SEARCH_PATTERN,
    errorMessage: "The pattern is not a valid regular expression.",
    body: (state) => {
      if (state === InsightItemState.Loading) return null;
      const pattern = <InsightCodeBox>{SEARCH_PATTERN}</InsightCodeBox>;
      if (state === InsightItemState.Error) return pattern;
      return (
        <>
          {pattern}
          <InsightCodeBox>{SEARCH_MATCHES}</InsightCodeBox>
        </>
      );
    },
  },
];

const ITEM_STATES = [
  { state: InsightItemState.Default, title: "Default" },
  { state: InsightItemState.Loading, title: "Loading" },
  { state: InsightItemState.Error, title: "Error" },
];

function InsightItemsPreview() {
  return (
    <div className="grid grid-cols-3 items-start gap-x-4 gap-y-2">
      {ITEM_STATES.map(({ state, title }) => (
        <span key={state} className="label-micro text-basic-muted">
          {title}
        </span>
      ))}
      {ITEM_SAMPLES.flatMap((sample) =>
        [false, true].map((active) => (
          <Fragment key={`${sample.type}-${active}`}>
            <span className="col-span-3 pt-2 label-micro text-basic-tertiary">
              {active ? `${sample.type}, active` : sample.type}
            </span>
            {ITEM_STATES.map(({ state }) => (
              <div key={state} className="min-w-0 rounded-[4px] border border-muted">
                <InsightItem
                  id={`preview-${sample.icon}-${state}-${active}`}
                  icon={sample.icon}
                  title={state === InsightItemState.Loading ? sample.loadingTitle : sample.title}
                  state={state}
                  active={active}
                  copyText={sample.copyText}
                  errorMessage={sample.errorMessage}
                >
                  {sample.body(state)}
                </InsightItem>
              </div>
            ))}
          </Fragment>
        )),
      )}
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
        <InsightItemsPreview />
      </div>
    </BoxSurface>
  );
}
