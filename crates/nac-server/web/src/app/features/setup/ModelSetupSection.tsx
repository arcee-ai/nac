import { useCallback, useRef, useState, type ReactNode } from "react";

import { Button, ButtonVariant } from "@/app/atoms";
import {
  ConfigurationsPanel,
  type ConfigurationsPanelInitial,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { FormSection } from "@/app/components/modals/FormSection";
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
  existingSession = false,
}: {
  initial?: ConfigurationsPanelInitial;
  onChange: (selection: LaunchModelSelection | null, source: "primary" | "preset") => void;
  invalid: boolean;
  errorText?: string;
  children?: ReactNode;
  simple?: boolean;
  inheritSavedDefault?: boolean;
  existingSession?: boolean;
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
    <div className="flex flex-col gap-6">
      {advanced ? (
        <ConfigurationsPanel initial={seed} invalid={invalid} onChange={advancedChange}>
          {children}
        </ConfigurationsPanel>
      ) : (
        <PrimaryModelSection
          inheritSavedDefault={inheritSavedDefault}
          existingSession={existingSession}
          initial={seed}
          onChange={primaryChange}
        />
      )}
      <FormSection
        title="Connection & advanced options"
        className="max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_button]:max-w-full max-md:[&_button]:!whitespace-normal max-md:[&_button]:!h-auto max-md:[&_button]:!py-3 max-md:[&_button>span]:min-w-0 max-md:[&_button>span]:break-words max-md:[&_section[aria-label]_div]:min-w-0 max-md:[&_section[aria-label]_div]:max-w-full max-md:[&_section[aria-label]_div.flex.items-center.gap-2]:flex-wrap"
        description="Use provider connections to sign in, or open advanced setup for saved presets and custom endpoints."
      >
        <div className="flex flex-col items-stretch gap-2 md:flex-row md:flex-wrap">
          <Button
            className="min-h-11 md:min-h-9"
            variant={ButtonVariant.Secondary}
            aria-expanded={connections}
            onClick={() => setConnections((value) => !value)}
          >
            Provider connections
          </Button>
          <Button
            className="min-h-11 md:min-h-9"
            variant={ButtonVariant.Ghost}
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
        </div>
        {connections ? <ProviderConnections /> : null}
        {advanced && hasDraft ? (
          <p className="text-small !leading-[22px] text-basic-secondary">
            Finish this provider setup before switching back to unified models. Your unsaved key
            stays in this form.
          </p>
        ) : null}
      </FormSection>
      {!advanced && children ? (
        <details className="border-t border-muted pt-4 text-small">
          <summary className="flex min-h-11 cursor-pointer items-center py-2 label-small text-basic-primary">
            Advanced execution settings
          </summary>
          {children}
        </details>
      ) : null}
      {errorText ? (
        <p role="alert" className="text-small !leading-[22px] text-error-primary">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
