import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { useManagedSignIn } from "@/app/hooks/useManagedSignIn";
import { modelItems } from "@/app/lib/apiKey";
import { cn } from "@/app/lib/cn";
import { providerLabel, providerUsesApiKey } from "@/app/lib/providers";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useManagedProviderModels,
  useStoredKeyProviderModels,
  useUpdateConfig,
} from "@/app/services/queries";
import type { BackendKind, SessionMetadata } from "@/app/types/api";

/**
 * The model the session runs, switched from the composer rather than from the
 * settings modal. The list is the same one those forms show — whatever the
 * session's own credential reaches — so the provider is only asked while the
 * panel is open.
 */
export function ModelPicker({
  sessionId,
  metadata,
  label,
  disabled,
}: {
  sessionId: string;
  metadata: SessionMetadata | null;
  /** What the status bar shows while the snapshot carries no metadata yet. */
  label: string;
  /** A run is in flight, and the server refuses a config change until it ends. */
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const updateConfig = useUpdateConfig();

  const backend = (metadata?.backend ?? "") as BackendKind;
  const usesKey = providerUsesApiKey(backend);
  const { provider, signedIn } = useManagedSignIn(backend);

  const keyQuery = useStoredKeyProviderModels(
    backend,
    metadata?.api_key_env ?? "",
    metadata?.base_url || null,
    open && usesKey,
  );
  const loginQuery = useManagedProviderModels(
    backend,
    open && !usesKey && signedIn,
  );
  const query = usesKey ? keyQuery : loginQuery;

  const current = metadata?.model ?? label;
  const listed = modelItems(query.data?.models ?? []);
  // A model configured earlier may no longer be listed — a renamed or retired
  // one still has to show as what the session runs today.
  const items =
    !current || listed.some((item) => item.id === current)
      ? listed
      : [...listed, { id: current, label: current }];

  const choose = async (model: string) => {
    setOpen(false);
    if (!metadata || model === metadata.model) return;
    try {
      await updateConfig.mutateAsync({ id: sessionId, patch: { model } });
      toast.success(`Model switched to ${model}`);
    } catch (error) {
      toast.error(`The model was not switched: ${errorMessage(error)}`);
    }
  };

  const rows = query.isFetching ? (
    <div className="flex items-center gap-2 px-2 py-1">
      <Loader size={LoaderSize.Micro} />
      <span className="text-micro text-basic-muted">
        Reading the model list…
      </span>
    </div>
  ) : query.isError ? (
    <p className="px-2 py-1 text-micro text-error-primary">
      {errorMessage(query.error)}
    </p>
  ) : items.length === 0 ? (
    <p className="px-2 py-1 text-micro text-basic-muted">
      {provider && !signedIn
        ? "This provider signs in through the browser; sign in from the session settings to list its models."
        : "No models offered."}
    </p>
  ) : (
    items.map((item) => (
      <TabButton
        key={item.id}
        size={TabButtonSize.Small}
        variant={TabButtonVariant.Regular}
        active={item.id === current}
        onClick={() => void choose(item.id)}
      >
        <span className="text-left flex-grow truncate">{item.label}</span>
      </TabButton>
    ))
  );

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.TopRight}
      size="min-w-[240px]"
      sticky
      className="shrink-0 min-w-0"
      panelClassName="max-h-[280px] overflow-auto"
      content={
        <>
          <div className="px-1 py-1 code code-micro text-basic-tertiary truncate">
            {providerLabel(backend) || "Model"}
          </div>
          {rows}
        </>
      }
    >
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.IconLeft}
        disabled={disabled || !metadata}
        aria-label="Model"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon iconName={IconName.Brain} />
        <span className="label-micro truncate max-w-[200px]">{current}</span>
        <Icon
          iconName={IconName.Down}
          className={cn(
            "transition-transform duration-300 ease-in-out",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </Button>
    </Popover>
  );
}
