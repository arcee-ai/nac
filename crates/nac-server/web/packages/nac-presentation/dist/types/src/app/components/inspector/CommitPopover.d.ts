import type { ChangedFileStat } from "../../types/api";
/**
 * The Commit button in the Changes toolbar, opening a message field over the
 * file list. Everything in the checkout goes into the commit, because the panel
 * offers no way to pick a subset. The refusals below are advisory — the server
 * decides for real, since another session may be running in this same checkout.
 */
export declare function CommitPopover({ sessionId, changed, revision, }: {
    sessionId: string;
    changed: ChangedFileStat[];
    revision: number | null;
}): import("react").JSX.Element;
