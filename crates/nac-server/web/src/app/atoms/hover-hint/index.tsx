import type React from "react";
import { AnchorPlacement } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Tooltip from "../tooltip";

export enum HoverHintSize {
  Small = 16,
  Medium = 20,
  Large = 24,
}

interface HoverHintProps {
  title: string;
  description?: string;
  size?: HoverHintSize;
  position?: AnchorPlacement;
  className?: string;
  /** Quieter glyph. Overrides the fill buttons apply to every icon. */
  muted?: boolean;
}

/** Info glyph that explains a nearby control on hover. */
const HoverHint: React.FC<HoverHintProps> & { Size: typeof HoverHintSize } = ({
  title,
  description,
  size = HoverHintSize.Small,
  position = AnchorPlacement.TopCenter,
  className = "",
  muted = false,
}) => (
  <Tooltip
    title={title}
    description={description}
    position={position}
    sticky
    showTooltipOnMobile
    className={className}
  >
    <Icon
      iconName={IconName.Info}
      size={size}
      className={cn("cursor-help shrink-0", muted && "[&>path]:!fill-basic-muted")}
      color={muted ? undefined : "var(--color-fill-basic-tertiary)"}
    />
  </Tooltip>
);

HoverHint.Size = HoverHintSize;

export default HoverHint;
