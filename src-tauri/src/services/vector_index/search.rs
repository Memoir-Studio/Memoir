pub(super) mod hnsw;

use super::db_error;
use crate::domain::{AppError, AppResult, ErrorCode, SemanticSearchResult};
use rusqlite::{params, Connection};
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug)]
struct Candidate {
    chunk_id: i64,
    note_id: i64,
    chunk_index: u32,
    score: f32,
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .total_cmp(&other.score)
            // Prefer earlier notes/chunks on ties for reproducible results.
            .then_with(|| other.note_id.cmp(&self.note_id))
            .then_with(|| other.chunk_index.cmp(&self.chunk_index))
            .then_with(|| other.chunk_id.cmp(&self.chunk_id))
    }
}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Candidate {}

#[cfg(test)]
pub(super) fn search_vectors(
    conn: &Connection,
    model: &str,
    query: &[f32],
    limit: u32,
) -> AppResult<Vec<SemanticSearchResult>> {
    validate_query(query)?;
    // Scoring and loading the winning text must see the same database snapshot,
    // even when indexing, deletion or renaming commits during a search.
    let snapshot = conn.unchecked_transaction().map_err(db_error)?;
    exact_search(&snapshot, model, query, limit)
}

fn validate_query(query: &[f32]) -> AppResult<()> {
    if query.is_empty() || query.iter().any(|value| !value.is_finite()) {
        return Err(AppError::new(
            ErrorCode::Serialization,
            "AI returned an invalid query vector.",
        ));
    }
    Ok(())
}

fn exact_search(
    snapshot: &Connection,
    model: &str,
    query: &[f32],
    limit: u32,
) -> AppResult<Vec<SemanticSearchResult>> {
    let mut statement = snapshot
        .prepare(
            "SELECT c.id, c.note_id, c.chunk_index, c.embedding
             FROM note_chunks c
             JOIN notes n ON n.id = c.note_id
             JOIN ai_vector_state s ON s.note_id = c.note_id AND s.model = c.model
             WHERE c.model = ?1 AND s.status = 'ready'
               AND s.modified_ms = n.modified_ms AND s.size = n.size",
        )
        .map_err(db_error)?;
    let mut rows = statement.query(params![model]).map_err(db_error)?;
    let mut best = HashMap::<i64, Candidate>::new();
    while let Some(row) = rows.next().map_err(db_error)? {
        // Borrow SQLite's blob and decode while scoring, with no per-chunk Vec.
        let bytes = row
            .get_ref(3)
            .map_err(db_error)?
            .as_blob()
            .map_err(|error| {
                AppError::new(ErrorCode::Serialization, "Stored vector is not a blob.")
                    .with_details(error.to_string())
            })?;
        let Some(score) = dot_blob(query, bytes)? else {
            continue;
        };
        let candidate = Candidate {
            chunk_id: row.get(0).map_err(db_error)?,
            note_id: row.get(1).map_err(db_error)?,
            chunk_index: row.get(2).map_err(db_error)?,
            score,
        };
        best.entry(candidate.note_id)
            .and_modify(|current| {
                if candidate > *current {
                    *current = candidate;
                }
            })
            .or_insert(candidate);
    }
    drop(rows);
    drop(statement);

    load_results(snapshot, select_top(best.into_values(), limit))
}

fn select_top(candidates: impl Iterator<Item = Candidate>, limit: u32) -> Vec<Candidate> {
    let limit = limit.clamp(1, 100) as usize;
    let mut top = BinaryHeap::<Reverse<Candidate>>::with_capacity(limit);
    for candidate in candidates {
        if top.len() < limit {
            top.push(Reverse(candidate));
        } else if let Some(mut worst) = top.peek_mut() {
            if candidate > worst.0 {
                *worst = Reverse(candidate);
            }
        }
    }

    top.into_sorted_vec()
        .into_iter()
        .map(|Reverse(candidate)| candidate)
        .collect()
}

fn load_results(
    snapshot: &Connection,
    candidates: Vec<Candidate>,
) -> AppResult<Vec<SemanticSearchResult>> {
    // Only the final K results need paths, titles, excerpts and chunk content.
    let mut statement = snapshot
        .prepare(
            "SELECT n.relative_path, n.title, n.excerpt, c.content
             FROM note_chunks c JOIN notes n ON n.id = c.note_id WHERE c.id = ?1",
        )
        .map_err(db_error)?;
    candidates
        .into_iter()
        .map(|candidate| {
            statement
                .query_row(params![candidate.chunk_id], |row| {
                    Ok(SemanticSearchResult {
                        relative_path: row.get(0)?,
                        title: row.get(1)?,
                        excerpt: row.get(2)?,
                        content: row.get(3)?,
                        score: candidate.score,
                        chunk_index: candidate.chunk_index,
                    })
                })
                .map_err(db_error)
        })
        .collect()
}

fn dot_blob(query: &[f32], bytes: &[u8]) -> AppResult<Option<f32>> {
    if bytes.len() % 4 != 0 {
        return Err(AppError::new(
            ErrorCode::Serialization,
            "Stored vector has an invalid binary format.",
        ));
    }
    if bytes.len() / 4 != query.len() {
        return Ok(None);
    }
    let score = query
        .iter()
        .zip(bytes.chunks_exact(4))
        .map(|(value, chunk)| value * f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .sum::<f32>();
    Ok(score.is_finite().then_some(score))
}
