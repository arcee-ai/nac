import { BoxSurface } from "@/app/atoms";
import { TokenName } from "@/app/components/pages/design-preview/Showcase";

const RAMP = [
  { name: "type-display", spec: "30 / 600 (24 on phones)", sample: "What should we work on?" },
  { name: "type-title", spec: "20 / 600", sample: "Settings" },
  { name: "type-heading", spec: "17 / 600", sample: "Needs you" },
  { name: "type-subheading", spec: "14 / 600", sample: "Model and provider" },
  {
    name: "type-body",
    spec: "15 / 1.65, conversation",
    sample: "I updated the parser and the tests pass.",
  },
  { name: "type-strong", spec: "13 / 600", sample: "Fix the flaky parser test" },
  { name: "type-label", spec: "13 / 500, controls", sample: "New session" },
  {
    name: "type-body-chrome",
    spec: "13 / 400, chrome",
    sample: "Runs in the project's working tree.",
  },
  { name: "type-meta-strong", spec: "12 / 500", sample: "nac · main · local" },
  { name: "type-meta", spec: "12 / 400", sample: "Edited 4 minutes ago" },
  { name: "type-tag", spec: "11 / 500, never caps", sample: "3 agents" },
];

/** The one type scale: every legacy class is an alias onto these steps. */
export function TypographySection() {
  return (
    <BoxSurface title="Typography">
      <div className="flex flex-col">
        {RAMP.map((step) => (
          <div
            key={step.name}
            className="flex flex-col gap-1 border-b border-muted px-4 py-3 md:flex-row md:items-baseline md:gap-6"
          >
            <div className="flex w-full shrink-0 flex-col md:w-[200px]">
              <TokenName>{step.name}</TokenName>
              <span className="type-meta text-basic-muted">{step.spec}</span>
            </div>
            <div className={`${step.name} min-w-0 truncate text-basic-primary`}>{step.sample}</div>
          </div>
        ))}
        <div className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6">
          <div className="flex w-full shrink-0 flex-col md:w-[200px]">
            <TokenName>code-medium</TokenName>
            <span className="type-meta text-basic-muted">IBM Plex Mono 12.5</span>
          </div>
          <code className="code code-medium text-basic-secondary">cargo test -p nac-core</code>
        </div>
      </div>
    </BoxSurface>
  );
}
