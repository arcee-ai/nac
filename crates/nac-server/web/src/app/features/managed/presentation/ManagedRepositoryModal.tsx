import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { FormSection } from "@/app/components/modals/FormSection";
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
import { githubErrorText } from "./managedErrorText";

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
  const { api } = useNativeRuntime();

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
  const [connectionRecovery, setConnectionRecovery] = useState<"checking" | "refreshing" | null>(
    null,
  );
  const [recoveryOpen, setRecoveryOpen] = useState(open);
  const recoveryOwner = useRef(0);

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

  const connectionReady = github.data?.connected === true && !github.error;
  const dependentReadsSucceeded =
    repositories.isSuccess && (identity === null || branches.isSuccess);
  const dependentReadsIdle =
    repositories.fetchStatus === "idle" && (identity === null || branches.fetchStatus === "idle");
  const checkoutReady =
    connectionReady &&
    dependentReadsSucceeded &&
    (connectionRecovery === null || (connectionRecovery === "refreshing" && dependentReadsIdle));

  if (recoveryOpen !== open) {
    setRecoveryOpen(open);
    setConnectionRecovery(null);
  }

  if (connectionRecovery === "refreshing" && connectionReady && dependentReadsIdle) {
    setConnectionRecovery(null);
  }

  useEffect(
    () => () => {
      recoveryOwner.current += 1;
    },
    [open],
  );

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
  }, [operation, navigate, onClose, queryClient, toast, api]);

  const visibleRepositories = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = repositories.data?.repositories ?? [];
    return needle
      ? all.filter((repository) => repository.full_name.toLowerCase().includes(needle))
      : all;
  }, [repositories.data, search]);

  const retryConnection = async () => {
    const owner = ++recoveryOwner.current;
    setConnectionRecovery("checking");
    const result = await github.refetch();
    if (recoveryOwner.current !== owner) return;
    if (result.error || result.data?.connected !== true) {
      setConnectionRecovery(null);
      return;
    }
    const refresh = Promise.all([
      queryClient.refetchQueries({
        queryKey: ["managed-github-repositories"],
        exact: true,
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: ["managed-github-branches", selected?.full_name],
        exact: true,
        type: "active",
      }),
    ]);
    setConnectionRecovery("refreshing");
    await refresh;
  };

  const start = async () => {
    if (!checkoutReady || !selected || !branch || !destination.trim() || !projectName.trim())
      return;
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
  const branchError = branches.error ? githubErrorText(branches.error) : null;

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Add repository"
      size={ModalSize.Large}
      flush
      className="h-[min(760px,calc(100vh-32px))] max-md:[&>header_.btn-sticky]:min-h-11 max-md:[&>header_.btn-sticky]:min-w-11 max-md:[&>header_div:has(>.btn-sticky)]:min-h-11"
      bodyClassName="min-h-0 pb-32 md:pb-0"
      footer={
        operation?.status === "running" ? (
          <Button
            className="min-h-11"
            variant={ButtonVariant.SecondaryDestructive}
            content={ButtonContent.Text}
            onClick={() => void cancel()}
          >
            Cancel clone
          </Button>
        ) : (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button
              className="min-h-11"
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.Text}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              className="min-h-11"
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={() => void start()}
              disabled={
                !checkoutReady || !selected || !branch || !destination.trim() || !projectName.trim()
              }
              loading={starting}
            >
              Clone repository
            </Button>
          </div>
        )
      }
    >
      <div
        className="flex h-full min-h-0 flex-col gap-6 overflow-auto p-4 md:p-6"
        data-testid="managed-repository-modal"
      >
        {github.isPending ? (
          <div role="status" className="flex items-center gap-3 text-small text-basic-secondary">
            <Loader size={LoaderSize.Small} /> Checking GitHub connection…
          </div>
        ) : github.error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 text-small text-error-primary"
          >
            <p>{githubErrorText(github.error)}</p>
            <Button
              className="min-h-11"
              variant={ButtonVariant.Secondary}
              content={ButtonContent.Text}
              onClick={() => void retryConnection()}
              loading={github.isFetching}
            >
              Retry connection check
            </Button>
          </div>
        ) : !github.data?.connected ? (
          <div className="flex flex-col items-start gap-4">
            <div>
              <p className="label-medium text-basic-primary">
                Connect GitHub to browse Arcee repositories
              </p>
              <p className="text-small !leading-[22px] text-basic-secondary">
                You can still create a Project through NAC&apos;s existing local or SSH flow.
              </p>
            </div>
            <Button
              className="min-h-11"
              variant={ButtonVariant.Primary}
              content={ButtonContent.Text}
              onClick={onConnect}
            >
              Connect GitHub
            </Button>
          </div>
        ) : null}

        {connectionReady && dependentReadsIdle && !dependentReadsSucceeded ? (
          <Button
            className="min-h-11 self-start"
            variant={ButtonVariant.Secondary}
            content={ButtonContent.Text}
            onClick={() => void retryConnection()}
            loading={connectionRecovery === "checking"}
          >
            Retry repository checks
          </Button>
        ) : null}

        {connectionReady && !operation ? (
          <>
            <FormSection
              title="Repository"
              description="Choose a repository available to this GitHub connection."
            >
              <Input
                inputSize={InputSize.Large}
                label="Find repository"
                aria-label="Find repository"
                placeholder="Search accessible repositories"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1">
                {repositories.isFetching ? (
                  <div
                    role="status"
                    className="flex items-center gap-3 p-4 text-small text-basic-secondary"
                  >
                    <Loader size={LoaderSize.Small} /> Loading repositories…
                  </div>
                ) : null}
                {!repositories.isFetching && repositories.error ? (
                  <p role="alert" className="p-4 text-small !leading-[22px] text-error-primary">
                    {githubErrorText(repositories.error)}
                  </p>
                ) : null}
                {visibleRepositories.map((repository) => (
                  <button
                    key={repository.id}
                    type="button"
                    aria-pressed={selected?.id === repository.id}
                    className={`grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded p-3 text-left sm:flex sm:gap-3 ${selected?.id === repository.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`}
                    onClick={() => {
                      setSelected(repository);
                      setBranch(repository.default_branch);
                      setDestination(repository.name);
                      setProjectName(repository.name);
                      setError("");
                    }}
                  >
                    <Icon
                      iconName={repository.private ? IconName.Lock : IconName.Github}
                      aria-hidden="true"
                    />
                    <span className="col-span-2 row-start-2 min-w-0 sm:flex-1">
                      <span className="block label-small text-basic-primary break-words">
                        {repository.full_name}
                      </span>
                      <span className="block text-small !leading-[22px] text-basic-secondary break-words">
                        Default branch: {repository.default_branch}
                      </span>
                    </span>
                    {selected?.id === repository.id ? (
                      <Icon
                        iconName={IconName.CheckCircle}
                        aria-hidden="true"
                        className="col-start-2 row-start-1 justify-self-end"
                      />
                    ) : null}
                  </button>
                ))}
                {!repositories.isFetching && visibleRepositories.length === 0 ? (
                  <p className="p-4 text-small !leading-[22px] text-basic-secondary">
                    No repositories match.
                  </p>
                ) : null}
              </div>
            </FormSection>
            {selected ? (
              <FormSection
                title="Checkout"
                description="Choose the branch and where this Project will live on the host."
                className="border-t border-basic pt-6"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ManagedBranchPicker
                    key={selected.full_name}
                    branches={branches.data?.branches ?? []}
                    value={branch}
                    onValueChange={setBranch}
                    isLoading={
                      branches.isLoading || (connectionRecovery !== null && branches.isFetching)
                    }
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
              </FormSection>
            ) : null}
          </>
        ) : null}

        {operation ? (
          <div className="flex flex-col gap-4 border-t border-basic pt-4">
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
                <p role="status" className="label-medium text-basic-primary capitalize">
                  Clone {operation.status}
                </p>
                <p className="text-small !leading-[22px] text-basic-secondary break-all">
                  {operation.repository} · {operation.branch}
                </p>
              </div>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary">
              {operation.progress || "Preparing clone…"}
            </pre>
            {operation.error ? (
              <p role="alert" className="text-small !leading-[22px] text-error-primary">
                {operation.error}
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-small !leading-[22px] text-error-primary">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
