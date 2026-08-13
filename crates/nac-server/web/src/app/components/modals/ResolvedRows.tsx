import { Input, InputSize, Loader, LoaderSize, Separator } from "@/app/atoms";
import { ConfigRow, CONTROL_WIDTH } from "@/app/components/modals/ConfigRow";
import { KeyStatus } from "@/app/components/modals/KeyStatus";
import { PROTOCOL_ITEMS } from "@/app/components/modals/options";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { MASKED_KEY, modelItems } from "@/app/lib/apiKey";
import { providerUsesApiKey } from "@/app/lib/providers";
import type { BackendKind, ResolvedModelConfiguration } from "@/app/types/api";

/**
 * The same rows as a fresh setup, filled in from a configuration the server
 * resolved. Everything stays editable — an edit rides along with the session
 * being created and leaves the stored configuration alone — except the key,
 * which never leaves the server and so can only be shown as a stand-in.
 *
 * A provider that signs in through the browser has no credential row here: its
 * sign-in is an action rather than a field, and lives below the box.
 */
export function ResolvedRows({
  resolving,
  resolved,
  backend,
  onBackend,
  baseUrl,
  onBaseUrl,
  model,
  onModel,
  failed,
}: {
  resolving: boolean;
  resolved: ResolvedModelConfiguration | null;
  backend: BackendKind | null;
  onBackend: (backend: BackendKind) => void;
  baseUrl: string;
  onBaseUrl: (url: string) => void;
  model: string;
  onModel: (model: string) => void;
  failed: boolean;
}) {
  if (resolving) {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader size={LoaderSize.Micro} />
        <span className="text-micro text-basic-muted">
          Checking the key and reading the model list…
        </span>
      </div>
    );
  }
  if (!resolved || !backend) {
    return failed ? null : (
      <p className="text-micro text-basic-muted py-1">
        Pick a configuration to see its provider and models.
      </p>
    );
  }

  const usesKey = providerUsesApiKey(backend);
  // A setup the server could list models for is driven by its provider; one it
  // could not is a hand-written endpoint, so it spells out model and URL.
  const listed = resolved.models.length > 0;
  // A login that stopped answering leaves the list just as empty as a provider
  // with no index, so without the reason the rows would turn a broken sign-in
  // into a hand-written endpoint and quietly ask the user to type a model.
  const failedListing = Boolean(resolved.models_error);
  const modelChoices = listed
    ? modelItems(resolved.models)
    : model
      ? [{ id: model, label: model }]
      : [];

  return (
    <>
      <ConfigRow
        label="Model Provider"
        required
        hint="Service that provides the models for this session."
        control={
          <SmallSelect
            items={PROTOCOL_ITEMS}
            value={backend}
            onValueChange={(id) => onBackend(id as BackendKind)}
          />
        }
      />
      {usesKey ? (
        <>
          <Separator />
          <ConfigRow
            label="API Key"
            required
            hint="Held by NAC for this configuration; save a new setup to use a different key."
            control={
              <Input
                inputSize={InputSize.Medium}
                className={CONTROL_WIDTH}
                value={MASKED_KEY}
                isDisabled
                readOnly
                leadingSlot={<KeyStatus status="ready" />}
              />
            }
          />
        </>
      ) : null}
      <Separator />
      {listed || failedListing ? (
        <ConfigRow
          label="Default Model"
          invalid={failedListing}
          hint="The NAC session will start with this default and may switch to another."
          control={
            <SmallSelect
              items={failedListing ? [] : modelChoices}
              value={failedListing ? "" : model}
              onValueChange={onModel}
              disabled={failedListing}
              placeholder="–"
            />
          }
        />
      ) : (
        <>
          <ConfigRow
            label="Model"
            required
            hint="Model identifier the endpoint expects."
            control={
              <Input
                inputSize={InputSize.Medium}
                className={CONTROL_WIDTH}
                placeholder="gpt-5.5"
                value={model}
                onChange={(event) => onModel(event.target.value)}
              />
            }
          />
          <Separator />
          <ConfigRow
            label="Base URL"
            required
            hint="Endpoint the session sends its requests to."
            control={
              <Input
                inputSize={InputSize.Medium}
                className={CONTROL_WIDTH}
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
                onChange={(event) => onBaseUrl(event.target.value)}
              />
            }
          />
        </>
      )}
    </>
  );
}
