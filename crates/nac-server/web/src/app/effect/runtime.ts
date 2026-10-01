import { Context, Layer, ManagedRuntime } from "effect";

import { nacClient, type NacClient } from "@/app/services/nacClient";

/** Transport dependency for API programs. The React tree does not own this service. */
export class NacTransport extends Context.Service<NacTransport, NacClient>()("NacTransport") {}

const NacTransportLive = Layer.succeed(NacTransport, nacClient);

/**
 * One runtime for the page. React renders the UI; this runtime supplies the
 * transport and runs API programs across query and event boundaries.
 */
export const appRuntime = ManagedRuntime.make(NacTransportLive);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void appRuntime.dispose();
  });
}
