import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Input,
  InputSize,
} from "@/app/atoms";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useDeleteCredential,
  useStoreCredential,
  useStoredCredentials,
} from "@/app/services/queries";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Keeps an API key in NAC home under the same name the session uses for its
 * environment variable, so a key can be supplied without restarting the
 * process. The value is write-only: it can be replaced or removed but never
 * read back, and a variable present in the environment still takes precedence.
 */
export function StoredApiKey({
  name,
  isDisabled = false,
}: {
  name: string;
  isDisabled?: boolean;
}) {
  const trimmed = name.trim();
  const usable = !isDisabled && ENV_NAME_PATTERN.test(trimmed);
  const { data } = useStoredCredentials(usable);
  const save = useStoreCredential();
  const remove = useDeleteCredential();
  const toast = useToast();
  const [draft, setDraft] = useState("");

  const stored = data?.credentials.find((entry) => entry.name === trimmed) ?? null;
  const busy = save.isPending || remove.isPending;

  const onSave = async () => {
    if (!draft.trim()) return;
    try {
      await save.mutateAsync({ name: trimmed, value: draft });
      setDraft("");
      toast.success(`Key stored for ${trimmed}`);
    } catch (error) {
      toast.error(`Failed to store key: ${errorMessage(error)}`);
    }
  };

  const onRemove = async () => {
    try {
      await remove.mutateAsync(trimmed);
      toast.success(`Stored key for ${trimmed} removed`);
    } catch (error) {
      toast.error(`Failed to remove key: ${errorMessage(error)}`);
    }
  };

  const status = !usable
    ? "Name the environment variable first to store a key under it."
    : stored
      ? `Stored in NAC${
          stored.last_four ? ` (…${stored.last_four})` : ""
        }. The environment variable still wins when it is set.`
      : "Not stored. NAC reads the environment variable, or keep a key here instead.";

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2 w-full">
        <Input
          inputSize={InputSize.Small}
          className="flex-1 min-w-0"
          type="password"
          autoComplete="off"
          placeholder={stored ? "Replace stored key" : "Paste key to store"}
          value={draft}
          isDisabled={!usable || busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Secondary}
          content={ButtonContent.Text}
          disabled={!usable || !draft.trim()}
          loading={save.isPending}
          onClick={() => void onSave()}
        >
          Save
        </Button>
        {stored ? (
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.TertiaryDestructive}
            content={ButtonContent.Text}
            loading={remove.isPending}
            onClick={() => void onRemove()}
          >
            Remove
          </Button>
        ) : null}
      </div>
      <p className="text-micro text-basic-muted">{status}</p>
    </div>
  );
}
