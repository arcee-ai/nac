import { useCallback, useState, type ReactNode } from "react";

import { Button, ButtonVariant } from "@/app/atoms";
import type {
  SessionModelInitial,
  LaunchModelSelection,
} from "@/app/features/setup/modelSelection";
import { FormSection } from "@/app/components/modals/FormSection";
import { PrimaryModelSection } from "@/app/components/modals/PrimaryModelSection";
import { ProviderConnections } from "@/app/features/managed/presentation/ProviderConnections";

/** A session chooses its model; provider connections are shared separately. */
export function ModelSetupSection({
  initial,
  onChange,
  errorText,
  children,
  existingSession = false,
}: {
  initial?: SessionModelInitial;
  onChange: (selection: LaunchModelSelection | null) => void;
  invalid: boolean;
  errorText?: string;
  children?: ReactNode;
  existingSession?: boolean;
}) {
  const [seed] = useState(initial);
  const [connections, setConnections] = useState(false);
  const change = useCallback((next: LaunchModelSelection | null) => onChange(next), [onChange]);
  return (
    <div className="flex flex-col gap-6">
      <PrimaryModelSection initial={seed} existingSession={existingSession} onChange={change} />
      <FormSection title="Provider connections" description="Connect an account to use its models.">
        <Button
          variant={ButtonVariant.Secondary}
          className="max-md:min-h-11"
          aria-expanded={connections}
          onClick={() => setConnections((value) => !value)}
        >
          Provider connections
        </Button>
        {connections ? <ProviderConnections /> : null}
      </FormSection>
      {children ? (
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
