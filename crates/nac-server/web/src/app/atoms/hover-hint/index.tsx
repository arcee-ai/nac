import type React from "react";
import { AnchorPlacement } from "../../lib/anchor";
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
}

/** Info glyph that explains a nearby control on hover. */
const HoverHint: React.FC<HoverHintProps> & { Size: typeof HoverHintSize } = ({
  title,
  description,
  size = HoverHintSize.Small,
  position = AnchorPlacement.TopCenter,
  className = "",
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
      className="cursor-help shrink-0"
      color="var(--color-fill-basic-tertiary)"
    />
  </Tooltip>
);

HoverHint.Size = HoverHintSize;

export default HoverHint;
