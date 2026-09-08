export type DebouncedTask = {
  schedule(): void;
  runNow(): void;
  cancel(): void;
  isCurrent(sequence: number): boolean;
};

export function createDebouncedTask(
  task: (sequence: number) => void | Promise<void>,
  delayMs: number,
): DebouncedTask {
  let timer: number | null = null;
  let sequence = 0;

  const cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    sequence += 1;
  };

  const schedule = () => {
    if (timer !== null) window.clearTimeout(timer);
    const current = ++sequence;
    timer = window.setTimeout(() => {
      timer = null;
      void task(current);
    }, delayMs);
  };

  const runNow = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    const current = ++sequence;
    void task(current);
  };

  return {
    schedule,
    runNow,
    cancel,
    isCurrent: (current) => current === sequence,
  };
}
