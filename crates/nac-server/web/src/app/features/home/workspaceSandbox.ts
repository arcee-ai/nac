import { csv, nullable } from "@/app/lib/modelConfig";
import type { SandboxRequest } from "@/app/types/api";

export interface SandboxOptions {
  noMount: boolean;
  image: string;
  gpu: string;
  workdir: string;
  shm: string;
  mounts: string;
}

export const EMPTY_SANDBOX: SandboxOptions = {
  noMount: false,
  image: "",
  gpu: "",
  workdir: "",
  shm: "",
  mounts: "",
};

export function sandboxRequest(options: SandboxOptions, activityKey: string): SandboxRequest {
  return {
    enabled: true,
    activity_key: activityKey,
    no_mount_cwd: options.noMount,
    image: nullable(options.image),
    gpus: csv(options.gpu),
    workdir: nullable(options.workdir),
    shm_size: nullable(options.shm),
    mounts: csv(options.mounts),
  };
}
