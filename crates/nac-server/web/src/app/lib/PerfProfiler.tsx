import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";

import { perfEnabled, perfMark } from "@/app/lib/perfDebug";

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  perfMark(`commit:${id}`, {
    ms: actualDuration,
    fields: { phase },
    throttleMs: 1000,
    slowMs: 16,
  });
};

/**
 * Wrap a subtree so React reports what each of its commits actually cost.
 * Transparent unless `__perf.on()` has been called, so it can stay in the tree.
 */
export function PerfProfiler({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  if (!perfEnabled()) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
