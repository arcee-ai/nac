import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button, ButtonVariant, Input, TextArea, Modal, ModalSize } from "@/app/atoms";
import { routes, sessionIdFromPath } from "@/app/lib/routes";
import { useTaskLaunch } from "./useTaskLaunch";
import type { LaunchModelSelection } from "@/app/features/setup/modelSelection";

const phases = {
  pinned: "Commit pinned",
  preparing_workspace: "Preparing isolated checkout",
  preparing_runtime: "Checking agent readiness",
  ready: "Task ready",
  failed: "Preparation failed — files retained",
  cancelled: "Cancelled — files retained",
};

export function TaskLaunchModal({
  projectId,
  model,
  defaultRef,
  onClose,
  onExistingCheckout,
  initialPrompt = "",
  initialTitle = "",
}: {
  projectId: string;
  model: LaunchModelSelection;
  defaultRef: string | null;
  onClose: () => void;
  onExistingCheckout: () => void;
  /** Home's composer text, carried in as the brief. */
  initialPrompt?: string;
  initialTitle?: string;
}) {
  const location = useLocation();
  const [title, setTitle] = useState(initialTitle);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [gitRef, setGitRef] = useState("");
  const [branch, setBranch] = useState(defaultRef ?? "");
  const launch = useTaskLaunch(projectId);
  const frozen = launch.intent !== null;
  return (
    <Modal open title="New isolated task" size={ModalSize.Wide} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-micro text-basic-muted">
          Start a direct agent in a retained Local Git checkout. Source edits are excluded. Your The
          selected session model applies. Repository setup remains the agent's first work.
        </p>
        {!launch.receipt && (
          <>
            <Input
              label="Task title"
              aria-label="Task title"
              value={title}
              maxLength={120}
              isDisabled={frozen}
              onChange={(e) => setTitle(e.target.value)}
            />
            <TextArea
              label="Initial brief"
              aria-label="Initial brief"
              rows={4}
              value={prompt}
              isDisabled={frozen}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Input
              label="Git ref (optional)"
              aria-label="Git ref (optional)"
              value={gitRef}
              isDisabled={frozen}
              onChange={(e) => setGitRef(e.target.value)}
              placeholder="Branch, tag, or commit"
            />
            <p className="text-micro text-basic-muted">
              An explicit ref wins. Otherwise use the invoking task's committed HEAD in this
              project, or the destination's saved default branch.
            </p>
            {!defaultRef && (
              <Input
                label="Save project default branch"
                aria-label="Save project default branch"
                value={branch}
                isDisabled={frozen}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="Exact configured branch"
              />
            )}
          </>
        )}
        {launch.error && (
          <p role="alert">
            {launch.error.message}
            {launch.intent && " Retry uses the same request identity."}
          </p>
        )}
        {!launch.receipt && (
          <Button
            variant={ButtonVariant.Primary}
            loading={launch.start.isPending}
            disabled={!title.trim() || !prompt.trim() || !branch.trim() || launch.start.isPending}
            onClick={() =>
              launch.launch({
                project_id: projectId,
                invoking_session_id: sessionIdFromPath(location.pathname),
                model_selection: {
                  backend: model.backend,
                  model: model.model,
                  base_url: model.base_url,
                  allow_insecure_http: model.allow_insecure_http,
                  api_key_env: model.api_key_env,
                  reasoning_effort: model.reasoning_effort,
                  extra_headers: model.extra_headers,
                  orchestrator_compaction_threshold:
                    model.orchestrator_compaction_threshold ?? null,
                },
                git_ref: gitRef.trim() || null,
                default_ref: defaultRef ? null : branch.trim(),
                title: title.trim(),
                prompt: prompt.trim(),
              })
            }
          >
            {frozen ? "Retry same request" : "Start isolated task"}
          </Button>
        )}
        {launch.intent && (launch.receipt || launch.start.error) && (
          <Button onClick={launch.newRequest}>Start another intentional task</Button>
        )}
        <Button onClick={onExistingCheckout} disabled={launch.start.isPending}>
          Use existing checkout
        </Button>
        <div aria-label="Retained task inventory" className="flex flex-col gap-3">
          {launch.inventory.error && <p role="alert">{launch.inventory.error.message}</p>}
          {launch.inventory.data?.map((record) => (
            <article key={record.request.request_id} className="rounded border p-3">
              <p className="font-medium">{record.request.title}</p>
              <p role="status">{phases[record.phase]}</p>
              <p className="break-all text-micro">
                {record.source.selected_ref} → {record.source.commit}
              </p>
              <p className="break-all text-micro">
                {record.workspace_path}
                {record.source.subdirectory ? `/${record.source.subdirectory}` : ""}
              </p>
              <p className="text-micro">
                Source edits excluded. Checkout retained after completion, cancellation, or task
                deletion.
              </p>
              {record.error && (
                <p role="alert" className="break-words">
                  {record.error}
                </p>
              )}
              {record.first_input_id != null && !record.session_present && (
                <p>Task removed — checkout retained.</p>
              )}
              {record.session_present && (
                <Link onClick={onClose} to={routes.session(record.session_id)}>
                  Open task
                </Link>
              )}
              {record.phase !== "ready" && record.phase !== "cancelled" && (
                <Button
                  onClick={() => launch.retry(record.request)}
                  disabled={launch.start.isPending}
                >
                  Resume same request
                </Button>
              )}
              {record.phase !== "cancelled" && (
                <Button
                  onClick={() => launch.cancel.mutate(record.request.request_id)}
                  disabled={launch.cancel.isPending}
                >
                  Cancel preparation or current run
                </Button>
              )}
            </article>
          ))}
        </div>
      </div>
    </Modal>
  );
}
