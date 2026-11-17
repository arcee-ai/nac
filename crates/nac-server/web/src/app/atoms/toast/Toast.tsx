import React, { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Button from "../button";
import "./toast.css";

export enum ToastVariant {
  Info = "info",
  Success = "success",
  Error = "error",
  Danger = "danger",
}

interface ToastProps {
  content: React.ReactNode | string;
  variant: ToastVariant;
  dismissing: boolean;
  onClose: () => void;
}

/**
 * Info and success are an ink chip (the inverse surface); an error or a
 * needs-you notice is a raised surface whose text carries the signal colour,
 * so it is read as different before it is read at all.
 */
const SURFACE = {
  [ToastVariant.Info]: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
  [ToastVariant.Success]: "nac-toast-ink bg-elevation-ground-inverse text-primary-inverse",
  [ToastVariant.Error]: "bg-elevation-level-3 text-error-primary",
  [ToastVariant.Danger]: "bg-elevation-level-3 text-basic-primary",
} satisfies Record<ToastVariant, string>;

const ICON_TONE = {
  [ToastVariant.Info]: "text-secondary-inverse",
  [ToastVariant.Success]: "text-secondary-inverse",
  [ToastVariant.Error]: "text-error-primary",
  [ToastVariant.Danger]: "text-danger-tertiary",
} satisfies Record<ToastVariant, string>;

const VARIANT_ICONS = {
  [ToastVariant.Info]: IconName.Info,
  [ToastVariant.Success]: IconName.CheckCircle,
  [ToastVariant.Error]: IconName.Danger,
  [ToastVariant.Danger]: IconName.Danger,
} satisfies Record<ToastVariant, IconName>;

/** A small floating pill: 13px, one icon, the message and a quiet dismiss. */
const Toast: React.FC<ToastProps> = ({ content, variant, dismissing, onClose }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const isVisible = mounted && !dismissing;
  const urgent = variant === ToastVariant.Error || variant === ToastVariant.Danger;

  return (
    <div
      className="nac-toast pointer-events-none flex w-full justify-center"
      data-visible={isVisible}
    >
      <div
        className={cn(
          "nac-toast-content pointer-events-auto relative flex max-w-full items-start gap-2 rounded-sheet py-1.5 pr-1.5 pl-3.5 shadow-lg",
          SURFACE[variant],
        )}
      >
        <Icon
          iconName={VARIANT_ICONS[variant]}
          size={16}
          className={cn("mt-[6px] shrink-0", ICON_TONE[variant])}
        />
        <span
          role={urgent ? "alert" : "status"}
          aria-atomic="true"
          className="nac-toast-message type-body-chrome min-w-0 flex-grow py-[4px] break-words [overflow-wrap:anywhere] whitespace-pre-line"
        >
          {content}
        </span>
        <Button
          variant={Button.Variant.Ghost}
          size={Button.Size.Small}
          content={Button.Content.Icon}
          className="nac-toast-dismiss !size-7 shrink-0 max-md:!size-11 max-md:-my-2 max-md:-mr-1"
          aria-label="Dismiss notification"
          onClick={onClose}
        >
          <Icon iconName={IconName.Close} />
        </Button>
      </div>
    </div>
  );
};

export default Toast;
