use super::*;
use crate::infrastructure::index::schema::apply_schema;
use crate::services::vector_index::vector_to_blob;

pub(super) fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    apply_schema(&conn).unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -8000;",
    )
    .unwrap();
    conn
}

pub(super) fn add_note(conn: &Connection, id: i64) {
    conn.execute(
        "INSERT INTO notes(id, relative_path, file_name, extension, folder, modified_ms,
                           size, title, excerpt, indexed_at_ms)
         VALUES (?1, ?2, ?2, 'md', '', 10, 100, ?3, 'excerpt', 10)",
        params![id, format!("{id}.md"), format!("Note {id}")],
    )
    .unwrap();
}

pub(super) fn add_chunk(conn: &Connection, note: i64, model: &str, chunk: u32, vector: &[f32]) {
    conn.execute(
        "INSERT INTO note_chunks(note_id, model, chunk_index, start_offset, end_offset,
             source_modified_ms, content_hash, content, dimensions, embedding, created_at_ms)
         VALUES (?1, ?2, ?3, 0, 100, 10, 'hash', ?4, ?5, ?6, 10)",
        params![
            note,
            model,
            chunk,
            format!("chunk {chunk}: {}", "text ".repeat(360)),
            vector.len(),
            vector_to_blob(vector)
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO ai_vector_state(note_id, model, modified_ms, size, status,
             chunk_count, updated_at_ms) VALUES (?1, ?2, 10, 100, 'ready', 1, 10)",
        params![note, model],
    )
    .unwrap();
}

#[test]
fn returns_best_chunk_per_note_and_orders_top_k() {
    let conn = database();
    for note in 1..=3 {
        add_note(&conn, note);
    }
    add_chunk(&conn, 1, "model", 0, &[0.1, 0.0]);
    add_chunk(&conn, 1, "model", 1, &[0.9, 0.0]);
    add_chunk(&conn, 2, "model", 0, &[0.8, 0.0]);
    add_chunk(&conn, 3, "model", 0, &[0.7, 0.0]);
    let results = search_vectors(&conn, "model", &[1.0, 0.0], 2).unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].relative_path, "1.md");
    assert_eq!(results[0].chunk_index, 1);
    assert!(results[0].content.starts_with("chunk 1:"));
    assert_eq!(results[0].title, "Note 1");
    assert_eq!(results[0].excerpt, "excerpt");
    assert_eq!(results[1].relative_path, "2.md");
    assert_eq!(
        search_vectors(&conn, "model", &[1.0, 0.0], 0)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn filters_other_models_stale_failed_deleted_and_incompatible_vectors() {
    let conn = database();
    for note in 1..=9 {
        add_note(&conn, note);
        add_chunk(&conn, note, "model", 0, &[1.0, 0.0]);
    }
    conn.execute_batch(
        "UPDATE ai_vector_state SET model = 'other' WHERE note_id = 2;
         UPDATE note_chunks SET model = 'other' WHERE note_id = 2;
         UPDATE notes SET modified_ms = 20 WHERE id = 3;
         UPDATE notes SET size = 200 WHERE id = 4;
         UPDATE ai_vector_state SET status = 'error' WHERE note_id = 5;
         DELETE FROM notes WHERE id = 6;",
    )
    .unwrap();
    for (note, vector) in [
        (7, vec![1.0]),
        (8, vec![f32::NAN, 0.0]),
        (9, vec![f32::INFINITY, 0.0]),
    ] {
        conn.execute(
            "UPDATE note_chunks SET embedding = ?1 WHERE note_id = ?2",
            params![vector_to_blob(&vector), note],
        )
        .unwrap();
    }
    let results = search_vectors(&conn, "model", &[1.0, 0.0], 20).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].relative_path, "1.md");
    assert!(search_vectors(&conn, "missing", &[1.0, 0.0], 20)
        .unwrap()
        .is_empty());
}

#[test]
fn ties_prefer_earlier_note_and_chunk_even_with_reverse_insertion() {
    let conn = database();
    for note in (1..=4).rev() {
        add_note(&conn, note);
        add_chunk(&conn, note, "model", 1, &[1.0]);
        add_chunk(&conn, note, "model", 0, &[1.0]);
    }
    let results = search_vectors(&conn, "model", &[1.0], 2).unwrap();
    assert_eq!(
        results
            .iter()
            .map(|r| r.relative_path.as_str())
            .collect::<Vec<_>>(),
        ["1.md", "2.md"]
    );
    assert!(results.iter().all(|r| r.chunk_index == 0));
}

#[test]
fn validates_blobs_and_query_vectors() {
    assert_eq!(
        dot_blob(&[0.5, -2.0], &vector_to_blob(&[0.25, -1.5])).unwrap(),
        Some(3.125)
    );
    assert!(dot_blob(&[1.0], &[1, 2, 3]).is_err());
    assert_eq!(
        dot_blob(&[1.0], &vector_to_blob(&[1.0, 2.0])).unwrap(),
        None
    );
    let conn = database();
    assert!(search_vectors(&conn, "model", &[], 20).is_err());
    assert!(search_vectors(&conn, "model", &[f32::NAN], 20).is_err());
    add_note(&conn, 1);
    add_chunk(&conn, 1, "model", 0, &[1.0]);
    conn.execute("UPDATE note_chunks SET embedding = X'010203'", [])
        .unwrap();
    assert!(search_vectors(&conn, "model", &[1.0], 20).is_err());
    assert!(conn.is_autocommit());
}

pub(super) fn generated_database(notes: i64, dimensions: usize) -> (Connection, Vec<f32>) {
    let conn = database();
    let mut seed = 42_u64;
    let mut next_vector = || {
        let mut values = (0..dimensions)
            .map(|_| {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                (seed >> 32) as u32 as f32 / u32::MAX as f32 - 0.5
            })
            .collect::<Vec<_>>();
        let norm = values.iter().map(|x| x * x).sum::<f32>().sqrt();
        values.iter_mut().for_each(|value| *value /= norm);
        values
    };
    let txn = conn.unchecked_transaction().unwrap();
    for note in 1..=notes {
        add_note(&txn, note);
        for chunk in 0..4 {
            add_chunk(&txn, note, "model", chunk, &next_vector());
        }
    }
    txn.commit().unwrap();
    (conn, next_vector())
}

#[test]
fn matches_original_full_scan_for_multiple_limits_and_queries() {
    let (conn, query) = generated_database(150, 32);
    for query in [query.clone(), query.iter().map(|v| -v).collect()] {
        for limit in [0, 1, 7, 20, 100, 500] {
            assert_eq!(
                search_vectors(&conn, "model", &query, limit).unwrap(),
                original_search(&conn, "model", &query, limit)
            );
        }
    }
}

#[test]
#[ignore = "manual local retrieval benchmark; excludes embedding API latency"]
fn benchmark_local_search() {
    use std::time::{Duration, Instant};
    let (conn, query) = generated_database(1_000, 1_536);
    let expected = original_search(&conn, "model", &query, 20);
    assert_eq!(
        search_vectors(&conn, "model", &query, 20).unwrap(),
        expected
    );
    let mut old = Duration::ZERO;
    let mut new = Duration::ZERO;
    for round in 0..10 {
        // Alternate order to reduce warm-cache bias.
        for optimized in [round % 2 == 0, round % 2 != 0] {
            let start = Instant::now();
            let results = if optimized {
                search_vectors(&conn, "model", &query, 20).unwrap()
            } else {
                original_search(&conn, "model", &query, 20)
            };
            let elapsed = start.elapsed();
            assert_eq!(results, expected);
            if optimized {
                new += elapsed;
            } else {
                old += elapsed;
            }
        }
    }
    eprintln!("1,000 notes / 4,000 chunks / 1,536 dimensions / K=20: original {:?}, optimized {:?} per query ({:.2}x)",
        old / 10, new / 10, old.as_secs_f64() / new.as_secs_f64());
}

// Pre-optimization implementation retained as a correctness and timing baseline.
fn original_search(
    conn: &Connection,
    model: &str,
    query_vector: &[f32],
    limit: u32,
) -> Vec<SemanticSearchResult> {
    let mut statement = conn
        .prepare(
            "SELECT n.relative_path, n.title, n.excerpt, c.chunk_index, c.content, c.embedding
               FROM note_chunks c
               JOIN notes n ON n.id = c.note_id
               JOIN ai_vector_state s ON s.note_id = c.note_id AND s.model = c.model
              WHERE c.model = ?1 AND s.status = 'ready'
                AND s.modified_ms = n.modified_ms AND s.size = n.size
              ORDER BY c.note_id, c.chunk_index",
        )
        .unwrap();
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
        .unwrap();
    let mut best: HashMap<String, SemanticSearchResult> = HashMap::new();
    for row in rows {
        let (path, title, excerpt, chunk_index, content, bytes) = row.unwrap();
        let vector = bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
            .collect::<Vec<_>>();
        let score = query_vector
            .iter()
            .zip(&vector)
            .map(|(a, b)| a * b)
            .sum::<f32>();
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
    results
}
