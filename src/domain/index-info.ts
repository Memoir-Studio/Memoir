export const INDEX_RELATIVE_PATH = ".memoir/index.sqlite";
export const INDEX_SCHEMA_NAME = "memoir-index";
export const INDEX_SCHEMA_VERSION = 2;
export const INDEX_PARSE_ALGO_VERSION = 1;
export const INDEX_READ_CAP = 1024 * 1024;

export type WorkspaceIndexInfo = {
  persistent: boolean;
  relativePath: string;
  fileSize: number;
  walSize: number;
  shmSize: number;
  schemaVersion: number;
  schemaName: string;
  parseAlgoVersion: number;
  indexReadCap: number;
  createdMs: number;
  lastReconcileMs: number;
  noteCount: number;
  tagCount: number;
  tagLinkCount: number;
  truncatedCount: number;
};

export function emptyIndexInfo(overrides: Partial<WorkspaceIndexInfo> = {}): WorkspaceIndexInfo {
  return {
    persistent: false,
    relativePath: INDEX_RELATIVE_PATH,
    fileSize: 0,
    walSize: 0,
    shmSize: 0,
    schemaVersion: INDEX_SCHEMA_VERSION,
    schemaName: INDEX_SCHEMA_NAME,
    parseAlgoVersion: INDEX_PARSE_ALGO_VERSION,
    indexReadCap: INDEX_READ_CAP,
    createdMs: 0,
    lastReconcileMs: 0,
    noteCount: 0,
    tagCount: 0,
    tagLinkCount: 0,
    truncatedCount: 0,
    ...overrides,
  };
}

export function indexInfoFromNotes(
  notes: Array<{ tags: string[] }>,
  overrides: Partial<WorkspaceIndexInfo> = {},
): WorkspaceIndexInfo {
  const tagNorm = new Set<string>();
  let tagLinkCount = 0;
  for (const note of notes) {
    for (const tag of note.tags) {
      const key = tag.trim().toLowerCase();
      if (!key) continue;
      tagLinkCount += 1;
      tagNorm.add(key);
    }
  }
  return emptyIndexInfo({
    noteCount: notes.length,
    tagCount: tagNorm.size,
    tagLinkCount,
    ...overrides,
  });
}

export function indexTotalSize(info: Pick<WorkspaceIndexInfo, "fileSize" | "walSize" | "shmSize">) {
  return info.fileSize + info.walSize + info.shmSize;
}