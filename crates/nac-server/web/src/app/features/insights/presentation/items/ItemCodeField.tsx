import { InsightItemCodeDisplayer } from "@/app/atoms";

/** The part of a tool call a field shows. */
export type ItemCodeFieldSource = "arguments" | "output";

interface ItemCodeFieldProps {
  title: string;
  /** Some types draw the field without its heading; the title still names it. */
  showHeading?: boolean;
  /** `presentation.summary` for arguments, `presentation.resultPreview` for output. */
  shortContent: string;
  source: ItemCodeFieldSource;
  /** `presentation.callId`; null for the compact tool blocks of orchestrator sessions. */
  callId: string | null;
}

/**
 * Every code field of the Insights items renders through here, so loading a
 * call's full arguments or output has a single owner.
 */
export function ItemCodeField({ title, showHeading, shortContent }: ItemCodeFieldProps) {
  return (
    <InsightItemCodeDisplayer title={title} showHeading={showHeading} shortContent={shortContent} />
  );
}
