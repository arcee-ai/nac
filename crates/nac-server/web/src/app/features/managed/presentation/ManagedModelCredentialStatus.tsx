import { Icon, IconName } from "@/app/atoms";
import { ConfigRow } from "@/app/components/modals/ConfigRow";
import { cn } from "@/app/lib/cn";

export function ManagedModelCredentialStatus({ ready }: { ready: boolean }) {
  return (
    <ConfigRow
      label="Credential"
      verticalOnMobile
      hint="This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands."
      control={
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4",
            ready ? "bg-success-secondary" : "bg-error-tertiary",
          )}
        >
          <Icon
            iconName={ready ? IconName.CheckCircle : IconName.Repair}
            className={ready ? "text-success-primary" : "text-error-primary"}
          />
          <span
            className={cn("label-small", ready ? "text-success-primary" : "text-error-primary")}
          >
            {ready ? "Detected" : "Host needs attention"}
          </span>
        </div>
      }
    />
  );
}
