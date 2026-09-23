use super::super::tests::{add_chunk, add_note, database, generated_database};
use super::*;
use crate::services::vector_index::{mark_error, replace_note_vectors, Chunk};
use std::collections::HashSet;

fn query(
    conn: &Connection,
    cache: &HnswCache,
    query: &[f32],
    limit: u32,
) -> Vec<SemanticSearchResult> {
    search_cached(conn, Path::new("/workspace"), "model", query, limit, cache).unwrap();
    wait_for_build(cache);
    search_cached(conn, Path::new("/workspace"), "model", query, limit, cache).unwrap()
}

fn wait_for_build(cache: &HnswCache) {
    let (state, timeout) = cache
        .inner
        .finished
        .wait_timeout_while(
            cache.inner.state.lock().unwrap(),
            std::time::Duration::from_secs(60),
            |s| s.building,
        )
        .unwrap();
    assert!(
        !timeout.timed_out() && !state.building,
        "background build timed out"
    );
}

fn cached_graph(cache: &HnswCache) -> Arc<Graph> {
    cache
        .inner
        .state
        .lock()
        .unwrap()
        .entry
        .as_ref()
        .unwrap()
        .1
        .clone()
        .expect("HNSW path")
}

fn recall(actual: &[SemanticSearchResult], exact: &[SemanticSearchResult]) -> f64 {
    let paths = actual
        .iter()
        .map(|r| &r.relative_path)
        .collect::<HashSet<_>>();
    exact
        .iter()
        .filter(|r| paths.contains(&r.relative_path))
        .count() as f64
        / exact.len() as f64
}

#[test]
fn small_libraries_use_exact_search_without_a_graph() {
    let (conn, vector) = generated_database(20, 32);
    let cache = HnswCache::default();
    assert_eq!(
        query(&conn, &cache, &vector, 20),
        exact_search(&conn, "model", &vector, 20).unwrap()
    );
    assert!(cache
        .inner
        .state
        .lock()
        .unwrap()
        .entry
        .as_ref()
        .unwrap()
        .1
        .is_none());
}

#[test]
fn searches_use_exact_results_while_a_graph_is_building() {
    let (conn, vector) = generated_database(20, 16);
    let cache = HnswCache::default();
    cache.inner.state.lock().unwrap().building = true;
    let result =
        search_cached(&conn, Path::new("/workspace"), "model", &vector, 20, &cache).unwrap();
    assert_eq!(result, exact_search(&conn, "model", &vector, 20).unwrap());
    assert!(cache.inner.state.lock().unwrap().building);
}

#[test]
fn distance_handles_tail_dimensions_and_normalization_roundoff() {
    for dimensions in [1, 7, 8, 9, 31, 32, 33, 1_536] {
        let a = vec![(1.0 / dimensions as f32).sqrt(); dimensions];
        let b = a.iter().map(|v| -v).collect::<Vec<_>>();
        assert!(CosineDistance.eval(&a, &a) < 0.0001);
        assert!((CosineDistance.eval(&a, &b) - 2.0).abs() < 0.0001);
    }
}

#[test]
fn hnsw_reuses_graph_and_reranks_with_exact_scores() {
    let (conn, vector) = generated_database(300, 32);
    let cache = HnswCache::default();
    let first = query(&conn, &cache, &vector, 20);
    let graph = cached_graph(&cache);
    let second = query(&conn, &cache, &vector, 20);
    assert!(Arc::ptr_eq(&graph, &cached_graph(&cache)));
    assert_eq!(first, second);
    let exact = exact_search(&conn, "model", &vector, 20).unwrap();
    assert!(recall(&first, &exact) >= 0.9);
    for actual in &first {
        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT c.embedding FROM note_chunks c JOIN notes n ON n.id = c.note_id
             WHERE n.relative_path = ?1 AND c.chunk_index = ?2",
                params![actual.relative_path, actual.chunk_index],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(Some(actual.score), dot_blob(&vector, &bytes).unwrap());
    }
}

#[test]
fn vector_replacement_invalidates_cache_atomically() {
    let (mut conn, vector) = generated_database(300, 32);
    let cache = HnswCache::default();
    query(&conn, &cache, &vector, 20);
    let before = cached_graph(&cache);
    let previous_revision = revision(&conn).unwrap();
    let chunk = Chunk {
        index: 0,
        start: 0,
        end: 7,
        content: "updated".into(),
        hash: "new".into(),
    };
    replace_note_vectors(&mut conn, 300, "model", 10, &[chunk], &[vector.clone()], 32).unwrap();
    assert_ne!(revision(&conn).unwrap(), previous_revision);
    let results = query(&conn, &cache, &vector, 20);
    assert_eq!(results[0].relative_path, "300.md");
    assert_eq!(results[0].content, "updated");
    assert!(!Arc::ptr_eq(&before, &cached_graph(&cache)));
    let committed = revision(&conn).unwrap();
    {
        let txn = conn.unchecked_transaction().unwrap();
        bump_revision(&txn).unwrap();
    }
    assert_eq!(
        revision(&conn).unwrap(),
        committed,
        "rolled-back writes must not invalidate"
    );
    mark_error(
        &conn,
        300,
        "model",
        &crate::domain::NoteIdentity {
            relative_path: "300.md".into(),
            file_name: "300.md".into(),
            extension: "md".into(),
            modified_ms: 10,
            size: 100,
        },
        "embedding failed",
    )
    .unwrap();
    assert_ne!(revision(&conn).unwrap(), committed);
    assert!(query(&conn, &cache, &vector, 20)
        .iter()
        .all(|r| r.relative_path != "300.md"));
}

#[test]
fn cached_graph_obeys_current_deletions_edits_failures_and_renames() {
    let (conn, vector) = generated_database(300, 32);
    let cache = HnswCache::default();
    let initial = query(&conn, &cache, &vector, 20);
    let graph = cached_graph(&cache);
    for (i, result) in initial.iter().take(4).enumerate() {
        let sql = match i {
            0 => "DELETE FROM notes WHERE relative_path = ?1",
            1 => "UPDATE notes SET modified_ms = 20 WHERE relative_path = ?1",
            2 => "UPDATE ai_vector_state SET status = 'error' WHERE note_id = (SELECT id FROM notes WHERE relative_path = ?1)",
            _ => "UPDATE notes SET relative_path = 'renamed.md', title = 'Renamed' WHERE relative_path = ?1",
        };
        conn.execute(sql, params![result.relative_path]).unwrap();
    }
    let results = query(&conn, &cache, &vector, 20);
    assert_eq!(results.len(), 20);
    assert!(results.iter().all(|r| !initial
        .iter()
        .take(4)
        .any(|old| old.relative_path == r.relative_path)));
    assert!(results
        .iter()
        .any(|r| r.relative_path == "renamed.md" && r.title == "Renamed"));
    assert!(
        Arc::ptr_eq(&graph, &cached_graph(&cache)),
        "note metadata changes need no graph rebuild"
    );
    // Extreme filtering must still return all remaining notes via exact fallback.
    conn.execute(
        "UPDATE ai_vector_state SET status = 'error' WHERE note_id > 5",
        [],
    )
    .unwrap();
    assert_eq!(
        query(&conn, &cache, &vector, 20),
        exact_search(&conn, "model", &vector, 20).unwrap()
    );
}

#[test]
fn long_notes_do_not_starve_other_notes() {
    let conn = database();
    add_note(&conn, 1);
    for chunk in 0..1_030 {
        add_chunk(&conn, 1, "model", chunk, &[1.0, 0.0]);
    }
    for note in 2..=6 {
        add_note(&conn, note);
        add_chunk(&conn, note, "model", 0, &[0.0, 1.0]);
    }
    let cache = HnswCache::default();
    let results = query(&conn, &cache, &[1.0, 0.0], 6);
    assert_eq!(results.len(), 6);
    assert_eq!(results[0].relative_path, "1.md");
    assert_eq!(
        results
            .iter()
            .map(|r| &r.relative_path)
            .collect::<HashSet<_>>()
            .len(),
        6
    );
}

#[test]
fn cache_isolated_by_workspace_model_dimensions_and_database_generation() {
    let (conn, vector) = generated_database(260, 16);
    let cache = HnswCache::default();
    query(&conn, &cache, &vector, 20);
    let original = cached_graph(&cache);
    search_cached(&conn, Path::new("/another"), "model", &vector, 20, &cache).unwrap();
    wait_for_build(&cache);
    assert!(!Arc::ptr_eq(&original, &cached_graph(&cache)));
    assert!(
        search_cached(&conn, Path::new("/another"), "other", &vector, 20, &cache)
            .unwrap()
            .is_empty()
    );
    assert!(
        search_cached(&conn, Path::new("/another"), "model", &[1.0], 20, &cache)
            .unwrap()
            .is_empty()
    );
    let new_db = database();
    add_note(&new_db, 1);
    add_chunk(&new_db, 1, "model", 0, &vector);
    assert_eq!(query(&new_db, &cache, &vector, 20).len(), 1);
    assert_ne!(revision(&conn).unwrap(), revision(&new_db).unwrap());
}

#[test]
#[ignore = "manual Release benchmark; measures cold build, warm retrieval and recall"]
fn benchmark_hnsw() {
    use std::time::{Duration, Instant};
    let (conn, vector) = generated_database(1_000, 1_536);
    let cache = HnswCache::default();
    let start = Instant::now();
    let first =
        search_cached(&conn, Path::new("/workspace"), "model", &vector, 20, &cache).unwrap();
    let first_query = start.elapsed();
    assert_eq!(first, exact_search(&conn, "model", &vector, 20).unwrap());
    wait_for_build(&cache);
    let cold = start.elapsed();
    let mut exact_elapsed = Duration::ZERO;
    let mut ann_elapsed = Duration::ZERO;
    let mut total_recall = 0.0;
    for offset in 0..20 {
        // Held-out queries, not vectors already stored in the graph.
        let mut query_vector = vector.clone();
        query_vector.rotate_left(offset * 53);
        let start = Instant::now();
        let exact = exact_search(&conn, "model", &query_vector, 20).unwrap();
        exact_elapsed += start.elapsed();
        let start = Instant::now();
        let ann = search_cached(
            &conn,
            Path::new("/workspace"),
            "model",
            &query_vector,
            20,
            &cache,
        )
        .unwrap();
        ann_elapsed += start.elapsed();
        total_recall += recall(&ann, &exact);
    }
    eprintln!("1,000 notes / 4,000 chunks / 1,536 dimensions / K=20 / 20 held-out queries: first query {:?}, background build ready {:?}, exact {:?}, HNSW {:?}, speedup {:.2}x, recall@20 {:.1}%",
        first_query, cold, exact_elapsed / 20, ann_elapsed / 20, exact_elapsed.as_secs_f64() / ann_elapsed.as_secs_f64(), total_recall * 5.0);
    assert!(total_recall / 20.0 >= 0.95);
}
