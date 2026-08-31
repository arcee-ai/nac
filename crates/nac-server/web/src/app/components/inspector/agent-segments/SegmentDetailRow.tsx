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

export interface SegmentDetailItem {
  key: string;
  config: SegmentDisplayConfig;
  state: ToolCallLabelState;
  durationMs?: number | null;
  copyText: string;
  boxes: SidebarBoxContent[];
}

export function SegmentDetailRow({
  item,
  isLast,
  animateConnector,
}: {
  item: SegmentDetailItem;
  isLast: boolean;
  animateConnector: boolean;
}) {
  const isActive = item.state === ToolCallLabelState.Active;
  return (
    <div className="flex gap-2 items-start w-full">
      <div className="flex flex-col items-center self-stretch shrink-0">
        <ToolPill
          size={ToolPillSize.Small}
          icon={item.config.icon}
          state={isActive ? ToolPillState.Active : ToolPillState.Default}
        />
        {!isLast ? (
          <div
            className={`flex-1 min-h-0 w-px bg-[var(--color-border-accent-primary)]${
              animateConnector ? " agent-segment-row-connector" : ""
            }`}
          />
        ) : null}
      </div>
      <div className="flex flex-col flex-1 min-w-0 gap-2 pb-8">
        <div className="flex gap-2 items-center w-full">
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
