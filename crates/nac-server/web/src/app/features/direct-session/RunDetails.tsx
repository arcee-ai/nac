/** Secondary run readings stay available without crowding the conversation header. */
export function RunDetails({
  context,
  input,
  output,
  cost,
  elapsed,
}: {
  context: string;
  input: string;
  output: string;
  cost: string;
  elapsed: string;
}) {
  return (
    <details className="group relative shrink-0">
      <summary className="label-micro cursor-pointer rounded px-2 py-1 text-basic-tertiary hover:text-basic-primary focus-visible:outline focus-visible:outline-2">
        Run details
      </summary>
      <dl className="absolute right-0 top-full z-30 mt-1 grid w-52 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-tertiary bg-elevation-level-3 p-3 text-micro shadow-xl">
        <dt>Context tokens</dt>
        <dd className="text-right">{context}</dd>
        <dt>Input tokens</dt>
        <dd className="text-right">{input}</dd>
        <dt>Output tokens</dt>
        <dd className="text-right">{output}</dd>
        <dt>Session cost</dt>
        <dd className="text-right">{cost}</dd>
        <dt>Elapsed</dt>
        <dd className="text-right">{elapsed}</dd>
      </dl>
    </details>
  );
}
