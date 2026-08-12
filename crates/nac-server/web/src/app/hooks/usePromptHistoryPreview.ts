import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

/** How much of an earlier prompt the placeholder shows before it trails off. */
const PREVIEW_MAX_CHARS = 40;

/** The first line of a prompt, shortened to what a placeholder can carry. */
function previewLine(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "[empty]";
  const firstLine = trimmed.split("\n")[0] ?? "";
  if (firstLine.length <= PREVIEW_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, PREVIEW_MAX_CHARS)}…`;
}

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
export function usePromptHistoryPreview({
  prompts,
  value,
  enabled,
  setValue,
  textareaRef,
  afterCommit,
}: {
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
}): PromptHistoryPreview {
  // -1 is "not walking"; 0 is the newest prompt and higher is further back.
  const [index, setIndex] = useState(-1);
  // Where the walk was when typing interrupted it.
  const [suspended, setSuspended] = useState(-1);

  const active = enabled && index >= 0 && index < prompts.length;
  const current = active ? (prompts[index] ?? "") : "";

  const reset = useCallback(() => {
    setIndex(-1);
    setSuspended(-1);
  }, []);

  const commit = useCallback(() => {
    setValue(current);
    setIndex(-1);
    // After the paint that carries the text, so the caret lands past the end of
    // something the field actually holds.
    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.selectionStart = current.length;
      node.selectionEnd = current.length;
      afterCommit?.();
    });
  }, [afterCommit, current, setValue, textareaRef]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!enabled || event.nativeEvent.isComposing) return false;

      if (event.key === "ArrowUp" && prompts.length > 0) {
        // An unsent draft keeps the key: moving the caret through it is what
        // ArrowUp is for, and the walk has nowhere to put the draft.
        if (value !== "" && !active) return false;
        event.preventDefault();
        setIndex(Math.min((active ? index : -1) + 1, prompts.length - 1));
        return true;
      }
      if (!active) return false;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        // Walking forward past the newest prompt leaves the history behind.
        setIndex(index - 1 >= 0 ? index - 1 : -1);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        commit();
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setIndex(-1);
        return true;
      }
      return false;
    },
    [active, commit, enabled, index, prompts.length, value],
  );

  const onValueChange = useCallback(
    (next: string) => {
      if (!enabled) return;
      if (index >= 0 && next !== "") {
        setSuspended(index);
        setIndex(-1);
        return;
      }
      if (next === "" && suspended >= 0) {
        setIndex(suspended);
        setSuspended(-1);
      }
    },
    [enabled, index, suspended],
  );

  return useMemo(
    () => ({
      active,
      previewText: active ? previewLine(current) : "",
      hasHistory: enabled && prompts.length > 0,
      onKeyDown,
      onValueChange,
      reset,
    }),
    [active, current, enabled, onKeyDown, onValueChange, prompts.length, reset],
  );
}
