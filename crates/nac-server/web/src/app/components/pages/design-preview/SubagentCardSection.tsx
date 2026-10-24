import type React from "react";
import { Fragment } from "react";

import { BoxSurface } from "@/app/atoms";
import SubagentTranscriptCard, { SubagentCardStatus } from "@/app/atoms/subagent-transcript-card";

type CardSample = Omit<React.ComponentProps<typeof SubagentTranscriptCard>, "showBehaviorIcon">;

const noop = () => {};

/** The current route, so following a sample link leaves the preview in place. */
const SAMPLE_HREF = "#/design";

const INTERACTIVE = { onOpen: noop, sessionHref: SAMPLE_HREF };

const CARD_ROWS: { label: string; card: CardSample }[] = [
  {
    label: "Ready · direct agent",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Ready,
      behavior: "direct",
      ...INTERACTIVE,
    },
  },
  {
    label: "Ready · direct + NAC",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Ready,
      behavior: "direct-with-orchestrator",
      ...INTERACTIVE,
    },
  },
  {
    label: "Ready · managed orchestrator",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Ready,
      lineage: "managed-orchestrator",
      ...INTERACTIVE,
    },
  },
  {
    label: "Running",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Running,
      behavior: "direct",
      ...INTERACTIVE,
    },
  },
  {
    label: "Failed",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Failed,
      statusLabel: "Failed",
      behavior: "direct",
      ...INTERACTIVE,
    },
  },
  {
    label: "Failed · cancelled",
    card: {
      title: "Child session title",
      status: SubagentCardStatus.Failed,
      statusLabel: "Cancelled",
      behavior: "direct",
      ...INTERACTIVE,
    },
  },
  {
    label: "Not found",
    card: { title: "Child session title", status: SubagentCardStatus.NotFound, ...INTERACTIVE },
  },
  {
    label: "Static",
    card: { title: "Child session title", status: SubagentCardStatus.Ready, behavior: "direct" },
  },
];

const ICON_COLUMNS = [
  { label: "NAC on", showBehaviorIcon: true },
  { label: "NAC off", showBehaviorIcon: false },
];

const LONG_TITLE = "Investigate the flaky parser tests in the store layer";

/** Hover, press and keyboard focus are live: point at, press or Tab through a card. */
export function SubagentCardSection() {
  return (
    <BoxSurface title="Subagent transcript card">
      <div className="p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0">
        <div className="grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3">
          <span />
          {ICON_COLUMNS.map((column) => (
            <span key={column.label} className="label-micro text-basic-muted">
              {column.label}
            </span>
          ))}
          {CARD_ROWS.map((row) => (
            <Fragment key={row.label}>
              <span className="label-small text-basic-secondary">{row.label}</span>
              {ICON_COLUMNS.map((column) => (
                <SubagentTranscriptCard
                  key={column.label}
                  showBehaviorIcon={column.showBehaviorIcon}
                  {...row.card}
                />
              ))}
            </Fragment>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="label-micro text-basic-muted">Narrow container · 240px</span>
          <div className="flex w-[240px] flex-col gap-3">
            <SubagentTranscriptCard
              title={LONG_TITLE}
              status={SubagentCardStatus.Ready}
              behavior="direct"
              showBehaviorIcon
              {...INTERACTIVE}
            />
            <SubagentTranscriptCard
              title={LONG_TITLE}
              status={SubagentCardStatus.Failed}
              statusLabel="Cancelled"
              behavior="direct"
              showBehaviorIcon
              {...INTERACTIVE}
            />
          </div>
        </div>
      </div>
    </BoxSurface>
  );
}
