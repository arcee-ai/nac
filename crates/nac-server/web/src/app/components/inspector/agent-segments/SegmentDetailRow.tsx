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

function SegmentDetailRow({ item, isLast }: { item: SegmentDetailItem; isLast: boolean }) {
  const pillState = item.live
    ? ToolPillState.Active
    : item.failed
      ? ToolPillState.Error
      : ToolPillState.Default;

  return (
    <div className="flex w-full items-start gap-2" data-segment-key={item.key}>
      <div className="flex shrink-0 self-stretch flex-col items-center">
        <ToolPill size={ToolPillSize.Small} icon={item.config.icon} state={pillState} />
        {!isLast ? <div className="w-px min-h-0 flex-1 bg-[var(--color-border-tertiary)]" /> : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pb-6">
        <div className="flex w-full items-center gap-2">
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
