import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { nullable } from "@/app/lib/modelConfig";
import { routes } from "@/app/lib/routes";
import { useToast } from "@/app/providers/ToastProvider";
import { SourceFolders, type SourceFolder } from "@/app/features/setup/SourceFolders";
import { SetupFailure, setupSequence } from "@/app/features/setup/workflow";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import { useCreateProject, useStoreInfo } from "@/app/services/queries";

/** Remounted on every open so the form always starts empty. */
export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: storeInfo } = useStoreInfo();
  const mounted = useExitTransition(open);
  if (!mounted) return null;
  return (
    <CreateProjectForm
      // The exit transition briefly retains the form after close. Keying the
      // two phases guarantees a rapid reopen still starts fresh.
      key={open ? "open" : "closing"}
      open={open}
      defaultCwd={storeInfo?.root_cwd ?? ""}
      onClose={onClose}
    />
  );
}

/**
 * A project is a name and the folders it works in. The model, behavior and
 * environment of each chat are chosen when that chat starts, so creating a
 * project hands off to the project's empty-state composer.
 */
function CreateProjectForm({
  open,
  defaultCwd,
  onClose,
}: {
  open: boolean;
  defaultCwd: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const action = useSetupAction(open);
  const client = useQueryClient();
  const createProject = useCreateProject();
  const isMobile = useIsMobile();

  const [name, setName] = useState("");
  const [folders, setFolders] = useState<SourceFolder[]>([]);
  const [error, setError] = useState<{ folders: boolean; message: string } | null>(null);

  const busy = action.busy;
  const primary = folders[0] ?? null;

  const submit = async () => {
    if (action.needsReview || busy || !primary) return;
    try {
      const project = await action.run((lease) =>
        setupSequence(
          {
            current: lease.current,
            classify: classifySetupFailure,
            reconcile: setupReconciliation(client),
          },
          (step) =>
            step("project", () =>
              // TODO(backend): a project stores exactly one folder today. Send
              // every folder once projects own a folder list.
              createProject.mutateAsync({
                name: nullable(name),
                cwd: primary.path,
                ssh_host: primary.ssh?.ssh_host ?? null,
                ssh_port: primary.ssh?.ssh_port ?? null,
                ssh_identity_file: primary.ssh?.ssh_identity_file ?? null,
                default_model_config_id: null,
              }),
            ),
        ),
      );
      if (!project) return;
      toast.success("Project created");
      navigate(routes.project(project.project_id));
      onClose();
    } catch (createError) {
      setError({
        folders: createError instanceof SetupFailure && createError.kind === "rejected",
        message: setupFailureMessage(createError),
      });
    }
  };

  const size = isMobile ? ButtonSize.Large : ButtonSize.Medium;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create project"
      size={ModalSize.Medium}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            variant={ButtonVariant.Ghost}
            size={size}
            content={ButtonContent.Text}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant={ButtonVariant.Primary}
            size={size}
            content={ButtonContent.Text}
            onClick={submit}
            loading={busy}
            disabled={busy || action.needsReview || Boolean(error) || !primary}
          >
            Create project
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6 [&>*]:shrink-0">
        <Input
          aria-label="Project name"
          inputSize={InputSize.Large}
          leading={InputLeading.Icon}
          leadingIconName={IconName.Folder}
          placeholder="Project name"
          hintText="Optional. Defaults to the first folder's Git repo or folder name."
          autoFocus
          value={name}
          isDisabled={busy}
          onChange={(e) => {
            setError(null);
            setName(e.target.value);
          }}
        />

        <section className="flex flex-col gap-2" aria-labelledby="source-folders-heading">
          <h3 id="source-folders-heading" className="label-small text-basic-primary">
            Source folders
          </h3>
          <SourceFolders
            folders={folders}
            defaultCwd={defaultCwd}
            invalid={error?.folders ?? false}
            disabled={busy}
            onChange={(next) => {
              setError(null);
              setFolders(next);
            }}
          />
          {folders.length > 1 ? (
            <p className="text-micro text-basic-muted">
              Only the first folder is saved for now. Projects with several folders need backend
              support.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-error-primary text-small !leading-[22px]">
              {error.message}
            </p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}
