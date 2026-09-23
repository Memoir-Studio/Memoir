use super::{
    db_error, dot_blob, exact_search, load_results, select_top, validate_query, Candidate,
};
use crate::domain::{AppError, AppResult, ErrorCode, SemanticSearchResult};
use hnsw_rs::prelude::{Distance, Hnsw};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
};

const MIN_HNSW_CHUNKS: usize = 1_024;
const MAX_GRAPH_BYTES: usize = 256 * 1024 * 1024;
const CONNECTIONS: usize = 24;
const EF_CONSTRUCTION: usize = 200;
const EF_SEARCH: usize = 320;
const MAX_CANDIDATES: usize = 2_048;
const REVISION_KEY: &str = "hnsw_revision";

// Embeddings are normalized by EmbeddingClient. Clamp rounding error rather
// than using DistDot, which asserts when a self-dot rounds above one.
struct CosineDistance;
impl Distance<f32> for CosineDistance {
    fn eval(&self, left: &[f32], right: &[f32]) -> f32 {
        // Independent accumulators let LLVM vectorize this hot loop on both
        // x86 and ARM without unsafe intrinsics or a nightly SIMD feature.
        let mut sums = [0.0_f32; 8];
        let mut left_chunks = left.chunks_exact(8);
        let mut right_chunks = right.chunks_exact(8);
        for (a, b) in left_chunks.by_ref().zip(right_chunks.by_ref()) {
            for lane in 0..8 {
                sums[lane] += a[lane] * b[lane];
            }
        }
        let tail = left_chunks
            .remainder()
            .iter()
            .zip(right_chunks.remainder())
            .map(|(a, b)| a * b)
            .sum::<f32>();
        (1.0 - (sums.iter().sum::<f32>() + tail)).max(0.0)
    }
}

struct Graph {
    index: Hnsw<'static, f32, CosineDistance>,
    chunk_ids: Vec<i64>,
}

#[derive(Clone, PartialEq, Eq)]
struct CacheKey {
    root: PathBuf,
    model: String,
    dimensions: usize,
    revision: String,
}

#[derive(Default)]
struct CacheState {
    entry: Option<(CacheKey, Option<Arc<Graph>>)>,
    building: bool,
}

#[derive(Default)]
struct CacheInner {
    state: Mutex<CacheState>,
    finished: Condvar,
}

#[derive(Default)]
pub(crate) struct HnswCache {
    // One active graph and at most one builder across all service clones.
    inner: Arc<CacheInner>,
}

impl std::fmt::Debug for HnswCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HnswCache").finish_non_exhaustive()
    }
}

// Called in the SAME transaction as replacing/deleting vectors. Random tokens
// also distinguish restored/recreated databases, even if their row IDs repeat.
pub(crate) fn bump_revision(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO ai_vector_meta(key, value) VALUES (?1, hex(randomblob(16)))",
        params![REVISION_KEY],
    )
    .map(|_| ())
    .map_err(db_error)
}

fn revision(conn: &Connection) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM ai_vector_meta WHERE key = ?1",
        params![REVISION_KEY],
        |row| row.get(0),
    )
    .optional()
    .map_err(db_error)
}

pub(crate) fn search_cached(
    conn: &Connection,
    root: &Path,
    model: &str,
    query: &[f32],
    limit: u32,
    cache: &HnswCache,
) -> AppResult<Vec<SemanticSearchResult>> {
    validate_query(query)?;
    // Upgrade existing vector databases lazily without regenerating embeddings.
    if revision(conn)?.is_none() {
        conn.execute(
            "INSERT OR IGNORE INTO ai_vector_meta(key, value) VALUES (?1, hex(randomblob(16)))",
            params![REVISION_KEY],
        )
        .map_err(db_error)?;
    }
    let snapshot = conn.unchecked_transaction().map_err(db_error)?;
    let key = CacheKey {
        root: root.to_path_buf(),
        model: model.to_string(),
        dimensions: query.len(),
        revision: revision(&snapshot)?.unwrap_or_default(),
    };
    let graph = cached_or_schedule(&snapshot, model, query.len(), key, cache)?;
    let Some(graph) = graph else {
        return exact_search(&snapshot, model, query, limit);
    };
    let limit = limit.clamp(1, 100);
    let mut count = (limit as usize * 4).max(64).min(graph.chunk_ids.len());
    loop {
        let neighbours = graph.index.search(query, count, EF_SEARCH.max(count * 2));
        let mut best = HashMap::<i64, Candidate>::new();
        let mut statement = snapshot
            .prepare(
                "SELECT c.note_id, c.chunk_index, c.embedding FROM note_chunks c
             JOIN notes n ON n.id = c.note_id
             JOIN ai_vector_state s ON s.note_id = c.note_id AND s.model = c.model
             WHERE c.id = ?1 AND c.model = ?2 AND s.status = 'ready'
               AND s.modified_ms = n.modified_ms AND s.size = n.size",
            )
            .map_err(db_error)?;
        for neighbour in neighbours {
            let chunk_id = graph.chunk_ids[neighbour.d_id];
            let value = statement
                .query_row(params![chunk_id, model], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                })
                .optional()
                .map_err(db_error)?;
            let Some((note_id, chunk_index, bytes)) = value else {
                continue;
            };
            let Some(score) = dot_blob(query, &bytes)? else {
                continue;
            };
            let candidate = Candidate {
                chunk_id,
                note_id,
                chunk_index,
                score,
            };
            best.entry(note_id)
                .and_modify(|current| {
                    if candidate > *current {
                        *current = candidate;
                    }
                })
                .or_insert(candidate);
        }
        if best.len() >= limit as usize {
            return load_results(&snapshot, select_top(best.into_values(), limit));
        }
        // Long notes and stale/deleted chunks can occupy the candidate set.
        // Expand it before falling back to exact search to avoid short results.
        if count >= graph.chunk_ids.len().min(MAX_CANDIDATES) {
            return exact_search(&snapshot, model, query, limit);
        }
        count = (count * 2).min(graph.chunk_ids.len()).min(MAX_CANDIDATES);
    }
}

fn cached_or_schedule(
    conn: &Connection,
    model: &str,
    dimensions: usize,
    key: CacheKey,
    cache: &HnswCache,
) -> AppResult<Option<Arc<Graph>>> {
    let mut state = cache
        .inner
        .state
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Io, "Vector search cache is unavailable."))?;
    if let Some((cached_key, graph)) = &state.entry {
        if *cached_key == key {
            return Ok(graph.clone());
        }
    }
    if state.building {
        return Ok(None);
    }
    state.entry = None;
    let Some(input) = read_vectors(conn, model, dimensions)? else {
        state.entry = Some((key, None));
        return Ok(None);
    };
    state.building = true;
    let inner = cache.inner.clone();
    // Work from owned vectors copied from this query's snapshot. No connection,
    // SQLite read transaction or filesystem path is retained by the worker.
    let spawned = std::thread::Builder::new()
        .name("memoir-hnsw".into())
        .spawn(move || {
            let graph = std::panic::catch_unwind(|| build_graph(input))
                .ok()
                .map(Arc::new);
            if let Ok(mut state) = inner.state.lock() {
                state.entry = Some((key, graph));
                state.building = false;
                inner.finished.notify_all();
            }
        });
    if spawned.is_err() {
        state.building = false;
        cache.inner.finished.notify_all();
    }
    // Until the graph is published, callers get exact results without waiting
    // for graph construction. A newer revision never uses the older graph.
    Ok(None)
}

struct GraphInput {
    vectors: Vec<Vec<f32>>,
    chunk_ids: Vec<i64>,
}

fn read_vectors(
    conn: &Connection,
    model: &str,
    dimensions: usize,
) -> AppResult<Option<GraphInput>> {
    let count: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM note_chunks WHERE model = ?1",
            params![model],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    // For small datasets or excessive graph memory, retain the exact path.
    if count < MIN_HNSW_CHUNKS
        || count.saturating_mul(dimensions.saturating_mul(4).saturating_add(1024)) > MAX_GRAPH_BYTES
    {
        return Ok(None);
    }
    let mut input = GraphInput {
        vectors: Vec::with_capacity(count),
        chunk_ids: Vec::with_capacity(count),
    };
    let mut statement = conn
        .prepare("SELECT id, embedding FROM note_chunks WHERE model = ?1 ORDER BY id")
        .map_err(db_error)?;
    let mut rows = statement.query(params![model]).map_err(db_error)?;
    // Include stale chunks too: eligibility is checked against each search's
    // snapshot, so restoring a note's source identity cannot hide it from ANN.
    while let Some(row) = rows.next().map_err(db_error)? {
        let bytes: Vec<u8> = row.get(1).map_err(db_error)?;
        if bytes.len() % 4 != 0 {
            return Err(AppError::new(
                ErrorCode::Serialization,
                "Stored vector has an invalid binary format.",
            ));
        }
        if bytes.len() / 4 != dimensions {
            continue;
        }
        let vector = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect::<Vec<_>>();
        if vector.iter().any(|v| !v.is_finite()) {
            continue;
        }
        input.vectors.push(vector);
        input.chunk_ids.push(row.get(0).map_err(db_error)?);
    }
    Ok((input.chunk_ids.len() >= MIN_HNSW_CHUNKS).then_some(input))
}

fn build_graph(input: GraphInput) -> Graph {
    let mut index = Hnsw::new(
        CONNECTIONS,
        input.chunk_ids.len(),
        16,
        EF_CONSTRUCTION,
        CosineDistance,
    );
    for (id, vector) in input.vectors.into_iter().enumerate() {
        index.insert((&vector, id));
    }
    index.set_searching_mode(true);
    Graph {
        index,
        chunk_ids: input.chunk_ids,
    }
}

#[cfg(test)]
mod tests;
