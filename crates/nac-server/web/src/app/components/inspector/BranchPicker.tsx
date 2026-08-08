import { useState } from "react";

import {
  Icon,
  IconName,
  Input,
  InputSize,
  Loader,
  LoaderSize,
  LoaderVariant,
  MessageBox,
  MessageBoxVariant,
  Popover,
  PopoverPlacement,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useBranches, useSwitchBranch } from "@/app/services/queries";
import { useRunning } from "@/app/store/runtimeStore";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

/** Why the picker will not act right now, or null when it is free to. */
function blockedReason(
  running: boolean,
  dirty: boolean,
  create: boolean,
): string | null {
  if (running) return "A run is in flight; wait for it to finish.";
  // A new branch carries uncommitted work along, so only leaving is a problem.
  if (dirty && !create) {
    return "Uncommitted changes: commit or stash them before switching.";
  }
  return null;
}

/**
 * One row of the panel. The label carries no type or colour of its own: at this
 * size the button already supplies both, and leaving them to it is what dims
 * the row properly once it is disabled.
 */
function Row({
  label,
  icon,
  active,
  disabled,
  title,
  onClick,
}: {
  label: React.ReactNode;
  icon: IconName;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  const isMobile = useIsMobile();
  return (
    <TabButton
      type="button"
      size={isMobile ? TabButtonSize.Large : TabButtonSize.Small}
      active={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <Icon iconName={icon} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate text-left">{label}</span>
    </TabButton>
  );
}

/** A line of panel status, with a spinner while something is in flight. */
function Status({
  busy,
  children,
}: {
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 p-1 label-micro text-basic-muted">
      {busy ? (
        <Loader size={LoaderSize.Small} variant={LoaderVariant.Neutral} />
      ) : null}
      {children}
    </div>
  );
}

/**
 * The branch chip in the box footer, opening a list of local branches with an
 * escape hatch for making a new one. Switching is refused while an agent could
 * be working in the checkout; the server enforces the same rules, because
 * another session may share this directory.
 */
export function BranchPicker({
  sessionId,
  branch,
}: {
  sessionId: string;
  branch: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const running = useRunning();
  const { data, isLoading, error } = useBranches(sessionId, open);
  const switchBranch = useSwitchBranch(sessionId);

  const close = () => {
    setOpen(false);
    setQuery("");
    switchBranch.reset();
  };

  const needle = query.trim();
  const branches = (data?.branches ?? []).filter((item) =>
    item.name.toLowerCase().includes(needle.toLowerCase()),
  );
  const exists = (data?.branches ?? []).some((item) => item.name === needle);
  const dirty = data?.dirty ?? false;

  // Neither refusal depends on which branch was clicked, only on what is being
  // asked of the checkout, so both are settled once for the whole panel.
  const createReason = blockedReason(running, dirty, true);
  const switchReason = blockedReason(running, dirty, false);
  const isMobile = useIsMobile();
  const act = (name: string, create: boolean) => {
    switchBranch.mutate({ name, create }, { onSuccess: close });
  };

  const failure = error
    ? errorMessage(error)
    : switchBranch.error
      ? errorMessage(switchBranch.error)
      : null;

  return (
    <Popover
      open={open}
      onClose={close}
      // The chip sits in the footer, so the panel has to grow upwards.
      placement={PopoverPlacement.TopRight}
      className="min-w-0"
      content={
        <div className="h-[calc(70dvh)] md:h-[280px] flex flex-col">
          <div className="p-4 pt-0 md:pb-2 md:px-0 flex flex-col gap-2 shrink-0">
            <Input
              autoFocus
              inputSize={isMobile ? InputSize.Large : InputSize.Small}
              placeholder="Find or create a branch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            {/* Directly under the field, because it acts on what was typed there
              rather than on anything in the list below. */}
            {needle && !exists && !error ? (
              <Row
                label={
                  <>
                    Create <span className="text-basic-primary">{needle}</span>
                  </>
                }
                icon={IconName.Add}
                disabled={Boolean(createReason)}
                title={createReason ?? undefined}
                onClick={() => act(needle, true)}
              />
            ) : null}
          </div>
          {isLoading ? (
            <div className="shrink-0">
              <Status busy>Reading branches…</Status>
            </div>
          ) : null}

          {!isLoading && !error ? (
            <div className="flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0">
              {branches.map((item) => {
                const reason = item.is_current ? null : switchReason;
                return (
                  <Row
                    key={item.name}
                    label={item.name}
                    icon={item.is_current ? IconName.Check : IconName.Scheme}
                    // The branch you are on is where the highlight goes, not a
                    // destination, so clicking it asks the server for nothing.
                    active={item.is_current}
                    disabled={Boolean(reason)}
                    title={reason ?? undefined}
                    onClick={
                      item.is_current ? () => {} : () => act(item.name, false)
                    }
                  />
                );
              })}
              {branches.length === 0 && !needle ? (
                <Status>No local branches.</Status>
              ) : null}
            </div>
          ) : null}

          {switchBranch.isPending ? (
            <div className="shrink-0">
              <Status busy>Working…</Status>
            </div>
          ) : null}

          {failure ? (
            <div className="shrink-0">
              <MessageBox variant={MessageBoxVariant.Error} title={failure} />
            </div>
          ) : null}

          {!failure && dirty && !running ? (
            <div className="shrink-0">
              <MessageBox
                variant={MessageBoxVariant.Info}
                title="Uncommitted changes: you can branch off them, but not switch away."
              />
            </div>
          ) : null}
        </div>
      }
    >
      <button
        type="button"
        className="flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost"
        aria-expanded={open}
        aria-label={`Branch: ${branch}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
        <span className="label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]">
          {branch}
        </span>
      </button>
    </Popover>
  );
}
