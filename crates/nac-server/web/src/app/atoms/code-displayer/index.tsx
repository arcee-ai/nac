import type React from "react";
import { Fragment } from "react";

import { cn } from "../../lib/cn";
import { type CodeToken, tokenStyle } from "../../lib/highlight";

/** The diff's own line vocabulary, as `WorkspaceDiffLine.kind` spells it. */
export type CodeDisplayerLineKind = "insert" | "delete" | "context";

export interface CodeDisplayerLine {
  /** Left out, the line is context. */
  kind?: CodeDisplayerLineKind;
  /** The gutter's number; a deleted line usually keeps its old one. Left out, the gutter is blank. */
  number?: number | null;
  /** The line's text, drawn plain when there are no tokens. */
  content: string;
  /** The same text split into syntax colours, e.g. one line of `highlightDiff`. */
  tokens?: CodeToken[] | null;
  /** Drawn after the code, e.g. a "No newline at end of file" note. */
  trailing?: React.ReactNode;
}

interface CodeDisplayerProps {
  /** Names the diff for assistive technology, e.g. "Changes to index.tsx". */
  "aria-label": string;
  /** Runs of adjacent lines; a muted … row stands between two runs. */
  hunks: CodeDisplayerLine[][];
  className?: string;
}

/**
 * Focus mono: IBM Plex Mono at 12.5/20 without tracking, the GitHub diff
 * rhythm. `.code` sets its own line height and tracking in unlayered CSS,
 * which only `!` utilities outrank.
 */
export const DIFF_CODE_TYPE =
  "code text-[length:var(--type-mono)] !leading-5 !tracking-normal tabular";

/** The line-number column: muted, right-aligned, never selected with the code. */
export const DIFF_GUTTER = cn(
  DIFF_CODE_TYPE,
  "w-11 shrink-0 select-none pr-2 text-right text-basic-muted",
);

const ROW_TONE: Record<CodeDisplayerLineKind, string> = {
  insert: "bg-[var(--f-green-wash)]",
  delete: "bg-[var(--f-red-wash)]",
  context: "",
};

/** GitHub's deeper gutter tint on a changed line. */
const GUTTER_TONE: Record<CodeDisplayerLineKind, string> = {
  insert: "bg-[var(--f-green-wash)] text-[var(--f-green-text)]",
  delete: "bg-[var(--f-red-wash)] text-[var(--f-red-text)]",
  context: "",
};

const SIGN: Record<CodeDisplayerLineKind, string> = { insert: "+", delete: "−", context: "" };

const SIGN_TONE: Record<CodeDisplayerLineKind, string> = {
  insert: "text-[var(--f-green-text)]",
  delete: "text-[var(--f-red-text)]",
  context: "",
};

/** The tint alone marks a change, so a screen reader hears it before the number. */
const SPOKEN_KIND: Partial<Record<CodeDisplayerLineKind, string>> = {
  insert: "Added",
  delete: "Deleted",
};

/**
 * One line of a diff or a file: number, a `+`/`−` sign column and the code,
 * on a green or red wash when it changed. Long lines wrap, so the pane stays
 * the only scroller. Shared by the Changes panel and the Insights items.
 */
export function DiffLineRow({ line }: { line: CodeDisplayerLine }) {
  const kind = line.kind ?? "context";
  const spoken = SPOKEN_KIND[kind];
  return (
    <div className={cn("flex min-h-5 w-full min-w-0 items-start", ROW_TONE[kind])}>
      <span className={cn(DIFF_GUTTER, GUTTER_TONE[kind])}>
        {spoken ? <span className="sr-only">{spoken} </span> : null}
        <span className={kind === "context" ? undefined : "opacity-70"}>{line.number ?? null}</span>
      </span>
      <span
        aria-hidden
        className={cn(DIFF_CODE_TYPE, "w-4 shrink-0 select-none text-center", SIGN_TONE[kind])}
      >
        {SIGN[kind]}
      </span>
      <span
        className={cn(
          DIFF_CODE_TYPE,
          "min-w-0 flex-1 whitespace-pre-wrap break-words pr-3 text-basic-primary",
        )}
      >
        {line.tokens
          ? line.tokens.map((token, index) => (
              <span key={index} style={tokenStyle(token)}>
                {token.text}
              </span>
            ))
          : line.content}
        {line.trailing}
      </span>
    </div>
  );
}

/**
 * A diff with line numbers, as the Create and Edit Insights items draw it
 * under their file button: GitHub-like green and red washes on the code
 * surface, a muted gutter and a sign column so every line's code starts at
 * the same place. Long lines wrap instead of scrolling sideways. The caller
 * passes the hunks, with tokens when it wants syntax colours.
 *
 * It is a named group rather than a region: a transcript can show many diffs,
 * and each would otherwise become a landmark.
 */
const CodeDisplayer: React.FC<CodeDisplayerProps> = ({
  "aria-label": ariaLabel,
  hunks,
  className,
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className={cn(
      "flex w-full min-w-0 flex-col overflow-clip rounded-lg border border-tertiary bg-[var(--color-code-bg)] py-1.5 [&>*]:shrink-0",
      className,
    )}
  >
    {hunks.map((hunk, hunkIndex) => (
      <Fragment key={hunkIndex}>
        {hunkIndex > 0 ? (
          <div role="separator" className="flex w-full bg-[var(--f-wash-1)]">
            <span aria-hidden className={DIFF_GUTTER}>
              …
            </span>
          </div>
        ) : null}
        {hunk.map((line, lineIndex) => (
          <DiffLineRow key={lineIndex} line={line} />
        ))}
      </Fragment>
    ))}
  </div>
);

export default CodeDisplayer;
