import type React from "react";
import { Fragment } from "react";

import {
  BoxSurface,
  ChatSessionButton,
  ChatSessionTab,
  ForkSessionItem,
  ProjectButton,
  ProjectButtonVariant,
  SessionBehaviorIcon,
  SessionBehaviorIconSize,
} from "@/app/atoms";
import { SAMPLE_IDS } from "@/app/components/pages/design-preview/samples";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { cn } from "@/app/lib/cn";
import { SESSION_BEHAVIORS } from "@/app/lib/sessionBehavior";

const ICON_SIZES = [
  SessionBehaviorIconSize.Small,
  SessionBehaviorIconSize.Medium,
  SessionBehaviorIconSize.Large,
];

/** Figma's `color` axis: the fill tokens a parent sets on the glyph's paths. */
const ICON_TONES = [
  { label: "Default", className: "[&_path]:fill-btn-secondary" },
  { label: "Hovered", className: "[&_path]:fill-btn-secondary-hovered" },
  { label: "Pressed", className: "[&_path]:fill-btn-secondary-pressed" },
  { label: "Disabled", className: "[&_path]:fill-btn-secondary-disabled" },
];

type ChatSessionButtonSample = Partial<React.ComponentProps<typeof ChatSessionButton>>;

const BUTTON_COLUMNS: { label: string; sample: ChatSessionButtonSample }[] = [
  { label: "Default", sample: {} },
  { label: "Active", sample: { active: true } },
  { label: "Running", sample: { running: true } },
  { label: "Active, running", sample: { active: true, running: true } },
];

const BUTTON_ROWS: { label: string; sample: ChatSessionButtonSample }[] = [
  { label: "Direct agent", sample: { behavior: "direct" } },
  { label: "Direct + NAC", sample: { behavior: "direct-with-orchestrator" } },
  { label: "Orchestrator", sample: { behavior: "orchestrator" } },
  { label: "Fork", sample: { behavior: "direct", forkedFromTitle: "Chat session 0" } },
  { label: "Unread", sample: { behavior: "direct", unread: true } },
  { label: "Without NAC", sample: { behavior: "direct", showBehaviorIcon: false } },
  { label: "Disabled", sample: { behavior: "direct", disabled: true } },
];

const noop = () => {};

function SessionBehaviorIconGrid() {
  return (
    <div className="grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3">
      <span />
      {ICON_TONES.map((tone) => (
        <span key={tone.label} className="col-span-3 label-micro text-basic-muted">
          {tone.label}
        </span>
      ))}
      {SESSION_BEHAVIORS.map((option) => (
        <Fragment key={option.id}>
          <span className="label-small truncate text-basic-secondary">{option.label}</span>
          {ICON_TONES.flatMap((tone) =>
            ICON_SIZES.map((size) => (
              <span
                key={`${tone.label}-${size}`}
                className={cn("flex items-center justify-center", tone.className)}
              >
                <SessionBehaviorIcon behavior={option.id} size={size} />
              </span>
            )),
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Hover, press and keyboard focus are live: point at or Tab through a row. */
function ChatSessionButtonMatrix({ isMobile }: { isMobile: boolean }) {
  const actions = (
    <ChatSessionActions
      title="Chat session 1"
      isMobile={isMobile}
      onPin={noop}
      onRename={noop}
      onDelete={noop}
    />
  );
  return (
    <div
      className={cn(
        "grid w-fit items-center gap-x-4 gap-y-2",
        isMobile ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]",
      )}
    >
      <span className="label-micro text-basic-muted">{isMobile ? "Mobile" : "Desktop"}</span>
      {BUTTON_COLUMNS.map((column) => (
        <span key={column.label} className="label-micro text-basic-muted">
          {column.label}
        </span>
      ))}
      {BUTTON_ROWS.map((row) => (
        <Fragment key={row.label}>
          <span className="label-small text-basic-secondary">{row.label}</span>
          {BUTTON_COLUMNS.map((column) => (
            <ChatSessionButton
              key={column.label}
              title="Chat session 1"
              showBehaviorIcon
              isMobile={isMobile}
              actions={actions}
              {...row.sample}
              {...column.sample}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

export function SessionIdentitySection() {
  return (
    <BoxSurface title="Project navigation">
      <div className="p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0">
        <SessionBehaviorIconGrid />
        <div className="flex items-start gap-2">
          <ChatSessionTab title="Fix the parser" behavior="direct" showBehaviorIcon active />
          <ChatSessionTab
            title="Rewrite the store layer"
            behavior="direct-with-orchestrator"
            showBehaviorIcon
          />
          <ChatSessionTab title="Investigating" behavior="orchestrator" showBehaviorIcon running />
          <ChatSessionTab title="Without NAC" behavior="direct" />
          <ChatSessionTab title="Fork: Fix the parser" forkedFromTitle="Fix the parser" />
          <ChatSessionTab title="Fork running" forkedFromTitle="Fix the parser" running />
        </div>
        <ChatSessionButtonMatrix isMobile={false} />
        <ChatSessionButtonMatrix isMobile />
        <div className="flex flex-col gap-2 max-w-[320px]">
          <ForkSessionItem sessionId="14231vsd7897-aaaa" title="Fork: Session title" />
          <ForkSessionItem sessionId="14231vsd7897-aaaa" title="Fork: Session title" deleted />
        </div>
        <div className="flex flex-col gap-1 max-w-[320px]">
          <ProjectButton entityId={SAMPLE_IDS[3]} name="arcee-ai/nac" trailing="4" active />
          <ProjectButton entityId={SAMPLE_IDS[4]} name="arcee-ai/telos" trailing="1" running />
          <ProjectButton
            entityId={SAMPLE_IDS[5]}
            name="Unassigned session"
            variant={ProjectButtonVariant.Orphan}
          />
        </div>
      </div>
    </BoxSurface>
  );
}
