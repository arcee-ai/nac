import { InsightCodeBox, InsightItemState } from "@/app/atoms";
import { actionTypeLabel } from "@/app/features/insights/model/labels";
import {
  isDefault,
  withDuration,
  type ItemContent,
  type ItemContext,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import {
  BodyText,
  SessionLinkButton,
  SuccessText,
} from "@/app/features/insights/presentation/items/ItemParts";
import { sessionTarget } from "@/app/features/insights/presentation/useDelegatedSessions";
import { formatSeconds } from "@/app/lib/format";

/** The link to the addressed session stays through loading and failure. */
export function sessionContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const link = context.resolveSession(sessionTarget(segment));
  const result = segment.presentation?.resultPreview || null;
  const sessionLink = <SessionLinkButton link={link} context={context} />;

  switch (segment.action) {
    case "session-status":
    case "session-read":
      return {
        title: segment.action === "session-status" ? "Session status" : "Read session",
        copyText: result,
        body: (state) => (
          <>
            {result && isDefault(state) ? <InsightCodeBox>{result}</InsightCodeBox> : null}
            {sessionLink}
          </>
        ),
      };
    case "session-wait": {
      const durationMs = segment.presentation?.durationMs;
      return {
        title: withDuration(actionTypeLabel("session-wait"), durationMs),
        copyText: result,
        body: (state) => (
          <>
            {durationMs != null && state !== InsightItemState.Loading ? (
              <p className="label-micro text-btn-secondary">Slept {formatSeconds(durationMs)}</p>
            ) : null}
            {result && isDefault(state) ? <BodyText>{result}</BodyText> : null}
            {sessionLink}
          </>
        ),
      };
    }
    case "session-cancel":
      return {
        title: link?.title
          ? `${actionTypeLabel("session-cancel")}: ${link.title}`
          : actionTypeLabel("session-cancel"),
        body: (state) => (
          <>
            {isDefault(state) ? <SuccessText>The session has been cancelled.</SuccessText> : null}
            {sessionLink}
          </>
        ),
      };
    case "session-steer":
    default:
      return {
        title: actionTypeLabel("session-steer"),
        copyText: result,
        body: (state) => (
          <>
            {result && isDefault(state) ? <BodyText>{result}</BodyText> : null}
            {sessionLink}
          </>
        ),
      };
  }
}
