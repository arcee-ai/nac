import React, { useEffect, useState } from "react";
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

const VARIANT_STYLES = {
  [ToastVariant.Info]: "text-info-primary",
  [ToastVariant.Success]: "text-success-primary",
  [ToastVariant.Error]: "text-error-primary",
  [ToastVariant.Danger]: "text-danger-primary",
} satisfies Record<ToastVariant, string>;

const VARIANT_ICONS = {
  [ToastVariant.Info]: IconName.Info,
  [ToastVariant.Success]: IconName.CheckCircle,
  [ToastVariant.Error]: IconName.Danger,
  [ToastVariant.Danger]: IconName.Danger,
} satisfies Record<ToastVariant, IconName>;

const Toast: React.FC<ToastProps> = ({ content, variant, dismissing, onClose }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const isVisible = mounted && !dismissing;

  return (
    <div className="overflow-hidden">
      <div className="nac-toast w-full pointer-events-auto" data-visible={isVisible}>
        <div className="rounded-xl border border-tertiary bg-elevation-level-2 flex gap-3 items-start p-4 pr-14 relative text-basic-primary shadow-lg w-full">
          <Icon
            iconName={VARIANT_ICONS[variant]}
            size={20}
            className={`shrink-0 mt-0.5 ${VARIANT_STYLES[variant]}`}
          />
          <span
            role={
              variant === ToastVariant.Error || variant === ToastVariant.Danger ? "alert" : "status"
            }
            aria-atomic="true"
            className="flex-grow min-w-0 text-sm leading-5 break-words [overflow-wrap:anywhere] whitespace-pre-line"
          >
            {content}
          </span>
          <Button
            variant={Button.Variant.Ghost}
            content={Button.Content.Icon}
            className="absolute top-1 right-1 !size-11 shrink-0"
            aria-label="Dismiss notification"
            onClick={onClose}
          >
            <Icon iconName={IconName.Close} />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Toast;
