import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTask } from "./debounced-task";

describe("debounced task", () => {
  afterEach(() => vi.useRealTimers());

  it("runs only the latest scheduled task", () => {
    vi.useFakeTimers();
    const tasks: number[] = [];
    const controller = createDebouncedTask((sequence) => {
      tasks.push(sequence);
    }, 100);
    controller.schedule();
    controller.schedule();
    vi.advanceTimersByTime(100);
    expect(tasks).toEqual([2]);
    expect(controller.isCurrent(2)).toBe(true);
  });

  it("invalidates an in-flight task when cancelled", () => {
    vi.useFakeTimers();
    const controller = createDebouncedTask(vi.fn(), 100);
    controller.schedule();
    controller.cancel();
    expect(controller.isCurrent(1)).toBe(false);
  });

  it("runs immediately with a current sequence", () => {
    vi.useFakeTimers();
    const tasks: number[] = [];
    const controller = createDebouncedTask((sequence) => {
      tasks.push(sequence);
    }, 100);
    controller.runNow();
    expect(tasks).toEqual([1]);
    expect(controller.isCurrent(1)).toBe(true);
  });
});
