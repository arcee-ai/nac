import { useMemo, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
} from "@/app/atoms";
import { FormSection } from "@/app/components/modals/FormSection";
import { managedSecretNameError } from "@/app/features/managed/model";
import {
  useDeleteManagedSecret,
  useManagedSecrets,
  usePutManagedSecret,
} from "@/app/features/managed/queries";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";

export function ManagedSecretsPanel() {
  const secrets = useManagedSecrets();
  const put = usePutManagedSecret();
  const remove = useDeleteManagedSecret();
  const toast = useToast();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [attempted, setAttempted] = useState(false);
  // Every edit changes ownership, including editing back to the submitted text.
  const draftRevision = useRef(0);
  const validation = useMemo(
    () => (attempted ? managedSecretNameError(name) : ""),
    [attempted, name],
  );

  const save = async () => {
    setAttempted(true);
    const invalid = managedSecretNameError(name);
    if (invalid || value.length === 0) return;
    const submittedRevision = draftRevision.current;
    try {
      await put.mutateAsync({ name, value });
      if (draftRevision.current === submittedRevision) {
        draftRevision.current += 1;
        setName("");
        setValue("");
        setAttempted(false);
      }
      toast.success("Secret saved for future command spawns");
    } catch (error) {
      toast.error(`Secret was not saved: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="managed-secrets-settings">
      <FormSection
        title="Host secrets"
        description="Values are write-only and are injected into every newly spawned agent command on this single-owner host. Running processes keep their existing snapshot."
      >
        <div className="border-l-2 border-warning-primary pl-4 text-small !leading-[22px] text-basic-secondary">
          Agents have arbitrary shell access and can print injected values. Add only secrets trusted
          across every Project and agent on this host.
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            inputSize={InputSize.Large}
            label="Variable name"
            aria-label="Variable name"
            placeholder="SERVICE_TOKEN"
            value={name}
            onChange={(event) => {
              draftRevision.current += 1;
              setName(event.target.value);
              setAttempted(false);
            }}
            validation={Boolean(validation)}
            validationText={validation}
            autoCapitalize="none"
            spellCheck={false}
          />
          <Input
            inputSize={InputSize.Large}
            label="New value"
            aria-label="New value"
            placeholder="Write-only value"
            type="password"
            value={value}
            onChange={(event) => {
              draftRevision.current += 1;
              setValue(event.target.value);
            }}
            validation={attempted && value.length === 0}
            validationText="Enter a value."
            autoComplete="new-password"
          />
        </div>
        <div>
          <Button
            className="min-h-11"
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            onClick={() => void save()}
            loading={put.isPending}
          >
            Save secret
          </Button>
        </div>
      </FormSection>
      <FormSection
        title="Stored names"
        description="Saved values stay hidden. Removing a secret affects future command spawns."
        className="border-t border-basic pt-6"
      >
        {secrets.isLoading ? (
          <div role="status" className="flex items-center gap-3 text-small text-basic-secondary">
            <Loader size={LoaderSize.Small} />
            Loading stored names…
          </div>
        ) : null}
        {secrets.error ? (
          <p role="alert" className="text-small !leading-[22px] text-error-primary">
            Stored secret names are unavailable. {errorMessage(toRunError(secrets.error))}
          </p>
        ) : null}
        <div className="divide-y divide-basic">
          {secrets.data?.secrets.length === 0 ? (
            <p className="text-small !leading-[22px] text-basic-secondary">
              No host secrets saved.
            </p>
          ) : null}
          {secrets.data?.secrets.map((secret) => (
            <div key={secret.name} className="flex min-w-0 items-start gap-3 py-3">
              <Icon iconName={IconName.Key} />
              <div className="min-w-0 flex-1">
                <code className="break-all code-small text-basic-primary">{secret.name}</code>
                <p className="mt-1 text-small text-basic-secondary">value hidden</p>
              </div>
              <Button
                className="min-h-11 min-w-11"
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                aria-label={`Delete ${secret.name}`}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(secret.name);
                    toast.success(`${secret.name} removed from future command spawns`);
                  } catch (error) {
                    toast.error(`Secret was not removed: ${errorMessage(toRunError(error))}`);
                  }
                }}
                loading={remove.isPending}
              >
                <Icon iconName={IconName.Trash} />
              </Button>
            </div>
          ))}
        </div>
      </FormSection>
    </div>
  );
}
