import { Fragment } from "react";
import { BoxSurface, IconName } from "@/app/atoms";
import ToolsAndReasoningBadge from "@/app/atoms/tools-and-reasoning-badge";

const STATES = [
  { caption: "Done", label: "Worked for 12.3s", inProgress: false, disabled: false },
  { caption: "Done, disabled", label: "Worked for 12.3s", inProgress: false, disabled: true },
  { caption: "In progress, disabled", label: "Thinking…", inProgress: true, disabled: true },
];

const LIVE_STEPS: { label: string; leadingIcon?: IconName }[] = [
  { label: "Thinking…" },
  { label: "Searching the web…" },
  { label: "Fetching arcee.ai…", leadingIcon: IconName.Globe },
  { label: "Reading index.tsx…" },
  { label: "Creating index.tsx…" },
  { label: "Editing index.tsx…" },
  { label: "Finding files…" },
  { label: "Searching files…" },
  { label: "Running npm test…" },
  { label: "Writing to terminal…" },
  { label: "Reading command output…" },
  { label: "Creating goal…" },
  { label: "Getting goal…" },
  { label: "Updating goal…" },
  { label: "Spawning agent…" },
  { label: "Spawning orchestrator…" },
  { label: "Checking session status…" },
  { label: "Steering session…" },
  { label: "Reading session…" },
  { label: "Waiting for session…" },
  { label: "Deleting session…" },
  { label: "Defining workset…" },
  { label: "Deleting thread…" },
];

const noop = () => {};

export function ToolsBadgeSection() {
  return (
    <BoxSurface title="Tools and reasoning badge">
      <div className="p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3">
        <span />
        <span className="label-micro text-basic-muted">Default</span>
        <span className="label-micro text-basic-muted">Selected</span>
        {STATES.map(({ caption, label, inProgress, disabled }) => (
          <Fragment key={caption}>
            <span className="label-small text-basic-secondary">{caption}</span>
            <ToolsAndReasoningBadge
              label={label}
              inProgress={inProgress}
              disabled={disabled}
              onClick={noop}
            />
            <ToolsAndReasoningBadge
              label={label}
              inProgress={inProgress}
              disabled={disabled}
              selected
              onClick={noop}
            />
          </Fragment>
        ))}
        {LIVE_STEPS.map(({ label, leadingIcon }, index) => (
          <Fragment key={label}>
            <span className="label-small text-basic-secondary">
              {index === 0 ? "In progress" : null}
            </span>
            <ToolsAndReasoningBadge
              label={label}
              inProgress
              leadingIcon={leadingIcon}
              onClick={noop}
            />
            <ToolsAndReasoningBadge
              label={label}
              inProgress
              leadingIcon={leadingIcon}
              selected
              onClick={noop}
            />
          </Fragment>
        ))}
      </div>
    </BoxSurface>
  );
}
