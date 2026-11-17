/**
 * Whether a bare key is meant for the page: not for a field being written in,
 * and not for a focused control that Enter would itself activate.
 */
export declare function isAttentionKeyTarget(target: EventTarget | null): boolean;
/**
 * Bare-key shortcuts for the card that is asking for a decision: ⏎ and D for
 * a permission, 1–9 for an answer. They step aside while a dialog is open,
 * while the caret is in a field, and while a control has the focus, so a key
 * never answers something other than what the user is looking at.
 */
export declare function useAttentionKeys(enabled: boolean, onKey: (key: string, event: KeyboardEvent) => boolean): void;
