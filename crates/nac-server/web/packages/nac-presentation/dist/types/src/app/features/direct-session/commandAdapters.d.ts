import type { QueryClient } from "@tanstack/react-query";
import type { stopRun } from "./commandWorkflow";
/** Restore only optimistic objects still owned by this request; keep newer reads/events. */
export declare function makeStopPorts(client: QueryClient, id: string): Parameters<typeof stopRun>[0];
