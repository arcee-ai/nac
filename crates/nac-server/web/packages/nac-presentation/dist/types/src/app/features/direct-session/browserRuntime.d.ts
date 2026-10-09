import { type ObservationPorts } from "./streamReconciliation";
/** Acquire one activation synchronously so StrictMode cleanup precedes reacquisition. */
export declare function openSessionObservation(ports: ObservationPorts): () => void;
