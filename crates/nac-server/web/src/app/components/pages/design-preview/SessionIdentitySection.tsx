import type React from "react";
import { Fragment } from "react";

import {
  BoxSurface,
  ChatSessionButton,
  ChatSessionTab,
  ForkSessionItem,
  ProjectButton,
  ProjectButtonVariant,
} from "@/app/atoms";
import { SAMPLE_IDS } from "@/app/components/pages/design-preview/samples";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { cn } from "@/app/lib/cn";

type ChatSessionButtonSample = Partial<React.ComponentProps<typeof ChatSessionButton>>;

const BUTTON_COLUMNS: { label: string; sample: ChatSessionButtonSample }[] = [
  { label: "Default", sample: {} },
  { label: "Active", sample: { active: true } },
  { label: "Running", sample: { running: true } },
  { label: "Active, running", sample: { active: true, running: true } },
];

const BUTTON_ROWS: { label: string; sample: ChatSessionButtonSample }[] = [
  { label: "Direct agent", sample: { behavior: "direct" } },
  { label: "Fork", sample: { behavior: "direct", forkedFromTitle: "Chat session 0" } },
  { label: "Unread", sample: { behavior: "direct", unread: true } },
  { label: "Disabled", sample: { behavior: "direct", disabled: true } },
];

const noop = () => {};

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
      <span className="type-meta-strong text-basic-muted">{isMobile ? "Mobile" : "Desktop"}</span>
      {BUTTON_COLUMNS.map((column) => (
        <span key={column.label} className="type-meta-strong text-basic-muted">
          {column.label}
        </span>
      ))}
      {BUTTON_ROWS.map((row) => (
        <Fragment key={row.label}>
          <span className="type-body-chrome text-basic-secondary">{row.label}</span>
          {BUTTON_COLUMNS.map((column) => (
            <ChatSessionButton
              key={column.label}
              title="Chat session 1"
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
    <BoxSurface title="Project navigation" bodyClassName="overflow-x-auto">
      <div className="p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0">
        <div className="flex items-start gap-2">
          <ChatSessionTab title="Fix the parser" behavior="direct" active />
          <ChatSessionTab title="Investigating" behavior="direct" running />
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
