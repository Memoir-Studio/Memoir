use crate::{
    domain::{
        note_parse::parse_note, AiSettings, AppError, AppResult, LibraryQuery,
        SemanticSearchResult, VectorIndexStatus,
    },
    infrastructure::{
        ai::EmbeddingClient,
        filesystem::LocalFileSystem,
        index::{self, schema::now_ms},
    },
    services::WorkspaceService,
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

const MAX_VECTOR_NOTE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct VectorIndexService {
    filesystem: LocalFileSystem,
    workspace: WorkspaceService,
}

#[derive(Debug, Clone)]
struct Chunk {
    index: u32,
    start: usize,
    end: usize,
    content: String,
    hash: String,
}

impl VectorIndexService {
    pub fn new(filesystem: LocalFileSystem, workspace: WorkspaceService) -> Self {
        Self {
            filesystem,
            workspace,
        }
    }

    pub fn status(&self, root: &str, settings: &AiSettings) -> AppResult<VectorIndexStatus> {
        let root_path = crate::domain::path::normalize_root(root)?;
        let index = index::open_or_rebuild(&root_path);
        status_from_db(&index.conn, settings)
    }

    pub fn index(
        &self,
        root: &str,
        settings: &AiSettings,
        force: bool,
    ) -> AppResult<VectorIndexStatus> {
        if !settings.enabled {
            return Ok(VectorIndexStatus {
                enabled: false,
                model: settings.embedding_model.clone(),
                ..VectorIndexStatus::default()
            });
        }
        let client = EmbeddingClient::new(settings)?;
        // Reconcile first so note IDs and source identities are current before vector work starts.
        self.workspace.reconcile(root, &LibraryQuery::default())?;
        let root_path = crate::domain::path::normalize_root(root)?;
        let mut index = index::open_or_rebuild(&root_path);
        let model = settings.embedding_model.trim();
        let notes = self
            .filesystem
            .walk_workspace(root, &HashMap::new(), &[])?
            .notes;
        let mut dimensions = 0_u32;
        let mut last_error = None;
        let chunk_target_chars = settings.embedding_max_length();
        let stored_chunk_target_chars = stored_chunk_target_chars(&index.conn, model);
        let chunk_length_changed = stored_chunk_target_chars != chunk_target_chars;

        for identity in notes {
            let note_id: Option<i64> = index
                .conn
                .query_row(
                    "SELECT id FROM notes WHERE relative_path = ?1",
                    params![identity.relative_path],
                    |row| row.get(0),
                )
                .optional()
                .map_err(db_error)?;
            let Some(note_id) = note_id else { continue };
            if !force
                && !chunk_length_changed
                && is_current_ready(
                    &index.conn,
                    note_id,
                    model,
                    identity.modified_ms as i64,
                    identity.size,
                )?
            {
                continue;
            }
            if identity.size > MAX_VECTOR_NOTE_BYTES {
                let message = format!(
                    "Note exceeds the vectorization limit of {} MB.",
                    MAX_VECTOR_NOTE_BYTES / 1024 / 1024
                );
                mark_error(&index.conn, note_id, model, &identity, &message)?;
                last_error = Some(message);
                continue;
            }
            let content = match self.filesystem.read_note(root, &identity.relative_path) {
                Ok(content) => content,
                Err(error) => {
                    mark_error(&index.conn, note_id, model, &identity, &error.message)?;
                    last_error = Some(error.message);
                    continue;
                }
            };
            let chunks = make_chunks(&content, &identity.file_name, chunk_target_chars);
            let inputs = chunks
                .iter()
                .map(|chunk| chunk.content.clone())
                .collect::<Vec<_>>();
            let embeddings = match client.embed(&inputs) {
                Ok(embeddings) => embeddings,
                Err(error) => {
                    mark_error(&index.conn, note_id, model, &identity, &error.message)?;
                    last_error = Some(error.message);
                    continue;
                }
            };
            if let Some(vector) = embeddings.first() {
                dimensions = vector.len() as u32;
            }
            replace_note_vectors(
                &mut index.conn,
                note_id,
                model,
                identity.modified_ms as i64,
                &chunks,
                &embeddings,
                dimensions,
            )?;
        }
        set_meta(&index.conn, "active_model", model)?;
        set_meta(
            &index.conn,
            &model_meta_key("chunk_target_chars", model),
            &chunk_target_chars.to_string(),
        )?;
        set_meta(
            &index.conn,
            &model_meta_key("last_indexed_ms", model),
            &now_ms().to_string(),
        )?;
        if let Some(error) = last_error {
            set_meta(&index.conn, &model_meta_key("last_error", model), &error)?;
        } else {
            let _ = index.conn.execute(
                "DELETE FROM ai_vector_meta WHERE key = ?1",
                params![model_meta_key("last_error", model)],
            );
        }
        status_from_db(&index.conn, settings)
    }

    pub fn search(
        &self,
        root: &str,
        settings: &AiSettings,
        query: &str,
        limit: u32,
    ) -> AppResult<Vec<SemanticSearchResult>> {
        if !settings.enabled {
            return Ok(Vec::new());
        }
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let root_path = crate::domain::path::normalize_root(root)?;
        let index = index::open_or_rebuild(&root_path);
        let model = settings.embedding_model.trim();
        if stored_chunk_target_chars(&index.conn, model) != settings.embedding_max_length() {
            return Ok(Vec::new());
        }
        let client = EmbeddingClient::new(settings)?;
        let query_vector = client
            .embed(&[query.to_string()])?
            .pop()
            .unwrap_or_default();
        let mut statement = index
            .conn
            .prepare(
                "SELECT n.relative_path, n.title, n.excerpt, c.chunk_index, c.content, c.embedding
               FROM note_chunks c
               JOIN notes n ON n.id = c.note_id
               JOIN ai_vector_state s ON s.note_id = c.note_id AND s.model = c.model
              WHERE c.model = ?1 AND s.status = 'ready'
                AND s.modified_ms = n.modified_ms AND s.size = n.size
              ORDER BY c.note_id, c.chunk_index",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![model], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            })
            .map_err(db_error)?;
        let mut best: HashMap<String, SemanticSearchResult> = HashMap::new();
        for row in rows {
            let (path, title, excerpt, chunk_index, content, bytes) = row.map_err(db_error)?;
            let vector = blob_to_vector(&bytes)?;
            let score = dot(&query_vector, &vector);
            let result = SemanticSearchResult {
                relative_path: path.clone(),
                title,
                excerpt,
                content,
                score,
                chunk_index,
            };
            if best
                .get(&path)
                .map_or(true, |current| score > current.score)
            {
                best.insert(path, result);
            }
        }
        let mut results = best.into_values().collect::<Vec<_>>();
        results.sort_by(|left, right| right.score.total_cmp(&left.score));
        results.truncate(limit.clamp(1, 100) as usize);
        Ok(results)
    }
}

fn make_chunks(content: &str, file_name: &str, target_chars: usize) -> Vec<Chunk> {
    let target_chars = target_chars.max(1);
    let overlap_chars = (target_chars / 8)
        .max(1)
        .min(target_chars.saturating_sub(1));
    let body = strip_frontmatter(content);
    let title = parse_note(content, file_name).title;
    let text = format!("Title: {title}\n\n{body}");
    let chars = text.chars().collect::<Vec<_>>();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while start < chars.len() {
        let mut end = (start + target_chars).min(chars.len());
        if end < chars.len() {
            if let Some(boundary) = chars[start..end].iter().rposition(|ch| {
                *ch == '\n' || *ch == '。' || *ch == '！' || *ch == '？' || *ch == '.'
            }) {
                if boundary > target_chars / 2 {
                    end = start + boundary + 1;
                }
            }
        }
        let value = chars[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_string();
        if !value.is_empty() {
            let hash = hex::encode(Sha256::digest(value.as_bytes()));
            chunks.push(Chunk {
                index,
                start,
                end,
                content: value,
                hash,
            });
            index += 1;
        }
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(overlap_chars);
    }
    chunks
}

fn strip_frontmatter(content: &str) -> String {
    if !content.starts_with("---") {
        return content.to_string();
    }
    content
        .find("\n---")
        .map(|end| content[end + 4..].to_string())
        .unwrap_or_else(|| content.to_string())
}

fn replace_note_vectors(
    conn: &mut Connection,
    note_id: i64,
    model: &str,
    modified_ms: i64,
    chunks: &[Chunk],
    embeddings: &[Vec<f32>],
    dimensions: u32,
) -> AppResult<()> {
    let txn = conn.transaction().map_err(db_error)?;
    txn.execute(
        "DELETE FROM note_chunks WHERE note_id = ?1 AND model = ?2",
        params![note_id, model],
    )
    .map_err(db_error)?;
    for (chunk, embedding) in chunks.iter().zip(embeddings) {
        txn.execute(
            "INSERT INTO note_chunks(note_id, model, chunk_index, start_offset, end_offset, source_modified_ms, content_hash, content, dimensions, embedding, created_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![note_id, model, chunk.index, chunk.start as i64, chunk.end as i64, modified_ms, chunk.hash, chunk.content, dimensions as i64, vector_to_blob(embedding), now_ms()],
        ).map_err(db_error)?;
    }
    txn.execute(
        "INSERT INTO ai_vector_state(note_id, model, modified_ms, size, status, error, chunk_count, updated_at_ms)
         SELECT ?1, ?2, modified_ms, size, 'ready', NULL, ?3, ?4 FROM notes WHERE id = ?1
         ON CONFLICT(note_id, model) DO UPDATE SET modified_ms = excluded.modified_ms, size = excluded.size, status = 'ready', error = NULL, chunk_count = excluded.chunk_count, updated_at_ms = excluded.updated_at_ms",
        params![note_id, model, chunks.len() as i64, now_ms()],
    ).map_err(db_error)?;
    txn.commit().map_err(db_error)?;
    Ok(())
}

fn mark_error(
    conn: &Connection,
    note_id: i64,
    model: &str,
    identity: &crate::domain::NoteIdentity,
    error: &str,
) -> AppResult<()> {
    conn.execute(
        "DELETE FROM note_chunks WHERE note_id = ?1 AND model = ?2",
        params![note_id, model],
    )
    .map_err(db_error)?;
    conn.execute(
        "INSERT INTO ai_vector_state(note_id, model, modified_ms, size, status, error, chunk_count, updated_at_ms)
         VALUES (?1,?2,?3,?4,'error',?5,0,?6)
         ON CONFLICT(note_id, model) DO UPDATE SET modified_ms = excluded.modified_ms, size = excluded.size, status = 'error', error = excluded.error, chunk_count = 0, updated_at_ms = excluded.updated_at_ms",
        params![note_id, model, identity.modified_ms as i64, identity.size as i64, error, now_ms()],
    ).map_err(db_error)?;
    Ok(())
}

fn is_current_ready(
    conn: &Connection,
    note_id: i64,
    model: &str,
    modified_ms: i64,
    size: u64,
) -> AppResult<bool> {
    let value = conn.query_row("SELECT modified_ms, size, status FROM ai_vector_state WHERE note_id = ?1 AND model = ?2", params![note_id, model], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))).optional().map_err(db_error)?;
    Ok(value.is_some_and(|(mtime, stored_size, status)| {
        status == "ready" && mtime == modified_ms && stored_size == size as i64
    }))
}

fn status_from_db(conn: &Connection, settings: &AiSettings) -> AppResult<VectorIndexStatus> {
    let model = settings.embedding_model.trim();
    let total_notes = scalar(conn, "SELECT COUNT(*) FROM notes")?;
    let chunk_length_matches =
        stored_chunk_target_chars(conn, model) == settings.embedding_max_length();
    let indexed_notes = if chunk_length_matches {
        scalar_params(conn, "SELECT COUNT(*) FROM ai_vector_state s JOIN notes n ON n.id = s.note_id WHERE s.model = ?1 AND s.status = 'ready' AND s.modified_ms = n.modified_ms AND s.size = n.size", params![model])?
    } else {
        0
    };
    let failed_notes = if chunk_length_matches {
        scalar_params(conn, "SELECT COUNT(*) FROM ai_vector_state s JOIN notes n ON n.id = s.note_id WHERE s.model = ?1 AND s.status = 'error' AND s.modified_ms = n.modified_ms AND s.size = n.size", params![model])?
    } else {
        0
    };
    let chunk_count = if chunk_length_matches {
        scalar_params(
            conn,
            "SELECT COUNT(*) FROM note_chunks WHERE model = ?1",
            params![model],
        )?
    } else {
        0
    };
    let last_indexed_ms = meta_u128(conn, &model_meta_key("last_indexed_ms", model));
    let last_error = meta_string(conn, &model_meta_key("last_error", model));
    Ok(VectorIndexStatus {
        enabled: settings.enabled,
        model: model.to_string(),
        dimensions: if chunk_length_matches {
            scalar_params(
                conn,
                "SELECT COALESCE(MAX(dimensions), 0) FROM note_chunks WHERE model = ?1",
                params![model],
            )? as u32
        } else {
            0
        },
        total_notes,
        indexed_notes,
        pending_notes: total_notes
            .saturating_sub(indexed_notes)
            .saturating_sub(failed_notes),
        failed_notes,
        chunk_count,
        last_indexed_ms,
        last_error: (!last_error.is_empty()).then_some(last_error),
    })
}

fn scalar(conn: &Connection, sql: &str) -> AppResult<u64> {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|value| value.max(0) as u64)
        .map_err(db_error)
}
fn scalar_params(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> AppResult<u64> {
    conn.query_row(sql, params, |row| row.get::<_, i64>(0))
        .map(|value| value.max(0) as u64)
        .map_err(db_error)
}
fn meta_string(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM ai_vector_meta WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
    .unwrap_or_default()
}
fn meta_u128(conn: &Connection, key: &str) -> u128 {
    meta_string(conn, key).parse().unwrap_or(0)
}
fn stored_chunk_target_chars(conn: &Connection, model: &str) -> usize {
    meta_string(conn, &model_meta_key("chunk_target_chars", model))
        .parse()
        .unwrap_or(crate::domain::models::DEFAULT_AI_EMBEDDING_MAX_LENGTH as usize)
}
fn set_meta(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO ai_vector_meta(key, value) VALUES (?1,?2)",
        params![key, value],
    )
    .map(|_| ())
    .map_err(db_error)
}
fn model_meta_key(prefix: &str, model: &str) -> String {
    format!("{prefix}::{model}")
}
fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}
fn blob_to_vector(bytes: &[u8]) -> AppResult<Vec<f32>> {
    if bytes.len() % 4 != 0 {
        return Err(AppError::new(
            crate::domain::ErrorCode::Serialization,
            "Stored vector has an invalid binary format.",
        ));
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}
fn dot(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() {
        return -1.0;
    }
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}
fn db_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        crate::domain::ErrorCode::Io,
        "Vector index operation failed.",
    )
    .with_details(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_are_bounded_and_overlap_long_notes() {
        let content = format!("# Topic\n\n{}", "word ".repeat(900));
        let target_chars = 1_800;
        let chunks = make_chunks(&content, "topic.md", target_chars);
        assert!(chunks.len() > 1);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.content.chars().count() <= target_chars));
        assert!(chunks.windows(2).all(|pair| pair[1].start < pair[0].end));
    }

    #[test]
    fn chunk_length_is_configurable() {
        let content = format!("# Topic\n\n{}", "字".repeat(1_000));
        let chunks = make_chunks(&content, "topic.md", 200);
        assert!(chunks.len() > 5);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.content.chars().count() <= 200));
    }

    #[test]
    fn vectors_round_trip_as_little_endian_float32() {
        let source = vec![0.25_f32, -1.5, 2.0];
        let encoded = vector_to_blob(&source);
        assert_eq!(blob_to_vector(&encoded).unwrap(), source);
        assert!(blob_to_vector(&[1, 2, 3]).is_err());
    }
}
