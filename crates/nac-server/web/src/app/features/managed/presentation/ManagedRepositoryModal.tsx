import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  Modal,
  ModalSize,
} from "@/app/atoms";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { cloneIsRunning, repositoryIdentity } from "@/app/features/managed/model";
import { ManagedBranchPicker } from "@/app/features/managed/presentation/ManagedBranchPicker";
import {
  managedQueryKeys,
  useManagedGitHub,
  useManagedHostStatus,
} from "@/app/features/managed/queries";
import { routes } from "@/app/lib/routes";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { ManagedCloneOperation, ManagedGitHubRepository } from "@/app/types/api";

export function ManagedRepositoryModal({
  open,
  onClose,
  onConnect,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const host = useManagedHostStatus();
  const github = useManagedGitHub(open);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ManagedGitHubRepository | null>(null);
  const [branch, setBranch] = useState("");
  const [destination, setDestination] = useState("");
  const [projectName, setProjectName] = useState("");
  const [operation, setOperation] = useState<ManagedCloneOperation | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const repositories = useQuery({
    queryKey: ["managed-github-repositories"],
    queryFn: ({ signal }) => api.listManagedGitHubRepositories(signal),
    enabled: open && github.data?.connected === true,
    retry: false,
  });
  const identity = repositoryIdentity(selected?.full_name);
  const branches = useQuery({
    queryKey: ["managed-github-branches", selected?.full_name],
    queryFn: ({ signal }) => api.listManagedGitHubBranches(identity![0], identity![1], signal),
    enabled: open && identity !== null,
    retry: false,
  });

  useEffect(() => {
    if (!operation || !cloneIsRunning(operation)) return undefined;
    let stopped = false;
    const controller = new AbortController();
    const poll = async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          const next = await api.getManagedClone(operation.operation_id, controller.signal);
          setOperation(next);
          if (next.status !== "running") {
            if (next.status === "completed") {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
                queryClient.invalidateQueries({ queryKey: managedQueryKeys.hostStatus }),
              ]);
              toast.success(`${next.project_name} is ready`);
              onClose();
              navigate(routes.project(next.project_id));
            }
            return;
          }
        } catch (pollError) {
          if (!controller.signal.aborted) setError(humanErrorText(toRunError(pollError)));
          return;
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [operation, navigate, onClose, queryClient, toast]);

  const visibleRepositories = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = repositories.data?.repositories ?? [];
    return needle
      ? all.filter((repository) => repository.full_name.toLowerCase().includes(needle))
      : all;
  }, [repositories.data, search]);

  const start = async () => {
    if (!selected || !branch || !destination.trim() || !projectName.trim()) return;
    setStarting(true);
    setError("");
    try {
      setOperation(
        await api.startManagedClone({
          repository_id: selected.id,
          repository: selected.full_name,
          branch,
          destination: destination.trim(),
          project_name: projectName.trim(),
          project_description: null,
        }),
      );
    } catch (startError) {
      setError(humanErrorText(toRunError(startError)));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!operation || !cloneIsRunning(operation)) return;
    try {
      setOperation(await api.cancelManagedClone(operation.operation_id));
    } catch (cancelError) {
      setError(errorMessage(toRunError(cancelError)));
    }
  };

  const busy = starting || cloneIsRunning(operation);
  const branchError = branches.error ? humanErrorText(toRunError(branches.error)) : null;

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Add repository"
      size={ModalSize.Large}
      flush
      className="h-[min(760px,calc(100vh-32px))]"
      footer={
        operation?.status === "running" ? (
          <Button
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={() => void cancel()}
          >
            Cancel clone
          </Button>
        ) : (
          <>
            <Button variant={ButtonVariant.Tertiary} content={ButtonContent.Text} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={() => void start()}
              disabled={!selected || !branch || !destination.trim() || !projectName.trim()}
              loading={starting}
            >
              Clone repository
            </Button>
          </>
        )
      }
    >
      <div
        className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 md:p-6"
        data-testid="managed-repository-modal"
      >
        {!github.data?.connected ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-basic p-4">
            <div>
              <p className="label-medium text-basic-primary">
                Connect GitHub to browse Arcee repositories
              </p>
              <p className="text-small text-basic-tertiary">
                You can still create a Project through NAC&apos;s existing local or SSH flow.
              </p>
            </div>
            <Button
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={onConnect}
            >
              Connect GitHub
            </Button>
          </div>
        ) : null}

        {github.data?.connected && !operation ? (
          <>
            <Input
              inputSize={InputSize.Large}
              label="Find repository"
              aria-label="Find repository"
              placeholder="Search accessible repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1">
              {repositories.isLoading ? (
                <div className="p-4">
                  <Loader size={LoaderSize.Small} />
                </div>
              ) : null}
              {repositories.error ? (
                <p className="p-4 text-small text-error-primary">
                  {humanErrorText(toRunError(repositories.error))}
                </p>
              ) : null}
              {visibleRepositories.map((repository) => (
                <button
                  key={repository.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded p-3 text-left ${selected?.id === repository.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`}
                  onClick={() => {
                    setSelected(repository);
                    setBranch(repository.default_branch);
                    setDestination(repository.name);
                    setProjectName(repository.name);
                    setError("");
                  }}
                >
                  <Icon iconName={repository.private ? IconName.Lock : IconName.Github} />
                  <span className="min-w-0 flex-1">
                    <span className="block label-small text-basic-primary truncate">
                      {repository.full_name}
                    </span>
                    <span className="block text-small text-basic-tertiary">
                      Default branch: {repository.default_branch}
                    </span>
                  </span>
                  {selected?.id === repository.id ? <Icon iconName={IconName.CheckCircle} /> : null}
                </button>
              ))}
              {!repositories.isLoading && visibleRepositories.length === 0 ? (
                <p className="p-4 text-small text-basic-tertiary">No repositories match.</p>
              ) : null}
            </div>
            {selected ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ManagedBranchPicker
                  key={selected.full_name}
                  branches={branches.data?.branches ?? []}
                  value={branch}
                  onValueChange={setBranch}
                  isLoading={branches.isLoading}
                  error={branchError}
                />
                <Input
                  inputSize={InputSize.Large}
                  label="Project name"
                  aria-label="Project name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
                <Input
                  className="sm:col-span-2"
                  inputSize={InputSize.Large}
                  label="Checkout directory"
                  aria-label="Checkout directory"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  hintText={`${host.data?.repository_root ?? "Repository root"}/${destination || "directory"}`}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {operation ? (
          <div className="flex flex-col gap-4 rounded-lg border border-basic p-4">
            <div className="flex items-center gap-3">
              {operation.status === "running" ? (
                <Loader size={LoaderSize.Small} />
              ) : (
                <Icon
                  iconName={
                    operation.status === "completed" ? IconName.CheckCircle : IconName.Danger
                  }
                />
              )}
              <div>
                <p className="label-medium text-basic-primary capitalize">{operation.status}</p>
                <p className="text-small text-basic-tertiary break-all">
                  {operation.repository} · {operation.branch}
                </p>
              </div>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary">
              {operation.progress || "Preparing clone…"}
            </pre>
            {operation.error ? (
              <p className="text-small text-error-primary">{operation.error}</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-small text-error-primary">{error}</p> : null}
      </div>
    </Modal>
  );
}
