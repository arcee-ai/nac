import { Fragment } from "react";

import {
  BoxSurface,
  ChatSessionButton,
  ChatSessionTab,
  ForkSessionItem,
  ProjectButton,
  ProjectButtonVariant,
} from "@/app/atoms";
import SessionBehaviorIcon, { SessionBehaviorIconSize } from "@/app/atoms/session-behavior-icon";
import { SAMPLE_IDS } from "@/app/components/pages/design-preview/samples";
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

function SessionBehaviorIconGrid() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(12,32px)] items-center gap-y-3">
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

export function SessionIdentitySection() {
  return (
    <BoxSurface title="Project navigation">
      <div className="p-4 flex flex-col gap-6">
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
        <div className="flex flex-col gap-1 max-w-[320px]">
          <ChatSessionButton title="Fix the parser" active />
          <ChatSessionButton title="Rewrite the store layer" />
          <ChatSessionButton title="Investigating" running />
          <ChatSessionButton title="Fork: Fix the parser" forkedFromTitle="Fix the parser" />
          <ChatSessionButton title="Fork running" forkedFromTitle="Fix the parser" running />
        </div>
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
