import { useState } from "react";
import { Modal, ModalSize } from "@/app/atoms";
import { ConfigRow } from "@/app/components/modals/ConfigRow";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import type {
  PublicNacModelConfiguration,
  PublicNacSessionConfig,
} from "../../../../packages/nac-client/src/publicNative.generated.js";
import { usePublicModelCatalog, usePublicModelConfigs, usePublicSessionConfig } from "./queries";

type ModelDetails = Pick<
  PublicNacSessionConfig,
  | "model"
  | "provider_kind"
  | "reasoning_effort"
  | "light_model"
  | "orchestrator_compaction_threshold"
>;

/** Public settings are a distinct projection, never a raw configuration with invented defaults. */
function ConfigurationDetails({ config }: { config: ModelDetails }) {
  const catalog = usePublicModelCatalog();
  const model = catalog.data?.providers
    .find((provider) => provider.provider_kind === config.provider_kind)
    ?.models.find((entry) => entry.id === config.model);
  return (
    <div className="flex flex-col gap-4">
      <ConfigRow label="Model" control={<span>{model?.display_name || config.model}</span>} />
      {config.provider_kind ? (
        <ConfigRow label="Provider" control={<span>{config.provider_kind}</span>} />
      ) : null}
      <ConfigRow
        label="Reasoning effort"
        control={<span>{config.reasoning_effort ?? "Default"}</span>}
      />
      {model ? (
        <ConfigRow label="Context window" control={<span>{model.context_window} tokens</span>} />
      ) : null}
      {"orchestrator_compaction_threshold" in config ? (
        <ConfigRow
          label="Context limit"
          control={
            <span>
              {config.orchestrator_compaction_threshold === null
                ? "Disabled"
                : `${config.orchestrator_compaction_threshold} tokens`}
            </span>
          }
        />
      ) : null}
      {config.light_model ? (
        <>
          <ConfigRow label="Light model" control={<span>{config.light_model.model}</span>} />
          <ConfigRow
            label="Light model reasoning effort"
            control={<span>{config.light_model.reasoning_effort ?? "Default"}</span>}
          />
        </>
      ) : null}
    </div>
  );
}

export function PublicSessionSettings({
  open,
  id,
  onClose,
}: {
  open: boolean;
  id: string | null;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  const config = usePublicSessionConfig(mounted ? id : null);
  if (!mounted || !id) return null;
  return (
    <Modal open={open} onClose={onClose} title="Session settings" size={ModalSize.Wide}>
      {config.isPending ? (
        <p role="status">Loading session configuration…</p>
      ) : config.data ? (
        <>
          {config.data.diagnostic_codes.length ? (
            <p role="alert">This configuration needs attention.</p>
          ) : null}
          <ConfigurationDetails config={config.data} />
        </>
      ) : (
        <p role="alert">Session configuration could not be loaded.</p>
      )}
    </Modal>
  );
}

export function PublicModelConfigurations({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return <PublicConfigurationList open={open} onClose={onClose} />;
}

function PublicConfigurationList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const configurations = usePublicModelConfigs();
  const [selected, setSelected] = useState<string | null>(null);
  const record: PublicNacModelConfiguration | undefined =
    configurations.data?.find((entry) => entry.config_id === selected) ?? configurations.data?.[0];
  return (
    <Modal open={open} onClose={onClose} title="Configurations" size={ModalSize.Large}>
      {configurations.isPending ? (
        <p role="status">Loading configurations…</p>
      ) : configurations.isError ? (
        <p role="alert">Configurations could not be loaded.</p>
      ) : record ? (
        <div className="flex flex-col gap-6">
          <SmallSelect
            items={(configurations.data ?? []).map((entry) => ({
              id: entry.config_id,
              label: entry.name,
            }))}
            value={record.config_id}
            onValueChange={setSelected}
          />
          <ConfigurationDetails config={record} />
        </div>
      ) : (
        <p>No saved configurations.</p>
      )}
    </Modal>
  );
}
