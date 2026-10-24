import { Fragment, useEffect, useState } from "react";
import {
  BoxSurface,
  CodeChangesBadge,
  CodeChangesBadgeSize,
  CodeDisplayer,
  type CodeDisplayerLine,
  FileButton,
  FileButtonSize,
  FileButtonsList,
  type FileButtonsListFile,
} from "@/app/atoms";
import { type CodeToken, highlightDiff } from "@/app/lib/highlight";
import type { WorkspaceDiffLine, WorkspaceDiffSection } from "@/app/types/api";

const SIZES = [
  { size: FileButtonSize.Large, badge: CodeChangesBadgeSize.Large, title: "Large" },
  { size: FileButtonSize.Medium, badge: CodeChangesBadgeSize.Medium, title: "Medium" },
  { size: FileButtonSize.Small, badge: CodeChangesBadgeSize.Small, title: "Small" },
];

const SAMPLE_PATH = "src/app/components/index.tsx";
const LONG_PATH = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx";

const BUTTON_STATES: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  additions?: number;
  deletions?: number;
}[] = [
  { title: "Default", additions: 279, deletions: 84 },
  { title: "Active", active: true, additions: 279, deletions: 84 },
  { title: "Disabled", disabled: true, additions: 279, deletions: 84 },
  { title: "Active, disabled", active: true, disabled: true, additions: 279, deletions: 84 },
  { title: "Without counts" },
];

const BADGE_SAMPLES = [
  { title: "Both", additions: 279, deletions: 84 },
  { title: "Additions only", additions: 12 },
  { title: "Deletions only", deletions: 1 },
];

const LIST_FILES: FileButtonsListFile[] = [
  { path: "src/app/components/index.tsx", additions: 279, deletions: 84 },
  { path: "src/app/lib/parser.ts", additions: 42, deletions: 17 },
  { path: "src/app/lib/lexer.ts", additions: 8, deletions: 3 },
  { path: "src/app/theme/tokens.css", additions: 16, deletions: 16 },
  { path: "docs/getting-started.md", additions: 31, deletions: 0 },
  { path: "crates/demo-core/src/lib.rs", additions: 120, deletions: 45 },
  { path: "crates/demo-core/Cargo.toml", additions: 2, deletions: 1 },
  { path: "package.json", additions: 3, deletions: 2 },
  { path: "scripts/release.sh", additions: 14, deletions: 9 },
  { path: "src/app/hooks/useCalendar.ts", additions: 66, deletions: 12 },
  { path: "src/app/components/CalendarView.tsx", additions: 98, deletions: 40 },
  { path: "src/app/components/EventCard.tsx", additions: 25, deletions: 7 },
  { path: "tests/parser.test.ts", additions: 54, deletions: 0 },
  { path: ".github/workflows/ci.yml", additions: 6, deletions: 4 },
  { path: "Dockerfile", additions: 1, deletions: 1 },
  { path: "src/app/styles/calendar.scss", additions: 19, deletions: 22 },
  { path: LONG_PATH, additions: 1204, deletions: 377 },
];

const DIFF_PATH = "src/app/lib/parser.ts";

const diffLine = (
  kind: string,
  old_lineno: number | null,
  new_lineno: number | null,
  content: string,
  has_trailing_newline = true,
): WorkspaceDiffLine => ({ kind, old_lineno, new_lineno, content, has_trailing_newline });

const DIFF: WorkspaceDiffSection = {
  stage: "unstaged",
  status: "modified",
  additions: 3,
  deletions: 2,
  binary: false,
  too_large: false,
  truncated: false,
  error: null,
  hunks: [
    {
      function_context: null,
      old_start: 1,
      old_lines: 3,
      new_start: 1,
      new_lines: 3,
      lines: [
        diffLine("context", 1, 1, 'import { tokenize } from "./lexer";'),
        diffLine("delete", 2, null, 'import type { Token } from "./lexer";'),
        diffLine("insert", null, 2, 'import { type Token, TokenKind } from "./lexer";'),
        diffLine("context", 3, 3, ""),
      ],
    },
    {
      function_context: null,
      old_start: 24,
      old_lines: 3,
      new_start: 24,
      new_lines: 4,
      lines: [
        diffLine("context", 24, 24, "export function parse(source: string): Token[] {"),
        diffLine("delete", 25, null, "  return tokenize(source);"),
        diffLine("insert", null, 25, "  const tokens = tokenize(source);"),
        diffLine(
          "insert",
          null,
          26,
          "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);",
        ),
        diffLine("context", 26, 27, "}", false),
      ],
    },
  ],
};

/** The Insights detail column's ground, where these atoms sit. */
const GROUND = "bg-elevation-ground p-2";

const noop = () => {};

function ButtonStatesPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">File button</span>
      <div className="grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2">
        <span />
        {SIZES.map(({ size, title }) => (
          <span key={size} className="label-micro text-basic-muted">
            {title}
          </span>
        ))}
        {BUTTON_STATES.map((state) => (
          <Fragment key={state.title}>
            <span className="label-micro text-basic-tertiary">{state.title}</span>
            {SIZES.map(({ size }) => (
              <div key={size} className={GROUND}>
                <FileButton
                  path={SAMPLE_PATH}
                  size={size}
                  active={state.active}
                  disabled={state.disabled}
                  additions={state.additions}
                  deletions={state.deletions}
                  onClick={noop}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function TruncationPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">A long name in 200px</span>
      <div className="flex flex-wrap items-start gap-4">
        {SIZES.map(({ size }) => (
          <div key={size} className={`w-[200px] ${GROUND}`}>
            <FileButton
              path={LONG_PATH}
              size={size}
              additions={1204}
              deletions={377}
              onClick={noop}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BadgePreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">Code changes badge</span>
      <div className="grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2">
        <span />
        {BADGE_SAMPLES.map(({ title }) => (
          <span key={title} className="label-micro text-basic-muted">
            {title}
          </span>
        ))}
        {SIZES.map(({ badge, title }) => (
          <Fragment key={badge}>
            <span className="label-micro text-basic-tertiary">{title}</span>
            {BADGE_SAMPLES.map((sample) => (
              <CodeChangesBadge
                key={sample.title}
                size={badge}
                additions={sample.additions}
                deletions={sample.deletions}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Opening a file highlights it, the way Files highlights the file it shows. */
function OpenableList({
  files,
  size,
  caption,
}: {
  files: FileButtonsListFile[];
  size: FileButtonSize;
  caption: string;
}) {
  const [open, setOpen] = useState(files[1]?.path ?? null);
  return (
    <div className="flex w-[280px] flex-col gap-2">
      <span className="label-micro text-basic-muted">{caption}</span>
      <div className={GROUND}>
        <FileButtonsList
          aria-label="Changed files"
          size={size}
          files={files.map((file) => ({ ...file, active: file.path === open }))}
          onOpen={setOpen}
        />
      </div>
      <span className="label-micro text-basic-tertiary">Open file: {open ?? "none"}</span>
    </div>
  );
}

function ListsPreview() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      {SIZES.map(({ size, title }) => (
        <OpenableList
          key={size}
          size={size}
          files={LIST_FILES.slice(0, 5)}
          caption={`List, 5 files, ${title}`}
        />
      ))}
      <OpenableList
        size={FileButtonSize.Small}
        files={LIST_FILES}
        caption="List, 17 files, Small"
      />
    </div>
  );
}

/** A deleted line keeps its number in the old file, as Files numbers it. */
const displayerLine = (
  line: WorkspaceDiffLine,
  tokens: CodeToken[] | undefined,
): CodeDisplayerLine => ({
  kind: line.kind === "insert" || line.kind === "delete" ? line.kind : "context",
  number: line.kind === "delete" ? line.old_lineno : (line.new_lineno ?? line.old_lineno),
  content: line.content,
  tokens,
  trailing: line.has_trailing_newline ? null : (
    <span className="italic text-basic-muted"> No newline at end of file</span>
  ),
});

function CodeDisplayerPreview() {
  const [highlighted, setHighlighted] = useState<Map<WorkspaceDiffLine, CodeToken[]>>(
    () => new Map(),
  );
  useEffect(() => {
    let active = true;
    void highlightDiff(DIFF_PATH, [DIFF]).then((result) => {
      if (active) setHighlighted(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const samples = [
    { title: "Code displayer, two hunks", tokens: highlighted },
    { title: "Code displayer without tokens", tokens: null },
  ];
  return (
    <div className="flex flex-wrap items-start gap-6">
      {samples.map(({ title, tokens }) => (
        <div key={title} className="flex w-[480px] flex-col gap-2">
          <span className="label-micro text-basic-muted">{title}</span>
          <div className={GROUND}>
            <CodeDisplayer
              aria-label={`Changes to ${DIFF_PATH}`}
              hunks={DIFF.hunks.map((hunk) =>
                hunk.lines.map((line) => displayerLine(line, tokens?.get(line))),
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FilesAtomsSection() {
  return (
    <BoxSurface title="Files">
      <div className="p-4 flex flex-col gap-6">
        <ButtonStatesPreview />
        <TruncationPreview />
        <BadgePreview />
        <ListsPreview />
        <CodeDisplayerPreview />
      </div>
    </BoxSurface>
  );
}
