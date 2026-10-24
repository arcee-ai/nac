import { Fragment, type ReactNode } from "react";
import {
  IconName,
  InsightCodeBox,
  InsightItem,
  InsightItemState,
  InsightLinkButton,
} from "@/app/atoms";

const REASONING =
  "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.";
const RUN_INPUT = "npm run typecheck";
const RUN_OUTPUT =
  "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.";
const STEER_MESSAGE =
  "Pause after the staging deploy and wait for my review before touching production.";
const SEARCH_PATTERN = "resetIndent\\(";
const SEARCH_MATCHES =
  "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7";

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
      const input = <InsightCodeBox label="Input">{RUN_INPUT}</InsightCodeBox>;
      if (state === InsightItemState.Error) return input;
      return (
        <>
          {input}
          <InsightCodeBox label="Output">{RUN_OUTPUT}</InsightCodeBox>
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
    type: "Search File (unlabelled boxes)",
    icon: IconName.SearchFile,
    title: "Search files",
    loadingTitle: "Search files",
    copyText: SEARCH_PATTERN,
    errorMessage: "The pattern is not a valid regular expression.",
    body: (state) => {
      if (state === InsightItemState.Loading) return null;
      const pattern = <InsightCodeBox>{SEARCH_PATTERN}</InsightCodeBox>;
      if (state === InsightItemState.Error) return pattern;
      return (
        <>
          {pattern}
          <InsightCodeBox>{SEARCH_MATCHES}</InsightCodeBox>
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

export function InsightItemsPreview() {
  return (
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
              <div key={state} className="min-w-0 rounded-[4px] border border-muted">
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
  );
}
