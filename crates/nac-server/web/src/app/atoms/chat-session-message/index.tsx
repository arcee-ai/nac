import type React from "react";
import { useId, useState } from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";

export enum ChatSessionMessageVariant {
  Info = "info",
  Error = "error",
  Danger = "danger",
  Success = "success",
}

const variantSurfaces = {
  [ChatSessionMessageVariant.Info]: "bg-info-secondary text-info-primary",
  [ChatSessionMessageVariant.Error]: "bg-error-secondary text-error-primary",
  [ChatSessionMessageVariant.Danger]: "bg-danger-secondary text-danger-primary",
  [ChatSessionMessageVariant.Success]: "bg-success-secondary text-success-primary",
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

/**
 * Info keeps the neutral secondary button and Error its destructive one; the
 * warning and success toggles take the message's own colour, which the
 * unlayered button rules only yield to with `!`.
 */
const diagnosticToggles = {
  [ChatSessionMessageVariant.Info]: {
    variant: ButtonVariant.Secondary,
    className: "",
  },
  [ChatSessionMessageVariant.Error]: {
    variant: ButtonVariant.SecondaryDestructive,
    className: "",
  },
  [ChatSessionMessageVariant.Danger]: {
    variant: ButtonVariant.Secondary,
    className: "!text-danger-primary [&_.icon]:!text-fill-danger-primary",
  },
  [ChatSessionMessageVariant.Success]: {
    variant: ButtonVariant.Secondary,
    className: "!text-success-primary [&_.icon]:!text-fill-success-primary",
  },
} satisfies Record<ChatSessionMessageVariant, { variant: ButtonVariant; className: string }>;

interface ChatSessionMessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  variant?: ChatSessionMessageVariant;
  /** Optional second line explaining the title. */
  children?: React.ReactNode;
  /** Raw detail behind the message, folded under a "Diagnostic" toggle. */
  diagnostic?: React.ReactNode;
  /** Optional way out of whatever the message reports. */
  action?: { label: string; onClick: () => void };
}

/**
 * What the transcript says when something happened to the run rather than in
 * it: a rounded card tinted with its variant's colour, so it stands apart from
 * the conversation without the weight of a bordered `MessageBox`.
 *
 * A folded diagnostic stays mounted while hidden, so the alert's text content
 * still carries it.
 */
const ChatSessionMessage: React.FC<ChatSessionMessageProps> & {
  Variant: typeof ChatSessionMessageVariant;
} = ({
  title,
  variant = ChatSessionMessageVariant.Info,
  diagnostic,
  action,
  className = "",
  children,
  ...props
}) => {
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const diagnosticId = useId();
  const toggle = diagnosticToggles[variant];

  return (
    <div
      className={cn(
        "flex w-full items-start overflow-hidden rounded-[16px] p-4",
        variantSurfaces[variant],
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 min-w-0 flex-col items-start gap-4">
        <div className="flex w-full items-start gap-1.5">
          <Icon
            iconName={variantIcons[variant]}
            size={20}
            color={variantFills[variant]}
            className="shrink-0"
          />
          <p className="flex-1 min-w-0 header-sm break-words !my-0">{title}</p>
        </div>
        {children ? <div className="w-full text-small break-words">{children}</div> : null}
        {diagnostic ? (
          <div className="flex w-full flex-col items-start gap-2">
            <Button
              size={ButtonSize.Small}
              variant={toggle.variant}
              content={ButtonContent.IconRight}
              aria-expanded={diagnosticOpen}
              aria-controls={diagnosticId}
              className={toggle.className}
              onClick={() => setDiagnosticOpen((open) => !open)}
            >
              Diagnostic
              <Icon iconName={diagnosticOpen ? IconName.Top : IconName.Down} size={16} />
            </Button>
            <pre
              id={diagnosticId}
              hidden={!diagnosticOpen}
              className="w-full !my-0 whitespace-pre-wrap break-words font-mono text-xs"
            >
              {diagnostic}
            </pre>
          </div>
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
};

ChatSessionMessage.Variant = ChatSessionMessageVariant;

export default ChatSessionMessage;
