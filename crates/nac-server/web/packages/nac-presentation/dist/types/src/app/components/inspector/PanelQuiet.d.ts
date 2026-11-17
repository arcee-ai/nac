import type { ReactNode } from "react";
/**
 * The drawer panels' empty, waiting and failed detail: one quiet line, an
 * optional lead above it and an optional action below, centred in whatever
 * room the panel has. No illustration; the line says what is missing.
 */
export declare function PanelQuiet({ title, children, action, tone, live, }: {
    /** A short lead in full ink, e.g. "No terminal open". */
    title?: string;
    children?: ReactNode;
    action?: ReactNode;
    /** A failure reads in the error tone. */
    tone?: "error";
    /** Announce the line: "status" while waiting, "alert" for a failure. */
    live?: "status" | "alert";
}): import("react").JSX.Element;
