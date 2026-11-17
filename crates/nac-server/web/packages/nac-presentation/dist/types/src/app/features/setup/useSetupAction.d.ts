import type { Effect } from "effect";
import { type SetupFailure } from "./workflow";
/** One form attempt at a time; unknown writes require a fresh review, never an edit retry. */
export declare function useSetupAction(open?: boolean): {
    busy: boolean;
    needsReview: boolean;
    run: <T>(build: (lease: NonNullable<{
        signal: AbortSignal;
        current: () => boolean;
        close: () => void;
    } | null>) => Effect.Effect<T, SetupFailure>) => Promise<T | undefined>;
};
