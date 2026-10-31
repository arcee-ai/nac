import { useId, useLayoutEffect, useRef, useState } from "react";

import { ButtonSize, ButtonVariant, CopyButton, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import {
  withDuration,
  type ReasoningSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { ReasoningText } from "@/app/features/insights/presentation/items/ItemParts";

/** One disclosure per real reasoning segment; timing remains transcript-owned. */
export function ReasoningItem({ segment, active }: { segment: ReasoningSegment; active: boolean }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const choice = useRef<boolean | undefined>(undefined);
  const [open, setOpen] = useState(segment.streaming);

  useLayoutEffect(() => {
    if (choice.current !== undefined) return;
    const element = root.current;
    const selection = element?.ownerDocument.getSelection();
    const reading =
      element &&
      (element.contains(element.ownerDocument.activeElement) ||
        (selection &&
          !selection.isCollapsed &&
          (element.contains(selection.anchorNode) || element.contains(selection.focusNode))));
    // Never remove a reader's focused link or selected text on settlement.
    if (!reading) setOpen(segment.streaming);
  }, [segment.streaming]);

  if (!segment.text.trim()) return null;
  const title = segment.streaming ? "Thinking…" : withDuration("Reasoning", segment.durationMs);
  return (
    <div
      ref={root}
      role="group"
      aria-labelledby={`${id}-label`}
      aria-current={active || undefined}
      className="min-w-0 px-4 py-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          id={`${id}-label`}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[4px] text-left text-small text-basic-secondary hover:text-basic-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]"
          onClick={() => {
            choice.current = !open;
            setOpen(!open);
          }}
        >
          <span className="min-w-0 break-words">{title}</span>
          <Icon
            iconName={open ? IconName.Down : IconName.Right}
            size={16}
            aria-hidden
            className="shrink-0"
          />
        </button>
        {!segment.streaming ? (
          <CopyButton
            value={segment.text}
            title={`Copy ${title}`}
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            iconSize={16}
            className="!size-11 !min-h-11 shrink-0"
          />
        ) : null}
      </div>
      <div
        id={`${id}-body`}
        hidden={!open}
        className={cn("min-w-0 border-l border-tertiary pl-4 py-2", !open && "hidden")}
      >
        <ReasoningText text={segment.text} streaming={segment.streaming} />
      </div>
    </div>
  );
}
