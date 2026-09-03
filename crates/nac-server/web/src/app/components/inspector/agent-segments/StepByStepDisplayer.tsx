import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ToolCallLabel } from "@/app/components/inspector/agent-segments/ToolCallLabel";
import {
  ToolCallLabelState,
  configForSegment,
  segmentIsLive,
  type AgentSegment,
  type AgentToolsGroup,
  type SegmentDisplayConfig,
} from "@/app/lib/agentSegments";

export interface StepByStepStep {
  key: string;
  config: SegmentDisplayConfig;
  state: ToolCallLabelState;
  durationMs?: number | null;
  activeText?: string;
}

interface StepByStepDisplayerProps {
  steps: StepByStepStep[];
  /** Finished overlay fades out in place. The pills row does not move. */
  faded?: boolean;
  className?: string;
}

/** Visible window for the live stack. Content scrolls inside; the box does not grow. */
export const STEP_VIEWPORT_PX = 80;
export const STEP_FADE_MS = 300;

const SENTENCE_TAIL_SCAN_CHARS = 400;
const MIN_SENTENCE_CHARS = 15;

function stripInlineMarkdown(text: string): string {
  let value = text;
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  value = value.replace(/\*\*([^*]+?)\*\*/g, "$1");
  value = value.replace(/__([^_]+?)__/g, "$1");
  value = value.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1$2");
  value = value.replace(/~~([^~]+?)~~/g, "$1");
  value = value.replace(/`+([^`]+?)`+/g, "$1");
  value = value.replace(/^\s*#{1,6}\s+/, "");
  value = value.replace(/^\s*>\s+/, "");
  value = value.replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1");
  return value.replace(/\s+/g, " ").trim();
}

function lastCompleteSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const tail =
    text.length > SENTENCE_TAIL_SCAN_CHARS
      ? text.slice(text.length - SENTENCE_TAIL_SCAN_CHARS)
      : text;
  const trimmed = tail.trim();
  if (!trimmed) return undefined;

  const boundaryRegex = /[.!?](?=\s|$)/g;
  const boundaryEnds: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = boundaryRegex.exec(trimmed)) !== null) {
    boundaryEnds.push(match.index + 1);
  }
  if (boundaryEnds.length === 0) return undefined;

  const lastBoundaryEnd = boundaryEnds[boundaryEnds.length - 1];
  const startCandidates: number[] = [];
  for (let index = boundaryEnds.length - 2; index >= 0; index -= 1) {
    startCandidates.push(boundaryEnds[index]);
  }
  startCandidates.push(0);

  let chosen = "";
  for (const startIndex of startCandidates) {
    const slice = trimmed.slice(startIndex, lastBoundaryEnd).trim();
    if (!slice) continue;
    const cleaned = stripInlineMarkdown(slice);
    chosen = cleaned;
    if (cleaned.length >= MIN_SENTENCE_CHARS) break;
  }
  return chosen || undefined;
}

function stepFromSegment(segment: AgentSegment, active: boolean): StepByStepStep {
  return {
    key: segment.key,
    config: configForSegment(segment),
    state: active ? ToolCallLabelState.Active : ToolCallLabelState.Default,
    durationMs: segment.kind === "thinking" ? segment.durationMs : null,
    activeText:
      active && segment.kind === "thinking" ? lastCompleteSentence(segment.text) : undefined,
  };
}

export function buildStepperSteps(group: AgentToolsGroup): StepByStepStep[] {
  const lastIndex = group.segments.length - 1;
  return group.segments.map((segment, index) => {
    const live = segmentIsLive(segment);
    const active = live || (group.inProgress && index === lastIndex);
    return stepFromSegment(segment, active);
  });
}

export function areStepByStepStepListsContentEqual(
  previous: ReadonlyArray<StepByStepStep>,
  next: ReadonlyArray<StepByStepStep>,
): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) {
    const a = previous[index];
    const b = next[index];
    if (
      a.key !== b.key ||
      a.state !== b.state ||
      a.durationMs !== b.durationMs ||
      a.activeText !== b.activeText
    ) {
      return false;
    }
    if (
      a.config.id !== b.config.id ||
      a.config.icon !== b.config.icon ||
      a.config.regularLabel !== b.config.regularLabel ||
      a.config.inProgressLabel !== b.config.inProgressLabel
    ) {
      return false;
    }
  }
  return true;
}

function stepByStepDisplayerPropsAreEqual(
  prev: Readonly<StepByStepDisplayerProps>,
  next: Readonly<StepByStepDisplayerProps>,
): boolean {
  if (prev.className !== next.className) return false;
  if (prev.faded !== next.faded) return false;
  return areStepByStepStepListsContentEqual(prev.steps, next.steps);
}

const OPACITY_FROM_END: readonly string[] = ["opacity-100", "opacity-50", "opacity-15"];

const StepByStepRows = memo(
  function StepByStepRows({ steps }: { steps: StepByStepStep[] }) {
    return (
      <>
        {steps.map((step, index) => {
          const fromEnd = steps.length - 1 - index;
          const opacityClass = OPACITY_FROM_END[fromEnd] ?? "opacity-0";
          return (
            <ToolCallLabel
              key={step.key}
              config={step.config}
              state={step.state}
              durationMs={step.durationMs}
              activeText={step.activeText}
              className={`${opacityClass} transition-opacity duration-300 ease-out`}
            />
          );
        })}
      </>
    );
  },
  (prev, next) => areStepByStepStepListsContentEqual(prev.steps, next.steps),
);

function measureOverflow(outer: HTMLElement, inner: HTMLElement): number {
  const styles = getComputedStyle(outer);
  const padTop = parseFloat(styles.paddingTop) || 0;
  const padBottom = parseFloat(styles.paddingBottom) || 0;
  const available = outer.clientHeight - padTop - padBottom;
  return Math.max(0, inner.offsetHeight - available);
}

function StepByStepDisplayer({ steps, faded = false, className = "" }: StepByStepDisplayerProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pinned = useRef(false);
  const [translateY, setTranslateY] = useState(0);
  const [allowMotion, setAllowMotion] = useState(false);

  const pinToBottom = (animate: boolean): void => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const next = -measureOverflow(outer, inner);
    if (!animate) {
      setTranslateY(next);
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const liveOuter = outerRef.current;
      const liveInner = innerRef.current;
      if (!liveOuter || !liveInner) return;
      setTranslateY(-measureOverflow(liveOuter, liveInner));
    });
  };

  useLayoutEffect(() => {
    if (pinned.current) return;
    pinToBottom(false);
    pinned.current = true;
  }, [steps.length]);

  useEffect(() => {
    if (!pinned.current) return undefined;
    setAllowMotion(true);
    pinToBottom(true);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [steps]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (!pinned.current) {
        pinToBottom(false);
        pinned.current = true;
        return;
      }
      pinToBottom(true);
    });
    if (innerRef.current) observer.observe(innerRef.current);
    if (outerRef.current) observer.observe(outerRef.current);
    return () => observer.disconnect();
  }, []);

  if (steps.length === 0) return null;

  return (
    <div
      ref={outerRef}
      className={`flex flex-col gap-1 overflow-hidden pt-4 ${className}`}
      style={{ height: STEP_VIEWPORT_PX }}
    >
      <div
        ref={innerRef}
        className={`flex shrink-0 flex-col gap-1.5 ${faded ? "pointer-events-none opacity-0" : "opacity-100"}`}
        style={{
          transform: `translateY(${translateY}px)`,
          transition: allowMotion
            ? `transform ${STEP_FADE_MS}ms ease-out, opacity ${STEP_FADE_MS}ms ease-out`
            : `opacity ${STEP_FADE_MS}ms ease-out`,
        }}
        aria-hidden={faded || undefined}
      >
        <StepByStepRows steps={steps} />
      </div>
    </div>
  );
}

export default memo(StepByStepDisplayer, stepByStepDisplayerPropsAreEqual);
