import { memo, useEffect, useMemo, useRef, useState } from "react";

import { ToolCallLabel } from "@/app/components/inspector/agent-segments/ToolCallLabel";
import {
  buildStepperSteps,
  type StepByStepStep,
} from "@/app/components/inspector/agent-segments/stepper";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";

const STEP_FADE_MS = 300;

function StepRows({ steps }: { steps: StepByStepStep[] }) {
  return (
    <>
      {steps.map((step, index) => (
        <ToolCallLabel
          key={step.key}
          label={step.label}
          statusLabel={step.statusLabel}
          active={step.active}
          failed={step.failed}
          className={
            index === steps.length - 1
              ? "opacity-100"
              : index === steps.length - 2
                ? "opacity-50"
                : "opacity-20"
          }
        />
      ))}
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
  const previousCount = useRef(steps.length);
  const [settled, setSettled] = useState(true);

  useEffect(() => {
    if (steps.length === previousCount.current) return undefined;
    previousCount.current = steps.length;
    setSettled(false);
    const timeout = window.setTimeout(() => setSettled(true), STEP_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [steps.length]);

  if (steps.length === 0) return null;
  return (
    <div
      className={`flex max-h-20 flex-col gap-1.5 overflow-hidden pt-3 transition-opacity duration-300 ${
        faded ? "opacity-0" : settled ? "opacity-100" : "opacity-80"
      } ${className}`}
      aria-hidden={faded || undefined}
    >
      <StepRows steps={steps.slice(-3)} />
    </div>
  );
}

export default memo(StepByStepDisplayer);
