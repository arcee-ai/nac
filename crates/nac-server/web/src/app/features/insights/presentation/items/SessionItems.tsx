import { actionTypeLabel } from "@/app/features/insights/model/labels";
import { ItemCodeField } from "@/app/features/insights/presentation/items/ItemCodeField";
import {
  isDefault,
  type ItemContent,
  type ItemContext,
  segmentCall,
  type ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import {
  SessionLinkButton,
  SuccessText,
} from "@/app/features/insights/presentation/items/ItemParts";
import { sessionTarget } from "@/app/features/insights/presentation/useDelegatedSessions";

/** The link to the addressed session stays through loading and failure. */
export function sessionContent(segment: ToolSegment, context: ItemContext): ItemContent {
  const link = context.resolveSession(sessionTarget(segment));
  const result = segment.presentation?.resultPreview || null;
  const call = segmentCall(segment);
  const sessionLink = <SessionLinkButton link={link} context={context} />;

  if (segment.action === "session-cancel") {
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
  }
  return {
    title: "Session status",
    copyText: result,
    body: (state) => (
      <>
        {result && isDefault(state) ? (
          <ItemCodeField
            title="Results"
            shortContent={result}
            source="output"
            sessionId={context.sessionId}
            call={call}
          />
        ) : null}
        {sessionLink}
      </>
    ),
  };
}
