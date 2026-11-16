import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

/** Kept above the panel so loading, failures and an empty list never hide the way back. */
export function InsightsReturnButton({ sessionId }: { sessionId: string }) {
  const available = useNativeRuntime().stores.sessionLayoutStore.useInsightsReturn(sessionId);
  const navigation = useInsightsNavigation();
  if (!available) return null;
  return (
    <div className="flex shrink-0 items-center border-b border-muted px-2 py-1">
      <Button
        size={ButtonSize.Medium}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.IconLeft}
        className="!min-h-11"
        onClick={(event) => navigation.returnToInsights({ focusDetail: event.detail === 0 })}
      >
        <Icon iconName={IconName.Left} />
        Back to Insights
      </Button>
    </div>
  );
}
