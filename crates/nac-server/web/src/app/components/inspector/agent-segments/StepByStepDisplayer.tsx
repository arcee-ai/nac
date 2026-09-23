import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ToolCallLabel } from "@/app/components/inspector/agent-segments/ToolCallLabel";
import {
  buildStepperSteps,
  type StepByStepStep,
} from "@/app/components/inspector/agent-segments/stepper";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";

export const STEP_VIEWPORT_PX = 80;
export const STEP_FADE_MS = 300;

const OPACITY_FROM_END = ["opacity-100", "opacity-50", "opacity-20"] as const;

function StepRows({ steps }: { steps: StepByStepStep[] }) {
  return (
    <>
      {steps.map((step, index) => {
        const fromEnd = steps.length - 1 - index;
        return (
          <ToolCallLabel
            key={step.key}
            label={step.label}
            statusLabel={step.statusLabel}
            active={step.active}
            failed={step.failed}
            className={`${OPACITY_FROM_END[fromEnd] ?? "opacity-0"} transition-opacity duration-300 ease-out`}
          />
        );
      })}
    </>
  );
}

function StepByStepDisplayer({
  group,
  faded = false,
  className = "",
}: {
  group: AgentToolsGroup;
  faded?: boolean;
  className?: string;
}) {
  const steps = useMemo(() => buildStepperSteps(group), [group]);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  const [translateY, setTranslateY] = useState(0);
  const [allowMotion, setAllowMotion] = useState(false);

  const pinToBottom = (animate: boolean) => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const styles = getComputedStyle(outer);
    const available =
      outer.clientHeight -
      (Number.parseFloat(styles.paddingTop) || 0) -
      (Number.parseFloat(styles.paddingBottom) || 0);
    const next = -Math.max(0, inner.offsetHeight - available);
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
      const liveStyles = getComputedStyle(liveOuter);
      const liveAvailable =
        liveOuter.clientHeight -
        (Number.parseFloat(liveStyles.paddingTop) || 0) -
        (Number.parseFloat(liveStyles.paddingBottom) || 0);
      setTranslateY(-Math.max(0, liveInner.offsetHeight - liveAvailable));
    });
  };

  useLayoutEffect(() => {
    if (pinnedRef.current) return;
    pinToBottom(false);
    pinnedRef.current = true;
  }, [steps.length]);

  useEffect(() => {
    if (!pinnedRef.current) return undefined;
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
    const observer = new ResizeObserver(() => pinToBottom(pinnedRef.current));
    if (innerRef.current) observer.observe(innerRef.current);
    if (outerRef.current) observer.observe(outerRef.current);
    return () => observer.disconnect();
  }, []);

  if (steps.length === 0) return null;
  return (
    <div
      ref={outerRef}
      data-stepper="true"
      className={`flex flex-col gap-1 overflow-hidden pt-4 ${className}`}
      style={{ height: STEP_VIEWPORT_PX }}
    >
      <div
        ref={innerRef}
        className={`flex shrink-0 flex-col gap-1.5 ${
          faded ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        style={{
          transform: `translateY(${translateY}px)`,
          transition: allowMotion
            ? `transform ${STEP_FADE_MS}ms ease-out, opacity ${STEP_FADE_MS}ms ease-out`
            : `opacity ${STEP_FADE_MS}ms ease-out`,
        }}
        aria-hidden={faded || undefined}
      >
        <StepRows steps={steps} />
      </div>
    </div>
  );
}

export default memo(StepByStepDisplayer);
