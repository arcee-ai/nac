import { Icon, IconName, Loader, LoaderSize } from "@/app/atoms";
import type { Validation } from "@/app/lib/apiKey";
import { cn } from "@/app/lib/cn";

/** Green tick, spinner or key, depending on how the key checked out. */
export function KeyStatus({ status }: { status: Validation["status"] }) {
  if (status === "validating") return <Loader size={LoaderSize.Micro} />;
  if (status === "ready") {
    return <Icon iconName={IconName.CheckCircle} size={16} className="text-success-primary" />;
  }
  return (
    <Icon
      iconName={status === "error" ? IconName.Danger : IconName.Key}
      size={16}
      className={cn(status === "error" ? "text-error-primary" : "text-basic-muted")}
    />
  );
}
