/** Only the exact route returned by task tools is a task reference. */
export function taskReferenceId(href: string | undefined): string | null {
  return (
    /^\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      href ?? "",
    )?.[1] ?? null
  );
}
