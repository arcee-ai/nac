import type { NativeRuntimeScope } from "./nativeRuntime";

const fields = ["owner", "profile", "organization", "host", "incarnation", "release"] as const;

/** Only the embedded server can supply the serving lifetime/build binding.
 * Missing/invalid bootstrap (including a Vite document) keeps drafts in memory.
 * Browser origin supplies endpoint scoping; this data never authorizes requests.
 */
export function readStandaloneScope(
  document: Pick<Document, "getElementById">,
  endpoint: string,
): NativeRuntimeScope | null {
  try {
    const element = document.getElementById("nac-presentation-binding");
    if (!element || element.getAttribute("type") !== "application/json") return null;
    const data = JSON.parse(element.textContent ?? "");
    if (
      data?.version !== 1 ||
      !data.scope ||
      !fields.every(
        (field) =>
          typeof data.scope[field] === "string" &&
          data.scope[field].length > 0 &&
          data.scope[field].length <= 4096,
      )
    )
      return null;
    if (data.scope.profile !== "standalone") return null;
    return {
      owner: data.scope.owner,
      profile: data.scope.profile,
      organization: data.scope.organization,
      host: data.scope.host,
      incarnation: data.scope.incarnation,
      release: data.scope.release,
      endpoint,
    };
  } catch {
    return null;
  }
}
