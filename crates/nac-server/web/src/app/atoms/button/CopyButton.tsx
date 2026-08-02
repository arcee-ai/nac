import type React from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { AnchorPlacement } from "../../lib/anchor";
import Icon, { IconName } from "../icon";
import Tooltip from "../tooltip";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "./index";

interface CopyButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  /** Text placed on the clipboard when the button is pressed. */
  value: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  content?: ButtonContent;
  position?: AnchorPlacement;
  /** Label shown in the tooltip before anything is copied. */
  title?: string;
  onCopy?: () => void;
  children?: React.ReactNode;
}

/** Copies a string and acknowledges it in the tooltip for a couple of seconds. */
const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  size = ButtonSize.Small,
  variant = ButtonVariant.Tertiary,
  content = ButtonContent.Icon,
  position = AnchorPlacement.BottomCenter,
  title = "Copy",
  onCopy,
  className = "",
  children,
  ...props
}) => {
  const { copied, copy } = useCopyToClipboard();
  const label = copied ? "Copied" : title;

  return (
    <Tooltip title={label} position={position} sticky>
      <Button
        size={size}
        variant={variant}
        content={content}
        className={className}
        aria-label={label}
        onClick={() => {
          copy(value);
          onCopy?.();
        }}
        {...props}
      >
        {children ?? (
          <Icon
            iconName={copied ? IconName.Check : IconName.FileCopy}
            className="fade"
          />
        )}
      </Button>
    </Tooltip>
  );
};

export default CopyButton;
