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
 * The design's Plex Mono Medium 12/16 without tracking. `.code` sets a 1.5
 * line height and tracking in unlayered CSS, which only `!` utilities outrank.
 */
const CODE_TYPE = "code code-small font-medium !leading-4 !tracking-normal";

const GUTTER = cn(CODE_TYPE, "w-12 shrink-0 select-none text-right text-basic-muted opacity-50");

const ROW_TONE: Record<CodeDisplayerLineKind, string> = {
  insert: "bg-success-primary border-success-primary",
  delete: "bg-error-primary border-error-primary",
  context: "border-transparent",
};

/** The tint alone marks a change, so a screen reader hears it before the number. */
const SPOKEN_KIND: Partial<Record<CodeDisplayerLineKind, string>> = {
  insert: "Added",
  delete: "Deleted",
};

function Line({ line }: { line: CodeDisplayerLine }) {
  const kind = line.kind ?? "context";
  const spoken = SPOKEN_KIND[kind];
  return (
    <div className={cn("flex min-h-4 w-full items-start border-l-2 border-solid", ROW_TONE[kind])}>
      <span className={GUTTER}>
        {spoken ? <span className="sr-only">{spoken} </span> : null}
        {line.number ?? null}
      </span>
      <span
        className={cn(
          CODE_TYPE,
          "min-w-0 flex-1 whitespace-pre-wrap break-words px-2 text-basic-primary",
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
 * under their file button. An inserted line sits on the success tint and a
 * deleted one on the error tint, each behind a 2px rule of its tone; a context
 * line keeps a clear rule so every line's code starts at the same place. Long
 * lines wrap instead of scrolling sideways. The caller passes the hunks, with
 * tokens when it wants syntax colours.
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
      "flex w-full min-w-0 flex-col overflow-clip rounded-lg py-2 [&>*]:shrink-0",
      className,
    )}
  >
    {hunks.map((hunk, hunkIndex) => (
      <Fragment key={hunkIndex}>
        {hunkIndex > 0 ? (
          <div role="separator" className="flex w-full border-l-2 border-solid border-transparent">
            <span aria-hidden className={GUTTER}>
              …
            </span>
          </div>
        ) : null}
        {hunk.map((line, lineIndex) => (
          <Line key={lineIndex} line={line} />
        ))}
      </Fragment>
    ))}
  </div>
);

export default CodeDisplayer;
