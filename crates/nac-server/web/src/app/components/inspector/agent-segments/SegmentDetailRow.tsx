import { memo } from "react";

import {
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  ToolPill,
  ToolPillSize,
  ToolPillState,
  TooltipPosition,
} from "@/app/atoms";
import SegmentDetailBox, {
  type SegmentDetailBoxContent,
} from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import { ToolCallLabel } from "@/app/components/inspector/agent-segments/ToolCallLabel";
import type { SegmentDisplayConfig } from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";

export interface SegmentDetailItem {
  key: string;
  config: SegmentDisplayConfig;
  label: string;
  statusLabel: string;
  live: boolean;
  failed: boolean;
  copyText: string;
  boxes: SegmentDetailBoxContent[];
}

function SegmentDetailRow({
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
  const pillState = item.live
    ? ToolPillState.Active
    : item.failed
      ? ToolPillState.Error
      : ToolPillState.Default;

  return (
    <div
      className={cn(
        "flex w-full scroll-mt-2 items-start gap-2 px-4 py-2 transition-colors",
        highlighted && "bg-btn-ghost-highlighted",
      )}
      data-segment-key={item.key}
    >
      <div className="flex shrink-0 self-stretch flex-col items-center">
        <ToolPill size={ToolPillSize.Small} icon={item.config.icon} state={pillState} />
        {!isLast ? (
          <div
            className={cn(
              "-mb-6 w-px min-h-0 flex-1 bg-[var(--color-border-tertiary)]",
              animateConnector && "agent-segment-row-connector",
            )}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex h-7 w-full items-center gap-2">
          <ToolCallLabel
            label={item.label}
            statusLabel={item.statusLabel}
            active={item.live}
            failed={item.failed}
            className="min-w-0 flex-1"
          />
          {item.copyText && !item.live ? (
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
          <div className="flex w-full flex-col gap-2">
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
