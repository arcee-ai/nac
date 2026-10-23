import { useState } from "react";
import {
  Badge,
  BadgeColor,
  BoxSurface,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";

export function BadgesSection() {
  const [enabled, setEnabled] = useState(true);

  return (
    <BoxSurface title="Badges, loader, switch, tooltip">
      <div className="p-4 flex flex-wrap items-center gap-4">
        <Badge text="Running" color={BadgeColor.Green} />
        <Badge text="Queued" color={BadgeColor.Blue} />
        <Badge text="Failed" color={BadgeColor.Red} />
        <Badge text="Idle" color={BadgeColor.Gray} />
        <Loader size={LoaderSize.Small} />
        <Switch checked={enabled} onChange={setEnabled} />
        <Tooltip
          title="Pin session"
          description="Keeps the card at the top of the board."
          position={TooltipPosition.BottomCenter}
          sticky
          showTooltipOnMobile
        >
          <Icon iconName={IconName.Pin} />
        </Tooltip>
        <Icon iconName={IconName.Unpin} />
      </div>
    </BoxSurface>
  );
}
