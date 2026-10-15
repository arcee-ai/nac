import type { QueryClient } from "@tanstack/react-query";
import { api } from "../../services/api.js";
import { subscribeToSessionEvents } from "../../services/eventStream.js";
import type { ObservationPorts } from "./streamReconciliation.js";
/** Bind canonical cache, generation, and live projection adapters to one endpoint/cache. */
export declare function makeObservationPorts(client: QueryClient, id: string, adapters?: {
    readMessages: typeof api.getMessages;
    subscribe: typeof subscribeToSessionEvents;
}): ObservationPorts;
