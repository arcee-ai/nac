import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { nacClient, type NacClient } from "@/app/services/nacClient";
import type { UiPolicy } from "./policy";
import { UiPolicyContext } from "./UiPolicyContext";

// Client identity also fences a changed credential/adapter at the same URL.
const clientIds = new WeakMap<NacClient, number>();
let nextClientId = 0;
function clientId(client: NacClient) {
  let id = clientIds.get(client);
  if (id === undefined) {
    id = ++nextClientId;
    clientIds.set(client, id);
  }
  return id;
}

/** No creation or orchestration surface mounts until this endpoint's policy settles. */
export function UiPolicyProvider({
  children,
  client = nacClient,
}: {
  children: ReactNode;
  client?: NacClient;
}) {
  const config = useQuery({
    queryKey: ["ui-configuration", client.transport.endpoint, clientId(client)],
    queryFn: async ({ signal }) => {
      const value = await client.getUiConfiguration(signal);
      if (
        typeof value.orchestration_enabled !== "boolean" ||
        (value.diagnostic !== null && typeof value.diagnostic !== "string")
      ) {
        throw new Error("Invalid UI configuration response");
      }
      return value;
    },
    retry: false,
    staleTime: Infinity,
  });
  const policy = useMemo<UiPolicy>(
    () => ({ orchestrationEnabled: config.data?.orchestration_enabled === true }),
    [config.data],
  );
  if (config.isPending)
    return (
      <div role="status" className="p-8">
        Loading workspace configuration…
      </div>
    );
  if (config.isError)
    return (
      <div role="alert" className="p-8">
        Workspace configuration could not be loaded.{" "}
        <button onClick={() => void config.refetch()}>Try again</button>
      </div>
    );
  return (
    <UiPolicyContext.Provider value={policy}>
      {config.data.diagnostic ? (
        <div role="alert" className="p-3">
          {config.data.diagnostic}
        </div>
      ) : null}
      {children}
    </UiPolicyContext.Provider>
  );
}
