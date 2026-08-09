import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  ModalSize,
  StickyButton,
} from "@/app/atoms";
import { ConfigListNav } from "@/app/components/modals/ConfigListNav";
import { SshConnectionBox } from "@/app/components/modals/SshConnectionBox";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
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
  const isMobile = useIsMobile();
  const { data, isLoading } = useSshConfigs();
  const configurations = useMemo(() => data?.configurations ?? [], [data]);
  const [picked, setPicked] = useState<string | null>(null);
  const [footer, setFooter] = useState<ReactNode>(null);
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
      footer={footer}
    >
      <div className="flex flex-col md:flex-row items-stretch h-full min-h-0">
        <ConfigListNav
          draftLabel="Create New"
          draftSelected={selected === DRAFT}
          onSelectDraft={() => setPicked(DRAFT)}
          entries={configurations.map((entry) => ({
            id: entry.config_id,
            name: entry.name,
          }))}
          selectedId={selected}
          onSelect={setPicked}
          isLoading={isLoading}
        />

        <SshConfigForm
          key={selected}
          record={record}
          defaultName={nextDefaultName(configurations)}
          onClose={onClose}
          onSaved={setPicked}
          onDeleted={() => setPicked(DRAFT)}
          setFooter={setFooter}
          isMobile={isMobile}
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
  setFooter,
  isMobile,
}: {
  record: SshConfigurationRecord | null;
  defaultName: string;
  onClose: () => void;
  onSaved: (configId: string) => void;
  onDeleted: () => void;
  setFooter: (footer: ReactNode) => void;
  isMobile: boolean;
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

  const saveRef = useRef(save);
  const removeRef = useRef(remove);

  useLayoutEffect(() => {
    saveRef.current = save;
    removeRef.current = remove;
  });

  useLayoutEffect(() => {
    setFooter(
      <>
        {record ? (
          isMobile ? (
            <StickyButton
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </StickyButton>
          ) : (
            <Button
              size={ButtonSize.Large}
              variant={ButtonVariant.SecondaryDestructive}
              content={ButtonContent.Icon}
              className="mr-auto"
              disabled={busy}
              onClick={() => void removeRef.current()}
            >
              <Icon iconName={IconName.Trash} />
            </Button>
          )
        ) : null}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </StickyButton>
        ) : (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Ghost}
            onClick={onClose}
          >
            Cancel
          </Button>
        )}
        {isMobile ? (
          <StickyButton
            variant={ButtonVariant.Primary}
            content={ButtonContent.Text}
            disabled={busy}
            onClick={() => void saveRef.current()}
          >
            Save
          </StickyButton>
        ) : (
          <Button
            size={ButtonSize.Large}
            variant={ButtonVariant.Primary}
            disabled={busy}
            onClick={() => void saveRef.current()}
          >
            Save
          </Button>
        )}
      </>,
    );
    return () => setFooter(null);
  }, [busy, isMobile, onClose, record, setFooter]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div
        className={cn(
          "flex-1 overflow-auto p-4 [&>*]:shrink-0",
          isMobile && "pb-[88px]",
        )}
      >
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
    </div>
  );
}
