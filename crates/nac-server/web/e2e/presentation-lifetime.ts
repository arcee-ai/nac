/** Preserve the first failure while attempting every owned cleanup in order. */
export async function finishPresentation(
  failures: unknown[],
  cleanup: (() => unknown | Promise<unknown>)[],
) {
  for (const dispose of cleanup) {
    try {
      await dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Presentation lifetime failed", { cause: failures[0] });
}

/** Route completion can start further routes; retain failures even before draining starts. */
export class PresentationTasks {
  private readonly pending = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];

  track(task: Promise<void>) {
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      (error: unknown) => {
        this.failures.push(error);
        this.pending.delete(task);
      },
    );
    return task;
  }

  async drain() {
    while (this.pending.size) await Promise.allSettled(this.pending);
    await finishPresentation(this.failures.splice(0), []);
  }
}
