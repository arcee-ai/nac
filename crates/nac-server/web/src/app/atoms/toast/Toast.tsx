import React, { useEffect, useRef, useState } from "react";
import Icon, { IconName } from "../icon";
import Button from "../button";

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
  [ToastVariant.Info]: "bg-info-inverse",
  [ToastVariant.Success]: "bg-success-inverse",
  [ToastVariant.Error]: "bg-error-inverse",
  [ToastVariant.Danger]: "bg-danger-inverse",
} satisfies Record<ToastVariant, string>;

const VARIANT_ICONS = {
  [ToastVariant.Info]: IconName.Info,
  [ToastVariant.Success]: IconName.CheckCircle,
  [ToastVariant.Error]: IconName.Danger,
  [ToastVariant.Danger]: IconName.Danger,
} satisfies Record<ToastVariant, IconName>;

const Toast: React.FC<ToastProps> = ({ content, variant, dismissing, onClose }) => {
  const [mounted, setMounted] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const isVisible = mounted && !dismissing;

  return (
    <div ref={nodeRef} className="overflow-hidden">
      <div
        className="rounded-[4px] max-w-[360px] w-full pointer-events-auto"
        style={{
          transform: isVisible ? "translateY(0)" : "translateY(-100%)",
          transition: "transform 150ms ease-out",
        }}
      >
        <div
          className={[
            "rounded-[4px] flex gap-2 items-start p-3 pr-12 label-small relative text-notification shadow-2xl overflow-hidden w-[360px]",
            VARIANT_STYLES[variant],
          ].join(" ")}
        >
          <Icon
            iconName={VARIANT_ICONS[variant]}
            size={20}
            className="flex-shrink-0 mt-[2px] min-w-[20px] min-h-[20px] max-w-[20px] max-h-[20px] [&>path]:fill-notification"
          />
          <span className="notification-title label-small flex-grow min-w-0 break-words whitespace-pre-line">
            {content}
          </span>
          <Button
            variant={Button.Variant.Ghost}
            content={Button.Content.Icon}
            className="absolute top-1 right-1 btn-icon-rotate flex-shrink-0"
            onClick={onClose}
          >
            {/* Beat `.btn-ghost .icon path { fill: … }` from atoms.css. */}
            <Icon iconName={IconName.Close} className="[&>path]:!fill-notification" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Toast;
