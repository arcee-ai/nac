import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

export enum ChatSessionMessageVariant {
  Info = "info",
  Error = "error",
  Danger = "danger",
  Success = "success",
}

const variantBorders = {
  [ChatSessionMessageVariant.Info]: "border-info-primary text-info-primary",
  [ChatSessionMessageVariant.Error]: "border-error-primary text-error-primary",
  [ChatSessionMessageVariant.Danger]:
    "border-danger-primary text-danger-primary",
  [ChatSessionMessageVariant.Success]:
    "border-success-primary text-success-primary",
} satisfies Record<ChatSessionMessageVariant, string>;

const variantIcons = {
  [ChatSessionMessageVariant.Info]: IconName.Info,
  [ChatSessionMessageVariant.Error]: IconName.Close,
  [ChatSessionMessageVariant.Danger]: IconName.Danger,
  [ChatSessionMessageVariant.Success]: IconName.CheckCircle,
} satisfies Record<ChatSessionMessageVariant, IconName>;

const variantFills = {
  [ChatSessionMessageVariant.Info]: "var(--color-fill-info-primary)",
  [ChatSessionMessageVariant.Error]: "var(--color-fill-error-primary)",
  [ChatSessionMessageVariant.Danger]: "var(--color-fill-danger-primary)",
  [ChatSessionMessageVariant.Success]: "var(--color-fill-success-primary)",
} satisfies Record<ChatSessionMessageVariant, string>;

interface ChatSessionMessageProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: React.ReactNode;
  variant?: ChatSessionMessageVariant;
  /** Optional second line explaining the title. */
  children?: React.ReactNode;
  /** Optional way out of whatever the message reports. */
  action?: { label: string; onClick: () => void };
}

/**
 * What the transcript says when something happened to the run rather than in
 * it. Unlike `MessageBox` it carries no surface of its own — a coloured rule
 * down the left is the whole frame, so it reads as part of the conversation.
 */
const ChatSessionMessage: React.FC<ChatSessionMessageProps> & {
  Variant: typeof ChatSessionMessageVariant;
} = ({
  title,
  variant = ChatSessionMessageVariant.Info,
  action,
  className = "",
  children,
  ...props
}) => (
  <div
    className={cn(
      "flex w-full items-start overflow-hidden border-l-2 px-4 py-2",
      variantBorders[variant],
      className,
    )}
    {...props}
  >
    <div className="flex flex-1 min-w-0 flex-col items-start gap-2">
      <div className="flex w-full items-start gap-1.5">
        <Icon
          iconName={variantIcons[variant]}
          size={20}
          color={variantFills[variant]}
          className="shrink-0"
        />
        <p className="flex-1 min-w-0 header-sm break-words !my-0">{title}</p>
      </div>
      {children ? (
        <p className="w-full text-small break-words">{children}</p>
      ) : null}
      {action ? (
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Text}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  </div>
);

ChatSessionMessage.Variant = ChatSessionMessageVariant;

export default ChatSessionMessage;
