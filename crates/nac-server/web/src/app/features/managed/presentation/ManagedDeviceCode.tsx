import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { useCopyToClipboard } from "@/app/hooks/useCopyToClipboard";
import type { DeviceLoginStarted } from "@/app/types/api";

/**
 * The code a pending provider sign-in asks the user to type on the provider's
 * page, with the three things they can do about it: copy it, open the page,
 * or give up. Copy places exactly the code shown here on the clipboard and says
 * through a live region whether that worked, so the outcome is heard as well
 * as seen and a denied clipboard leaves the user knowing to copy by hand.
 */
export function ManagedDeviceCode({
  prompt,
  label,
  onCancel,
}: {
  prompt: DeviceLoginStarted;
  label: string;
  onCancel: () => void;
}) {
  const { outcome, copy } = useCopyToClipboard();
  const code = prompt.user_code;

  return (
    <div className="flex flex-col items-stretch md:items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Loader size={LoaderSize.XSmall} />
        {code ? (
          <>
            <span className="text-micro text-basic-muted">Code</span>
            <span
              className="label-small text-basic-primary tabular-nums select-all"
              data-testid="provider-device-code"
            >
              {code}
            </span>
            <Button
              variant={ButtonVariant.Secondary}
              size={ButtonSize.Medium}
              content={ButtonContent.IconLeft}
              onClick={() => copy(code)}
            >
              <Icon iconName={outcome === "copied" ? IconName.Check : IconName.FileCopy} />
              <span>Copy code</span>
            </Button>
          </>
        ) : (
          <span className="text-micro text-basic-muted">Waiting for the browser</span>
        )}
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.IconRight}
          onClick={() => window.open(prompt.verification_uri, "_blank", "noopener,noreferrer")}
        >
          <span>Open {label}</span>
          <Icon iconName={IconName.External} />
        </Button>
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Text}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          outcome === "failed" ? "text-micro text-error-primary" : "text-micro text-success-primary"
        }
      >
        {outcome === "copied"
          ? "Code copied"
          : outcome === "failed"
            ? "Couldn't copy the code. Select it and copy it by hand."
            : ""}
      </p>
    </div>
  );
}
