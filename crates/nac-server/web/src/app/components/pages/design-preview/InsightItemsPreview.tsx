import { type ComponentProps, Fragment, type ReactNode, useEffect, useState } from "react";
import {
  IconName,
  InsightItem,
  InsightItemCodeDisplayer,
  InsightItemCodeDisplayerState,
  InsightItemState,
  InsightLinkButton,
} from "@/app/atoms";

const REASONING =
  "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.";
const RUN_INPUT = "npm run typecheck";
const RUN_ARGUMENTS = JSON.stringify(
  { cmd: RUN_INPUT, workdir: "/workspace/demo-project", yield_time_ms: 10000 },
  null,
  2,
);
const RUN_OUTPUT =
  "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.";
const RUN_OUTPUT_FULL = `${RUN_OUTPUT}\nChecked 412 files in 6.1 s.\nFound 0 errors.`;
const STEER_MESSAGE =
  "Pause after the staging deploy and wait for my review before touching production.";
const SEARCH_PATTERN = "resetIndent\\(";
const SEARCH_ARGUMENTS = JSON.stringify(
  { pattern: SEARCH_PATTERN, path: "src/app/lib", output_mode: "content" },
  null,
  2,
);
const SEARCH_MATCHES =
  "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7";
const SEARCH_MATCHES_FULL = `${SEARCH_MATCHES}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`;

const INDENT_NAMES = [
  "resetIndent",
  "clearIndentStack",
  "popIndent",
  "pushIndent",
  "indentLevel",
  "dedentTokens",
  "blankLineReset",
  "tableRowIndent",
  "listItemIndent",
  "nestedTableDepth",
];
const INDENT_PREVIEW = `${INDENT_NAMES.join("|").slice(0, 110)}…`;
const INDENT_FULL = JSON.stringify(
  { pattern: INDENT_NAMES.join("|"), path: "src/app/lib", regex: true },
  null,
  2,
);
const PREVIEW_LOAD_MS = 1200;

/** Fakes the load a real field makes, so "Show full" walks Loading into Expanded. */
function PreviewField({
  title,
  shortContent,
  fullContent,
}: {
  title: string;
  shortContent: string;
  fullContent: string;
}) {
  const [state, setState] = useState(InsightItemCodeDisplayerState.Default);
  useEffect(() => {
    if (state !== InsightItemCodeDisplayerState.Loading) return undefined;
    const timer = window.setTimeout(
      () => setState(InsightItemCodeDisplayerState.Expanded),
      PREVIEW_LOAD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <InsightItemCodeDisplayer
      title={title}
      state={state}
      shortContent={shortContent}
      fullContent={fullContent}
      onShowFull={() => setState(InsightItemCodeDisplayerState.Loading)}
      onHide={() => setState(InsightItemCodeDisplayerState.Default)}
    />
  );
}

const ignore = () => {};

const DISPLAYER_SAMPLES: ({ label: string } & ComponentProps<typeof InsightItemCodeDisplayer>)[] = [
  {
    label: "Default, with Show full",
    title: "Input",
    shortContent: INDENT_PREVIEW,
    onShowFull: ignore,
  },
  { label: "Default, without Show full", title: "Input", shortContent: INDENT_PREVIEW },
  {
    label: "Default, the load failed (Show full retries)",
    title: "Input",
    shortContent: INDENT_PREVIEW,
    onShowFull: ignore,
    error: "Could not load the full input.",
  },
  {
    label: "Loading",
    title: "Input",
    state: InsightItemCodeDisplayerState.Loading,
    shortContent: INDENT_PREVIEW,
    onShowFull: ignore,
  },
  {
    label: "Expanded",
    title: "Input",
    state: InsightItemCodeDisplayerState.Expanded,
    shortContent: INDENT_PREVIEW,
    fullContent: INDENT_FULL,
    onHide: ignore,
  },
  {
    label: "Expanded, cut by the server",
    title: "Input",
    state: InsightItemCodeDisplayerState.Expanded,
    shortContent: INDENT_PREVIEW,
    fullContent: INDENT_FULL,
    onHide: ignore,
    note: "The server cut this input at its size limit.",
  },
  {
    label: "Without heading",
    title: "Input",
    showHeading: false,
    shortContent: INDENT_PREVIEW,
    onShowFull: ignore,
  },
];

function CodeDisplayerStatesPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">Code displayer</span>
      <div className="grid grid-cols-3 items-start gap-4">
        {DISPLAYER_SAMPLES.map(({ label, ...props }) => (
          <div key={label} className="flex min-w-0 flex-col gap-2">
            <span className="label-micro text-basic-tertiary">{label}</span>
            <div className="bg-elevation-ground p-4">
              <InsightItemCodeDisplayer {...props} />
            </div>
          </div>
        ))}
        <div className="flex min-w-0 flex-col gap-2">
          <span className="label-micro text-basic-tertiary">Interactive</span>
          <div className="bg-elevation-ground p-4">
            <PreviewField title="Input" shortContent={INDENT_PREVIEW} fullContent={INDENT_FULL} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ItemSample {
  type: string;
  icon: IconName;
  title: string;
  loadingTitle: string;
  copyText: string;
  errorMessage: string;
  body: (state: InsightItemState) => ReactNode;
}

const ITEM_SAMPLES: ItemSample[] = [
  {
    type: "Reasoning",
    icon: IconName.Brain,
    title: "Thoughts, 2.3 s",
    loadingTitle: "Thinking",
    copyText: REASONING,
    errorMessage: "The model stopped before it finished reasoning.",
    body: (state) => (state === InsightItemState.Default ? <p>{REASONING}</p> : null),
  },
  {
    type: "Run Command (Error keeps the input)",
    icon: IconName.Terminal,
    title: "Run command",
    loadingTitle: "Running command",
    copyText: RUN_INPUT,
    errorMessage: "Command exited with code 2.",
    body: (state) => {
      if (state === InsightItemState.Loading) return null;
      const input = (
        <PreviewField title="Input" shortContent={RUN_INPUT} fullContent={RUN_ARGUMENTS} />
      );
      if (state === InsightItemState.Error) return input;
      return (
        <>
          {input}
          <PreviewField title="Output" shortContent={RUN_OUTPUT} fullContent={RUN_OUTPUT_FULL} />
        </>
      );
    },
  },
  {
    type: "Steer Session (Loading and Error keep the link)",
    icon: IconName.AddChat,
    title: "Steer session",
    loadingTitle: "Steer session",
    copyText: STEER_MESSAGE,
    errorMessage: "The session is no longer running.",
    body: (state) => {
      if (state !== InsightItemState.Default) {
        return <InsightLinkButton label="Calendar rollout" onClick={() => {}} />;
      }
      return (
        <>
          <p>{STEER_MESSAGE}</p>
          <InsightLinkButton label="Calendar rollout" href="#/design" />
        </>
      );
    },
  },
  {
    type: "Search File",
    icon: IconName.SearchFile,
    title: "Search files",
    loadingTitle: "Search files",
    copyText: SEARCH_PATTERN,
    errorMessage: "The pattern is not a valid regular expression.",
    body: (state) => {
      if (state === InsightItemState.Loading) return null;
      const pattern = (
        <PreviewField title="Input" shortContent={SEARCH_PATTERN} fullContent={SEARCH_ARGUMENTS} />
      );
      if (state === InsightItemState.Error) return pattern;
      return (
        <>
          {pattern}
          <PreviewField
            title="Output"
            shortContent={SEARCH_MATCHES}
            fullContent={SEARCH_MATCHES_FULL}
          />
        </>
      );
    },
  },
];

const ITEM_STATES = [
  { state: InsightItemState.Default, title: "Default" },
  { state: InsightItemState.Loading, title: "Loading" },
  { state: InsightItemState.Error, title: "Error" },
];

/** The detail column: items stack edge to edge on their own dividers. */
function StackedItemsPreview() {
  return (
    <div className="flex flex-col gap-2">
      <span className="label-micro text-basic-muted">Stacked, the first one active</span>
      <div className="flex w-[542px] max-w-full flex-col bg-elevation-ground">
        {ITEM_SAMPLES.map((sample, index) => (
          <InsightItem
            key={sample.type}
            id={`preview-stacked-${sample.icon}`}
            icon={sample.icon}
            title={sample.title}
            active={index === 0}
            copyText={sample.copyText}
          >
            {sample.body(InsightItemState.Default)}
          </InsightItem>
        ))}
      </div>
    </div>
  );
}

export function InsightItemsPreview() {
  return (
    <div className="flex flex-col gap-6">
      <CodeDisplayerStatesPreview />
      <StackedItemsPreview />
      <div className="grid grid-cols-3 items-start gap-x-4 gap-y-2">
        {ITEM_STATES.map(({ state, title }) => (
          <span key={state} className="label-micro text-basic-muted">
            {title}
          </span>
        ))}
        {ITEM_SAMPLES.flatMap((sample) =>
          [false, true].map((active) => (
            <Fragment key={`${sample.type}-${active}`}>
              <span className="col-span-3 pt-2 label-micro text-basic-tertiary">
                {active ? `${sample.type}, active` : sample.type}
              </span>
              {ITEM_STATES.map(({ state }) => (
                <div key={state} className="min-w-0 bg-elevation-ground">
                  <InsightItem
                    id={`preview-${sample.icon}-${state}-${active}`}
                    icon={sample.icon}
                    title={state === InsightItemState.Loading ? sample.loadingTitle : sample.title}
                    state={state}
                    active={active}
                    copyText={sample.copyText}
                    errorMessage={sample.errorMessage}
                  >
                    {sample.body(state)}
                  </InsightItem>
                </div>
              ))}
            </Fragment>
          )),
        )}
      </div>
    </div>
  );
}
