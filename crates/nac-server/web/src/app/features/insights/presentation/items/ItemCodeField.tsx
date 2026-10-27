import { useMemo } from "react";

import { InsightItemCodeDisplayer } from "@/app/atoms";
import { useFullContent } from "@/app/features/insights/presentation/items/useFullContent";
import type { ToolCallRef } from "@/app/services/queries/toolCalls";

/** The part of a tool call a field shows. */
export type ItemCodeFieldSource = "arguments" | "output";

const NOUNS: Record<ItemCodeFieldSource, string> = { arguments: "input", output: "output" };
/** The server's bound on each part of a call's content. */
const CONTENT_LIMIT = "256 KiB";
const JSON_SPACE = " \t\n\r";

interface ItemCodeFieldProps {
  title: string;
  /** Some types draw the field without its heading; the title still names it. */
  showHeading?: boolean;
  /** `presentation.summary` for arguments, `presentation.resultPreview` for output. */
  shortContent: string;
  source: ItemCodeFieldSource;
  sessionId: string;
  /** `segmentCall(segment)`; null for the compact tool blocks of orchestrator sessions. */
  call: ToolCallRef | null;
}

/**
 * The text indented by two spaces when it is JSON, else as it is. Tokens are
 * copied rather than re-encoded, so a number past 2^53 or a repeated key reads
 * as the model sent it.
 */
function indentJson(text: string): string {
  try {
    JSON.parse(text);
  } catch {
    return text;
  }
  let out = "";
  let depth = 0;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === '"') {
      let end = at + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(at, end + 1);
      at = end;
    } else if (char === "{" || char === "[") {
      let next = at + 1;
      while (JSON_SPACE.includes(text[next])) next += 1;
      if (text[next] === "}" || text[next] === "]") {
        out += char + text[next];
        at = next;
      } else {
        depth += 1;
        out += char + newline();
      }
    } else if (char === "}" || char === "]") {
      depth -= 1;
      out += newline() + char;
    } else if (char === ",") {
      out += `,${newline()}`;
    } else if (char === ":") {
      out += ": ";
    } else if (!JSON_SPACE.includes(char)) {
      out += char;
    }
  }
  return out;
}

/**
 * Every code field of the Insights items renders through here, so loading a
 * call's full arguments or output has a single owner. "Show full" needs the
 * call id to load them by.
 */
export function ItemCodeField({
  title,
  showHeading,
  shortContent,
  source,
  sessionId,
  call,
}: ItemCodeFieldProps) {
  const full = useFullContent(sessionId, call, source === "output");
  const { content } = full;
  const fullContent = useMemo(() => {
    if (!content) return null;
    return source === "arguments" ? indentJson(content.arguments) : content.output;
  }, [content, source]);
  const cut = source === "arguments" ? content?.arguments_truncated : content?.output_truncated;
  const noun = NOUNS[source];
  return (
    <InsightItemCodeDisplayer
      title={title}
      showHeading={showHeading}
      state={full.state}
      shortContent={shortContent}
      fullContent={fullContent}
      onShowFull={call ? full.showFull : undefined}
      onHide={full.hide}
      error={full.failed ? `Could not load the full ${noun}.` : null}
      note={cut ? `The server cut this ${noun} at ${CONTENT_LIMIT}.` : null}
    />
  );
}
