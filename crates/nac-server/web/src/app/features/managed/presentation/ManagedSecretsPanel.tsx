import { useMemo, useState } from "react";

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
  Separator,
} from "@/app/atoms";
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
  const validation = useMemo(
    () => (attempted ? managedSecretNameError(name) : ""),
    [attempted, name],
  );

  const save = async () => {
    setAttempted(true);
    const invalid = managedSecretNameError(name);
    if (invalid || value.length === 0) return;
    try {
      await put.mutateAsync({ name, value });
      setName("");
      setValue("");
      setAttempted(false);
      toast.success("Secret saved for future command spawns");
    } catch (error) {
      toast.error(`Secret was not saved: ${errorMessage(toRunError(error))}`);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="managed-secrets-settings">
      <div>
        <p className="header-xl text-basic-primary">Host secrets</p>
        <p className="text-small text-basic-tertiary">
          Values are write-only and are injected into every newly spawned agent command on this
          single-owner host. Running processes keep their existing snapshot.
        </p>
      </div>
      <div className="rounded-lg border border-warning-primary p-4 text-small text-basic-secondary">
        Agents have arbitrary shell access and can print injected values. Add only secrets trusted
        across every Project and agent on this host.
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          inputSize={InputSize.Large}
          label="Variable name"
          aria-label="Variable name"
          placeholder="SERVICE_TOKEN"
          value={name}
          onChange={(event) => {
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
          onChange={(event) => setValue(event.target.value)}
          validation={attempted && value.length === 0}
          validationText="Enter a value."
          autoComplete="new-password"
        />
      </div>
      <div>
        <Button
          variant={ButtonVariant.Primary}
          content={ButtonContent.Text}
          onClick={() => void save()}
          loading={put.isPending}
        >
          Save secret
        </Button>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <p className="label-medium text-basic-primary">Stored names</p>
        {secrets.isLoading ? <Loader size={LoaderSize.Small} /> : null}
        {secrets.data?.secrets.length === 0 ? (
          <p className="text-small text-basic-tertiary">No host secrets saved.</p>
        ) : null}
        {secrets.data?.secrets.map((secret) => (
          <div
            key={secret.name}
            className="flex items-center gap-3 rounded-lg border border-basic p-3"
          >
            <Icon iconName={IconName.Key} />
            <code className="min-w-0 flex-1 truncate text-basic-primary">{secret.name}</code>
            <span className="text-small text-basic-muted">value hidden</span>
            <Button
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
    </div>
  );
}
