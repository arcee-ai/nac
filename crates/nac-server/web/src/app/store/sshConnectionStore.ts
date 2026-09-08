import { createStore } from "@/app/lib/store";
import type { SshTarget } from "@/app/types/api";

/** Stable key for an SSH target so connect status can be shared across screens. */
export function sshTargetKey(target: SshTarget): string {
  return [
    target.ssh_host.trim(),
    target.ssh_port ?? "",
    (target.ssh_identity_file ?? "").trim(),
  ].join("\0");
}

export type SshConnectionStatus = "unknown" | "connected" | "disconnected";

interface SshConnectionState {
  /** Latest known status keyed by `sshTargetKey`. */
  byKey: Record<string, SshConnectionStatus>;
}

const store = createStore<SshConnectionState>({ byKey: {} }, "sshConnection");

export function markSshConnected(target: SshTarget) {
  const key = sshTargetKey(target);
  store.setState((state) => ({
    byKey: { ...state.byKey, [key]: "connected" },
  }));
}

export function markSshDisconnected(target: SshTarget) {
  const key = sshTargetKey(target);
  store.setState((state) => ({
    byKey: { ...state.byKey, [key]: "disconnected" },
  }));
}

export function useSshConnectionStatus(target: SshTarget | null): SshConnectionStatus {
  return store.useStore((state) => {
    if (!target?.ssh_host.trim()) return "unknown";
    return state.byKey[sshTargetKey(target)] ?? "unknown";
  });
}

export function sshTargetFromSummary(
  summary:
    | {
        ssh_host: string | null;
        ssh_port?: number | null;
        ssh_identity_file?: string | null;
      }
    | null
    | undefined,
): SshTarget | null {
  if (!summary?.ssh_host) return null;
  return {
    ssh_host: summary.ssh_host,
    ssh_port: summary.ssh_port ?? null,
    ssh_identity_file: summary.ssh_identity_file ?? null,
  };
}
