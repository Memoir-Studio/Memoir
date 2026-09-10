# Vector Index Design

Memoir keeps Markdown and MDX files as the source of truth. The vector index is
an optional, disposable cache stored beside the existing SQLite library index
at `.memoir/index.sqlite`.

## Responsibilities

The vector index has four separate responsibilities:

- `EmbeddingClient` talks to an OpenAI-compatible `/embeddings` endpoint. It
  supports OpenAI, Ollama-compatible servers, and custom endpoints through the
  existing AI settings.
- `VectorIndexService` turns note bodies into deterministic overlapping chunks,
  batches embedding requests, and commits each note atomically.
- `ai_vector_state` records source identity, model, status, error text, and chunk
  count. A note is re-embedded only when its path identity, size, modification
  time, or embedding model changes.
- `note_chunks` stores the chunk text and normalized `f32` vector as a little-
  endian BLOB. Search computes cosine similarity as a dot product and returns
  the strongest chunk per note.
- `search_notes` is an OpenAI-compatible function tool exposed to the AI
  assistant. When the model requests it, Memoir searches only the current
  workspace's ready vectors, returns at most eight bounded passages, and sends
  those passages back as a tool message for grounded answer generation.

## Consistency Rules

- A result is searchable only when its vector state is `ready` and its stored
  source identity still matches the current `notes` row.
- Failed work removes the note's previous vectors before recording the failure;
  stale content can therefore never appear as a successful result.
- Embedding model metadata is namespaced by model, so changing models does not
  make one model's timestamps or vectors look like another's.
- Vector writes use a SQLite transaction per note. A process interruption can
  leave a note pending, but cannot leave a partially replaced note searchable.
- Reconcile runs before vectorization so note IDs and file metadata are current.
  The normal workspace refresh and save paths schedule a debounced incremental
  update in the background.

## Search Behavior

Keyword search continues to use the existing FTS/LIKE path. Semantic search is
an explicit mode in the library panel. The query is embedded with the active
model, then compared only with current, ready chunks. Results are deduplicated
by note and show the highest-scoring chunk, its source path, and similarity.

The current storage format is exact cosine search over normalized vectors. This
keeps the index portable and does not require a native SQLite extension. The
schema keeps the storage and query contract isolated so an ANN backend can be
introduced later without changing note files, gateway commands, or UI results.

The assistant performs at most one retrieval round per message. It receives the
note path, title, similarity score, chunk number, and a maximum 2,400-character
passage. Retrieved note text is marked as untrusted context in the system
instruction and the assistant is asked to cite source paths in its response.

## Failure and Privacy

When AI is enabled, opening or refreshing a workspace and creating, saving,
renaming, or deleting a note schedules a debounced incremental index update.
Manual incremental and forced rebuild controls are also available in the index
inspector. Semantic search sends the query text to the configured embedding
service. The browser adapter remains a no-op demo implementation. The
configured API key is never included in error details or logs, and response
bodies are truncated before being attached to user-visible errors.
