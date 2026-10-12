import type { LightModelSettings, SessionBehavior } from "../../types/api";
export type LightMode = "single" | "dual";
/**
 * What the section reports upward. `light` is null while the dual form is
 * incomplete, so a submit can tell "single on purpose" from "not done yet".
 */
export interface LightSelection {
    mode: LightMode;
    light: LightModelSettings | null;
}
/**
 * The Single | Dual switch and, in dual mode, the light model row. Heavy
 * dispatches always run the session's own model, so the only extra choice is
 * the lighter one. Owns its form state and reports every change upward
 * through `onChange`.
 */
export declare function LightModelSection({ initial, onChange, behavior, }: {
    /** Seeds the form; a value opens the section in dual mode. */
    initial?: LightModelSettings | null;
    onChange: (selection: LightSelection) => void;
    /** Adjusts the promise without changing the stored optional field. */
    behavior?: SessionBehavior;
}): import("react").JSX.Element;
