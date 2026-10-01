import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button, ButtonVariant } from "@/app/atoms";
import {
  ConfigurationsPanel,
  type ConfigurationsPanelInitial,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { PrimaryModelSection } from "@/app/components/modals/PrimaryModelSection";
import { ProviderConnections } from "@/app/features/managed/presentation/ProviderConnections";

/** Switching presentations preserves the full tuple without matching presets by model alone. */
export function ModelSetupSection({
  initial,
  onChange,
  invalid,
  errorText,
  children,
  simple = true,
  inheritSavedDefault = false,
}: {
  initial?: ConfigurationsPanelInitial;
  onChange: (selection: LaunchModelSelection | null, source: "primary" | "preset") => void;
  invalid: boolean;
  errorText?: string;
  children?: ReactNode;
  simple?: boolean;
  inheritSavedDefault?: boolean;
}) {
  const [advanced, setAdvanced] = useState(!simple);
  const [connections, setConnections] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const remembered = useRef<LaunchModelSelection | null>(null);
  const [seed, setSeed] = useState<ConfigurationsPanelInitial | undefined>(initial);
  const advancedChange = useCallback(
    (next: LaunchModelSelection | null) => {
      remembered.current = next;
      setHasDraft(next?.kind === "save");
      onChange(next, "preset");
    },
    [onChange],
  );
  const primaryChange = useCallback(
    (next: LaunchModelSelection | null) => {
      const previous = remembered.current;
      if (next?.kind === "resolved" && previous?.kind === "resolved") {
        const same =
          next.backend === previous.backend &&
          next.model === previous.model &&
          next.base_url === previous.base_url &&
          next.allow_insecure_http === previous.allow_insecure_http &&
          next.api_key_env === previous.api_key_env &&
          next.reasoning_effort === previous.reasoning_effort &&
          JSON.stringify(next.extra_headers) === JSON.stringify(previous.extra_headers);
        next = {
          ...next,
          light_model: previous.light_model,
          orchestrator_compaction_threshold: previous.orchestrator_compaction_threshold,
          config_id: same ? previous.config_id : undefined,
        };
      }
      remembered.current = next;
      setHasDraft(next?.kind === "save");
      onChange(next, "primary");
    },
    [onChange],
  );
  return (
    <div className="flex flex-col gap-3">
      {advanced ? (
        <ConfigurationsPanel initial={seed} invalid={invalid} onChange={advancedChange}>
          {children}
        </ConfigurationsPanel>
      ) : (
        <PrimaryModelSection
          inheritSavedDefault={inheritSavedDefault}
          initial={seed}
          onChange={primaryChange}
        />
      )}
      <Button
        variant={ButtonVariant.Secondary}
        aria-expanded={connections}
        onClick={() => setConnections((value) => !value)}
      >
        Provider connections
      </Button>
      {connections ? <ProviderConnections /> : null}
      <Button
        variant={ButtonVariant.Secondary}
        aria-expanded={advanced}
        onClick={() => {
          const selected = remembered.current;
          if (selected?.kind === "resolved")
            setSeed({ ...selected, extra_headers: selected.extra_headers ?? {} });
          // An unsaved provider setup cannot be projected into the catalog without losing its secret draft.
          if (selected?.kind === "save" && advanced) return;
          setAdvanced((value) => !value);
        }}
        disabled={advanced && hasDraft}
      >
        {advanced ? "Back to unified models" : "Advanced presets and provider setup"}
      </Button>
      {!advanced && children ? (
        <details className="text-micro">
          <summary className="cursor-pointer py-2">Advanced execution settings</summary>
          {children}
        </details>
      ) : null}
      {errorText ? (
        <p role="alert" className="text-micro text-error-primary">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
