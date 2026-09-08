import { describe, expect, it } from "vitest";
import {
  emptyIndexInfo,
  INDEX_RELATIVE_PATH,
  indexInfoFromNotes,
  indexTotalSize,
} from "./index-info";

describe("index info helpers", () => {
  it("counts notes and unique normalized tags", () => {
    const info = indexInfoFromNotes(
      [
        { tags: ["Diary", "work"] },
        { tags: ["diary", ""] },
        { tags: ["ideas"] },
      ],
      { persistent: true, fileSize: 100, walSize: 20, shmSize: 4 },
    );
    expect(info.relativePath).toBe(INDEX_RELATIVE_PATH);
    expect(info.noteCount).toBe(3);
    expect(info.tagCount).toBe(3);
    expect(info.tagLinkCount).toBe(4);
    expect(info.persistent).toBe(true);
    expect(indexTotalSize(info)).toBe(124);
  });

  it("returns a disposable empty snapshot", () => {
    expect(emptyIndexInfo().noteCount).toBe(0);
    expect(emptyIndexInfo({ noteCount: 8 }).noteCount).toBe(8);
  });
});
