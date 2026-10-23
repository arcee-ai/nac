import { useState } from "react";
import { BoxSurface, NumberInput, Pagination, RangeInput, TagsSelector } from "@/app/atoms";

export function NumericInputsSection() {
  const [parallel, setParallel] = useState(4);
  const [temperature, setTemperature] = useState(0.7);
  const [environments, setEnvironments] = useState<string[]>(["local"]);
  const [page, setPage] = useState(1);

  return (
    <BoxSurface title="Numeric inputs, tags and pagination">
      <div className="p-4 flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-8">
          <NumberInput
            value={parallel}
            onChange={setParallel}
            min={1}
            max={16}
            aria-label="Parallel threads"
          />
          <div className="flex items-center gap-4 w-[320px]">
            <RangeInput
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={setTemperature}
              label="Temperature"
            />
            <span className="code code-small text-basic-muted w-8 shrink-0">
              {temperature.toFixed(1)}
            </span>
          </div>
        </div>
        <TagsSelector
          tags={["local", "docker", "remote", "sandbox"]}
          selected={environments}
          onChange={setEnvironments}
        />
        <Pagination
          page={page}
          pageSize={10}
          totalItems={84}
          itemLabel="sessions"
          onPageChange={setPage}
          className="border-t border-muted"
        />
      </div>
    </BoxSurface>
  );
}
