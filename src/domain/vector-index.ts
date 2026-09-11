import type { AppSettings } from "./settings";

export type VectorIndexStatus = {
  enabled: boolean;
  model: string;
  dimensions: number;
  totalNotes: number;
  indexedNotes: number;
  pendingNotes: number;
  failedNotes: number;
  chunkCount: number;
  lastIndexedMs: number;
  lastError: string | null;
};

export type SemanticSearchResult = {
  relativePath: string;
  title: string;
  excerpt: string;
  content: string;
  score: number;
  chunkIndex: number;
};

export type AiSettings = AppSettings["ai"];

export function emptyVectorIndexStatus(overrides: Partial<VectorIndexStatus> = {}): VectorIndexStatus {
  return {
    enabled: false,
    model: "",
    dimensions: 0,
    totalNotes: 0,
    indexedNotes: 0,
    pendingNotes: 0,
    failedNotes: 0,
    chunkCount: 0,
    lastIndexedMs: 0,
    lastError: null,
    ...overrides,
  };
}
