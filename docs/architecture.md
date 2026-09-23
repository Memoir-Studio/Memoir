# Memoir Architecture

## Boundaries

The frontend uses a feature-first UI over a small application/domain core:

```text
features -> store -> application/use cases -> ports -> adapters
features -------------------------------> domain
adapters -------------------------------> ports + domain
domain ----------------------------------> no UI, store, or platform imports
```

`src/domain` contains pure models and rules. `src/gateways` contains the current
runtime adapters and is being narrowed into capability ports over time. React
features may use the compatibility facades while code outside `features` must
not import feature modules.

## Data flow

Markdown and MDX files in the selected workspace are the source of truth.
`.memoir/index.sqlite` is disposable metadata/cache storage. The browser adapter
uses an in-memory workspace with the same gateway contract.

```text
user action
  -> feature
  -> Zustand action
  -> gateway contract
  -> browser adapter or Tauri command
  -> Rust service
  -> filesystem/index/remote infrastructure
```

The frontend store currently owns the compatibility orchestration. New business
logic should be placed in a domain helper or an application use-case module,
not added to a feature component or a generic gateway.

Library projection is implemented in `src/application/library`. The Zustand
store keeps its public state/action surface stable while UI, library, editor,
workspace, and sync actions are assembled from the corresponding modules in
`src/store/slices/`.
Autosave and debounced query timer lifecycles are isolated in
`src/store/autosave-controller.ts` and `src/store/debounced-task.ts`.

## Library refresh invariants

- Initial open, workspace open, and explicit refresh may reconcile the workspace.
- Create, rename, delete, and save patch the current page or issue a query; they
  must not trigger an unnecessary full workspace walk.
- Index rebuild consumes the returned library page and does not reconcile twice.
- Query and filter changes use the query path and debounce; they do not reconcile.
- The current note may remain selected even when it is outside the current page.
- Draft and autosave behavior must preserve unsaved content across navigation and
  restart.

## Frontend ports

The gateway contracts are the browser/Tauri boundary. Keep commands stable when
possible and test both adapters against the same edge cases.

Current capabilities are grouped as:

- workspace: scan, query, index, note CRUD, graph;
- persistence: app state, preferences, favorites, folder appearance, drafts;
- cloud sync: profile, connection test, sync, progress events.

Attachment and system/file-dialog capabilities are exposed as separate ports on
`AppGateways`; adapters currently share the same implementation instance so the
migration does not break existing callers.

## Tauri layers

```text
commands -> services -> infrastructure
          -> domain
```

Commands adapt serialized arguments and Tauri runtime concerns. They are grouped
by capability in `commands/app_state.rs`, `commands/sync.rs`,
`commands/system.rs`, and `commands/workspace.rs`; `commands/mod.rs` only owns
registration, shared services, and media-scope setup. Services own application
workflows. Infrastructure owns local files, SQLite, HTTP/WebDAV/S3, and release
metadata. Domain code must not depend on Tauri.

Important command payloads use camelCase serde fields to match TypeScript. Changes
to `AppState`, `LibraryQuery`, `LibraryPage`, sync progress, error codes, or
rename results require matching frontend adapter tests and Rust tests.

## Semantic vector retrieval

SQLite remains the durable store for embeddings. The Rust vector service uses
an in-memory [hnsw_rs](https://docs.rs/hnsw_rs/0.3.4/hnsw_rs/) graph for models
with at least 1,024 usable chunks, with cosine distance over normalized vectors.
The graph uses 24 connections, `efConstruction=200`, and `efSearch>=320`.
Independent distance accumulators allow compiler SIMD optimization without
platform-specific unsafe code. Candidate scores are recomputed from SQLite
using the existing dot-product scoring before selecting the top notes.

The service shares one active workspace/model/dimension graph across clones.
A background worker constructs it from owned vectors read in a SQLite snapshot;
searches continue using exact retrieval until it is ready. Graphs are rebuilt
after application restart or vector changes; they are not persisted to disk.
Every vector replacement or explicit vector deletion must change
`ai_vector_meta.hnsw_revision` in the same transaction. Random revision tokens
prevent row ID reuse across database rebuilds from matching an old cache.

Each search checks candidate eligibility against its current SQLite snapshot,
including model, ready state, source size and modification time. Note deletion
and renaming are therefore visible without rebuilding the graph. Candidate
counts expand when long notes or stale chunks leave too few distinct notes;
exact retrieval is the fallback. Small datasets and graphs whose estimated
memory exceeds 256 MiB also use exact retrieval. HNSW is approximate, so exact
reranking of candidates does not guarantee global top-K recall.

Run the synthetic recall and timing comparison with:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --release --lib benchmark_hnsw -- --ignored --nocapture
```

It measures the first query, background graph construction, warm local queries,
and recall against exact retrieval; embedding API latency is excluded.

## Error handling

Rust returns typed error codes. The adapter maps transport errors into gateway
errors, and the store maps those errors into localized UI messages. Do not expose
raw filesystem or remote-provider errors directly from React components.

## Adding a feature

1. Put reusable rules and data transformations in `src/domain`.
2. Add a narrow port only if the capability crosses the browser/Tauri boundary.
3. Put multi-step orchestration in an application/use-case module or the
   corresponding store slice. Keep UI, library, editor, workspace, sync, and
   attachment actions in `src/store/slices`; keep only cross-slice coordination
   and dependency assembly in the store factory.
4. Keep React components focused on rendering and user interaction.
5. Add domain, adapter, and store tests at the layer where the behavior lives.
6. Run `bun run style:check`, `bun run test`, `bun run build`, and Rust tests.
