// Compatibility barrel for feature-owned TanStack Query bindings.

export * from "@/app/services/queries/keys";
export * from "@/app/services/queries/host";
export * from "@/app/services/queries/direct";
export * from "@/app/services/queries/configuration";
export * from "@/app/services/queries/session";
export * from "@/app/services/queries/workspace";
export * from "@/app/services/queries/projects";

export {
  useDeleteManagedSecret,
  useManagedAuth,
  useManagedGitHub,
  useManagedHostStatus,
  useManagedProviderModels,
  useManagedSecrets,
  usePutManagedSecret,
  useReadyManagedProviderModels,
} from "@/app/features/managed/queries";
