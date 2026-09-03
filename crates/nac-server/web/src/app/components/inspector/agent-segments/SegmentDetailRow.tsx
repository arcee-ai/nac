import { memo } from "react";

import {
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  TooltipPosition,
} from "@/app/atoms";
import ToolPill, { ToolPillSize, ToolPillState } from "@/app/atoms/tool-pill";
import { ToolCallLabel } from "@/app/components/inspector/agent-segments/ToolCallLabel";
import SegmentDetailBox, {
  type SidebarBoxContent,
} from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import {
  ToolCallLabelState,
  type SegmentDisplayConfig,
} from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";

export interface SegmentDetailItem {
  key: string;
  config: SegmentDisplayConfig;
  state: ToolCallLabelState;
  durationMs?: number | null;
  copyText: string;
  boxes: SidebarBoxContent[];
  failed?: boolean;
}

export function SegmentDetailRow({
  item,
  isLast,
  animateConnector,
  highlighted = false,
}: {
  item: SegmentDetailItem;
  isLast: boolean;
  animateConnector: boolean;
  highlighted?: boolean;
}) {
  const isActive = item.state === ToolCallLabelState.Active;
  return (
    <div
      className={cn(
        "flex gap-2 items-start w-full scroll-mt-2 px-4 py-2",
        highlighted && "bg-btn-ghost-highlighted",
      )}
      data-segment-key={item.key}
    >
      <div className="flex flex-col items-center self-stretch shrink-0">
        <ToolPill
          size={ToolPillSize.Small}
          icon={item.config.icon}
          state={
            isActive
              ? ToolPillState.Active
              : item.failed
                ? ToolPillState.Error
                : ToolPillState.Default
          }
        />
        {!isLast ? (
          <div
            className={`flex-1 min-h-0 w-px -mb-6 bg-[var(--color-border-tertiary)]${
              animateConnector ? " agent-segment-row-connector" : ""
            }`}
          />
        ) : null}
      </div>
      <div className="flex flex-col flex-1 min-w-0 gap-2">
        <div className="flex gap-2 items-center w-full h-7">
          <ToolCallLabel
            config={item.config}
            state={item.state}
            durationMs={item.durationMs}
            className="flex-1 min-w-0"
          />
          {item.copyText.length > 0 && !isActive ? (
            <CopyButton
              value={item.copyText}
              variant={ButtonVariant.Tertiary}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              position={TooltipPosition.BottomLeft}
            >
              <Icon iconName={IconName.FileCopy} size={16} />
            </CopyButton>
          ) : null}
        </div>
        {item.boxes.length > 0 ? (
          <div className="flex flex-col gap-2 w-full">
            {item.boxes.map((box) => (
              <SegmentDetailBox key={box.key} box={box} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(SegmentDetailRow);
