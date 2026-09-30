import { useRef, useState } from "react";
import type { Effect } from "effect";

import { useSetupLifetime } from "./lifetime";
import { runSetup, requiresSetupReview, type SetupFailure } from "./workflow";

/** One form attempt at a time; unknown writes require a fresh review, never an edit retry. */
export function useSetupAction(open = true) {
  const lifetime = useSetupLifetime(open);
  const locked = useRef(false);
  const needsReviewRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  return {
    busy,
    needsReview,
    run: async <T>(
      build: (lease: NonNullable<typeof lifetime.current>) => Effect.Effect<T, SetupFailure>,
    ) => {
      const lease = lifetime.current;
      if (!lease?.current() || locked.current || needsReviewRef.current) return undefined;
      locked.current = true;
      setBusy(true);
      try {
        const result = await runSetup(build(lease));
        return lease.current() ? result : undefined;
      } catch (error) {
        if (!lease.current()) return undefined;
        if (requiresSetupReview(error)) {
          needsReviewRef.current = true;
          setNeedsReview(true);
        }
        throw error;
      } finally {
        locked.current = false;
        if (lease.current()) setBusy(false);
      }
    },
  };
}
