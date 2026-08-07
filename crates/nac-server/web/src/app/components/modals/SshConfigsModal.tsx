import { useMemo, useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
  Separator,
  TabButton,
  TabButtonSize,
  TabButtonVariant,
} from "@/app/atoms";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCreateSshConfig,
  useDeleteSshConfig,
  useSshConfigs,
  useSshConnect,
  useUpdateSshConfig,
} from "@/app/services/queries";
import type { SshConfigurationRecord } from "@/app/types/api";

const DRAFT = "__new__";

function nextDefaultName(configurations: SshConfigurationRecord[]): string {
  const taken = new Set(configurations.map((entry) => entry.name));
  let n = configurations.length + 1;
  while (taken.has(`SSH-config-${n}`)) n += 1;
  return `SSH-config-${n}`;
}

export function SshConfigsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return <SshConfigsManager open={open} onClose={onClose} />;
}

function SshConfigsManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useSshConfigs();
  const configurations = useMemo(() => data?.configurations ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? configurations.at(-1)?.config_id ?? DRAFT;
  const record =
    configurations.find((entry) => entry.config_id === selected) ?? null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SSH configs"
      size={ModalSize.Large}
      flush
      className="max-w-[780px] md:h-[480px]"
      bodyClassName="p-0 overflow-hidden"
    >
      <div className="flex flex-col md:flex-row items-stretch h-full min-h-0">
        <div className="flex flex-row md:flex-col shrink-0 gap-2 md:w-[240px] overflow-x-auto md:overflow-x-hidden md:overflow-y-auto border-b md:border-b-0 md:border-r border-muted px-2 py-2 md:py-4 [&>*]:shrink-0">
          <TabButton
            size={TabButtonSize.Medium}
            variant={TabButtonVariant.Regular}
            active={selected === DRAFT}
            onClick={() => setPicked(DRAFT)}
          >
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow truncate">Create New</span>
          </TabButton>
          {configurations.length ? (
            <Separator className="hidden md:block" />
          ) : null}
          {configurations.map((entry) => (
            <TabButton
              key={entry.config_id}
              size={TabButtonSize.Medium}
              active={selected === entry.config_id}
              onClick={() => setPicked(entry.config_id)}
            >
              <span className="text-left flex-grow truncate">{entry.name}</span>
            </TabButton>
          ))}
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-1">
              <Loader size={LoaderSize.Micro} />
              <span className="text-micro text-basic-muted">Loading…</span>
            </div>
          ) : null}
        </div>

        <SshConfigForm
          key={selected}
          record={record}
          defaultName={nextDefaultName(configurations)}
          onClose={onClose}
          onSaved={setPicked}
          onDeleted={() => setPicked(DRAFT)}
        />
      </div>
    </Modal>
  );
}

function SshConfigForm({
  record,
  defaultName,
  onClose,
  onSaved,
  onDeleted,
}: {
  record: SshConfigurationRecord | null;
  defaultName: string;
  onClose: () => void;
  onSaved: (configId: string) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const createConfig = useCreateSshConfig();
  const updateConfig = useUpdateSshConfig();
  const deleteConfig = useDeleteSshConfig();
  const connect = useSshConnect();

  const [name, setName] = useState(record?.name ?? defaultName);
  const [host, setHost] = useState(record?.ssh_host ?? "");
  const [port, setPort] = useState(
    record?.ssh_port ? String(record.ssh_port) : "",
  );
  const [identityFile, setIdentityFile] = useState(
    record?.ssh_identity_file ?? "",
  );

  const busy =
    createConfig.isPending ||
    updateConfig.isPending ||
    deleteConfig.isPending ||
    connect.isPending;

  const save = async () => {
    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    if (!trimmedName || !trimmedHost) {
      toast.error("Name and SSH host are required.");
      return;
    }
    const portValue = port.trim() ? Number(port.trim()) : null;
    if (
      port.trim() &&
      (!Number.isInteger(portValue) ||
        (portValue ?? 0) < 1 ||
        (portValue ?? 0) > 65535)
    ) {
      toast.error("Port must be an integer between 1 and 65535.");
      return;
    }
    try {
      if (!record) {
        const created = await createConfig.mutateAsync({
          name: trimmedName,
          ssh_host: trimmedHost,
          ssh_port: portValue,
          ssh_identity_file: identityFile.trim() || null,
        });
        onSaved(created.config_id);
        toast.success("SSH config saved.");
      } else {
        await updateConfig.mutateAsync({
          configId: record.config_id,
          payload: {
            name: trimmedName,
            ssh_host: trimmedHost,
            ssh_port: portValue,
            ssh_identity_file: identityFile.trim() || null,
          },
        });
        toast.success("SSH config updated.");
      }
    } catch (error) {
      toast.error(`Save failed: ${errorMessage(error)}`);
    }
  };

  const remove = async () => {
    if (!record) return;
    try {
      await deleteConfig.mutateAsync(record.config_id);
      onDeleted();
      toast.success("SSH config deleted.");
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`);
    }
  };

  const test = async () => {
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      toast.error("An SSH host is required to test.");
      return;
    }
    const portValue = port.trim() ? Number(port.trim()) : null;
    await connect.mutateAsync({
      ssh_host: trimmedHost,
      ssh_port: portValue,
      ssh_identity_file: identityFile.trim() || null,
    });
    toast.success("SSH connection succeeded.");
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex-1 overflow-auto p-4 [&>*]:shrink-0">
        <SshConnectionBox
          mode="manage"
          connection={null}
          onConnectionChange={() => undefined}
          name={name}
          onNameChange={setName}
          host={host}
          onHostChange={setHost}
          port={port}
          onPortChange={setPort}
          identityFile={identityFile}
          onIdentityFileChange={setIdentityFile}
          onTest={test}
          testing={connect.isPending}
          className="bg-elevation-level-2"
        />
      </div>
      <div className="flex items-center justify-between p-4 border-t border-muted shrink-0">
        {record ? (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.SecondaryDestructive}
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2.5">
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Ghost}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Primary}
            disabled={busy}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
