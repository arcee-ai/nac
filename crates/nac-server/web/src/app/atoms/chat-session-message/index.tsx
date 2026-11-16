import type React from "react";

import { cn } from "../../lib/cn";
import { buttonVariants } from "../../ui/button";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

export enum ChatSessionMessageVariant {
  Info = "info",
  Error = "error",
  Danger = "danger",
  Success = "success",
}

/** A hairline card ruled in its signal; info stays neutral ink, since blue means a link. */
const variantSurfaces = {
  [ChatSessionMessageVariant.Info]: "border-tertiary bg-elevation-level-1",
  [ChatSessionMessageVariant.Error]: "border-[var(--f-red-line)] bg-elevation-level-1",
  [ChatSessionMessageVariant.Danger]: "border-[var(--f-amber-line)] bg-elevation-level-1",
  [ChatSessionMessageVariant.Success]: "border-[var(--f-green-line)] bg-elevation-level-1",
} satisfies Record<ChatSessionMessageVariant, string>;

const variantTitles = {
  [ChatSessionMessageVariant.Info]: "text-basic-primary",
  [ChatSessionMessageVariant.Error]: "text-[var(--f-red-text)]",
  [ChatSessionMessageVariant.Danger]: "text-[var(--f-amber-text)]",
  [ChatSessionMessageVariant.Success]: "text-[var(--f-green-text)]",
} satisfies Record<ChatSessionMessageVariant, string>;

const variantIcons = {
  [ChatSessionMessageVariant.Info]: IconName.Info,
  [ChatSessionMessageVariant.Error]: IconName.Close,
  [ChatSessionMessageVariant.Danger]: IconName.Danger,
  [ChatSessionMessageVariant.Success]: IconName.CheckCircle,
} satisfies Record<ChatSessionMessageVariant, IconName>;

const variantFills = {
  [ChatSessionMessageVariant.Info]: "var(--color-fill-basic-tertiary)",
  [ChatSessionMessageVariant.Error]: "var(--color-fill-error-primary)",
  [ChatSessionMessageVariant.Danger]: "var(--color-fill-danger-primary)",
  [ChatSessionMessageVariant.Success]: "var(--color-fill-success-primary)",
} satisfies Record<ChatSessionMessageVariant, string>;

export type ChatSessionMessageAction =
  | { label: string; onClick: () => void }
  | { label: string; href: string };

interface ChatSessionMessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  variant?: ChatSessionMessageVariant;
  /** Optional second line explaining the title. */
  children?: React.ReactNode;
  /** Optional way out of whatever the message reports. */
  action?: ChatSessionMessageAction;
}

/**
 * What the transcript says when something happened to the run rather than in
 * it: a quiet surface card whose hairline and title carry its signal — red
 * failed, amber needs you, green done, neutral information — so it is seen
 * without shouting.
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
      "flex w-full items-start overflow-hidden rounded-card border px-4 py-3",
      variantSurfaces[variant],
      className,
    )}
    {...props}
  >
    <div className="flex flex-1 min-w-0 flex-col items-start gap-1.5">
      <div className="flex w-full items-start gap-2">
        <Icon
          iconName={variantIcons[variant]}
          size={16}
          color={variantFills[variant]}
          className="mt-0.5 shrink-0"
        />
        <p className={cn("flex-1 min-w-0 type-strong break-words !my-0", variantTitles[variant])}>
          {title}
        </p>
      </div>
      {children ? (
        <div className="w-full pl-6 type-body-chrome text-basic-secondary break-words">
          {children}
        </div>
      ) : null}
      {action && "href" in action ? (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({
              size: ButtonSize.Small,
              variant: ButtonVariant.Primary,
              content: ButtonContent.Text,
            }),
            "mt-1 ml-6",
          )}
        >
          {action.label}
        </a>
      ) : action ? (
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Text}
          className="mt-1 ml-6"
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
