import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutosaveController } from "./autosave-controller";

describe("autosave controller", () => {
  afterEach(() => vi.useRealTimers());

  it("starts once, saves dirty content, and stops when clean", async () => {
    vi.useFakeTimers();
    let state = { dirty: true, saving: false };
    const save = vi.fn(async () => undefined);
    const controller = createAutosaveController({
      getState: () => state,
      isDirty: (value) => value.dirty,
      isSaving: (value) => value.saving,
      save,
      intervalMs: 100,
    });

    controller.sync();
    controller.sync();
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
    state = { dirty: false, saving: false };
    controller.sync();
    vi.advanceTimersByTime(200);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not save while another save is in progress", () => {
    vi.useFakeTimers();
    const state = { dirty: true, saving: true };
    const save = vi.fn(async () => undefined);
    const controller = createAutosaveController({
      getState: () => state,
      isDirty: (value) => value.dirty,
      isSaving: (value) => value.saving,
      save,
      intervalMs: 100,
    });
    controller.sync();
    vi.advanceTimersByTime(300);
    expect(save).not.toHaveBeenCalled();
  });
});
