import { type KeyboardEvent, type RefObject } from "react";
export interface PromptHistoryPreview {
    /** An earlier prompt is being previewed in the placeholder. */
    active: boolean;
    /** That prompt, shortened for the placeholder. Empty while inactive. */
    previewText: string;
    /** There is at least one earlier prompt to walk back to. */
    hasHistory: boolean;
    /** True when the key belonged to the preview and needs no further handling. */
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
    /** Called with what the field now holds, before the state that holds it. */
    onValueChange: (next: string) => void;
    /** Drops the walk entirely: a send, a blur, or a different session. */
    reset: () => void;
}
/**
 * Walking back through the prompts already sent, the way the composer in
 * ArceeFM does it: ArrowUp shows one in the placeholder rather than filling the
 * field, Tab takes it, ArrowDown walks forward out of the history again, and
 * Escape leaves it where it was.
 *
 * A preview is not a draft — the field stays empty until Tab commits — which is
 * what lets ArrowUp keep meaning "one further back" without a modifier, and
 * lets an unsent draft rule the key out entirely rather than be overwritten by
 * it. Typing while a preview is up puts it aside and remembers the position, so
 * clearing the field again resumes the walk instead of restarting it.
 */
export declare function usePromptHistoryPreview({ prompts, value, enabled, setValue, textareaRef, afterCommit, }: {
    /** Prompts already sent, newest first. */
    prompts: string[];
    /** What the field holds right now. */
    value: string;
    /** Off on a phone, where there is no key to walk with. */
    enabled: boolean;
    setValue: (next: string) => void;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    /** Run once the committed prompt is in the field, e.g. to resize it. */
    afterCommit?: () => void;
}): PromptHistoryPreview;
