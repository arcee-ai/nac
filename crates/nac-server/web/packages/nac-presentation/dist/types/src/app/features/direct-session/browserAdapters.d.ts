import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { subscribeToSessionEvents } from "../../services/eventStream";
import type { ObservationPorts } from "./streamReconciliation";
/** Bind canonical cache, generation, and live projection adapters to one endpoint/cache. */
export declare function makeObservationPorts(client: QueryClient, id: string, adapters?: {
    readMessages: typeof api.getMessages;
    subscribe: typeof subscribeToSessionEvents;
}): ObservationPorts;
