export type AutosaveControllerOptions<T> = {
  getState: () => T;
  isDirty: (state: T) => boolean;
  isSaving: (state: T) => boolean;
  save: (state: T) => Promise<void>;
  intervalMs: number;
};

export function createAutosaveController<T>({
  getState,
  isDirty,
  isSaving,
  save,
  intervalMs,
}: AutosaveControllerOptions<T>) {
  let timer: number | null = null;

  const stop = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };

  const sync = () => {
    if (!isDirty(getState())) {
      stop();
      return;
    }
    if (timer !== null) return;
    timer = window.setInterval(() => {
      const state = getState();
      if (!isDirty(state)) {
        stop();
        return;
      }
      if (isSaving(state)) return;
      void save(state);
    }, intervalMs);
  };

  return { stop, sync };
}
