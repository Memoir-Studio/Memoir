use super::{
    connection::{sidecar_len, INDEX_FILE, INDEX_RELATIVE_PATH},
    schema::{user_version, CURRENT_USER_VERSION},
    writes::{normalize_tag, parse_algo_version},
};
use crate::domain::{
    note_parse::{INDEX_READ_CAP, PARSE_ALGO_VERSION},
    FolderStat, LibraryNav, LibraryPage, LibraryQuery, LibraryStats, NoteFile, TagStat,
    WorkspaceIndexInfo,
};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::path::Path;

const RECENT_WINDOW_MS: i64 = 7 * 86_400_000;

/// Search rule (singular — do not mix):
/// - Empty `q` does not touch FTS or LIKE.
/// - If `q` contains any ASCII letter `[A-Za-z]`, query `notes_fts` with quoted tokens (AND).
/// - Otherwise (CJK, digits, punctuation) use `LIKE '%q%'` on title, excerpt, and relative_path.
pub fn query_uses_fts(q: &str) -> bool {
    q.chars().any(|ch| ch.is_ascii_alphabetic())
}

pub fn query_library(conn: &Connection, query: &LibraryQuery) -> rusqlite::Result<LibraryPage> {
    let now = if query.now_ms > 0 {
        query.now_ms
    } else {
        super::schema::now_ms()
    };
    let notes = query_notes(conn, query, now)?;
    let stats = collect_stats(conn, query.favorite_paths.as_deref().unwrap_or(&[]), now)?;
    Ok(LibraryPage { notes, stats })
}

fn query_notes(conn: &Connection, query: &LibraryQuery, now: i64) -> rusqlite::Result<Vec<NoteFile>> {
    let mut sql = String::from(
        "
        SELECT n.id, n.relative_path, n.file_name, n.extension, n.modified_ms, n.size,
               n.title, n.excerpt
          FROM notes n
         WHERE 1 = 1
        ",
    );
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();

    match query.nav {
        LibraryNav::All => {}
        LibraryNav::Recent => {
            sql.push_str(" AND n.modified_ms >= ?");
            binds.push((now - RECENT_WINDOW_MS).into());
        }
        LibraryNav::Uncategorized => {
            sql.push_str(" AND NOT EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id)");
        }
        LibraryNav::Favorites => {
            let paths = query.favorite_paths.as_deref().unwrap_or(&[]);
            if paths.is_empty() {
                sql.push_str(" AND 0");
            } else {
                sql.push_str(" AND n.relative_path IN (");
                for (index, path) in paths.iter().enumerate() {
                    if index > 0 {
                        sql.push(',');
                    }
                    sql.push('?');
                    binds.push(path.clone().into());
                }
                sql.push(')');
            }
        }
    }

    if let Some(folder) = query.folder.as_ref() {
        sql.push_str(" AND n.folder = ?");
        binds.push(folder.clone().into());
    }

    if let Some(tag) = query.tag.as_ref() {
        sql.push_str(" AND EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag_norm = ?)");
        binds.push(normalize_tag(tag).into());
    }

    let q = query.q.trim();
    if !q.is_empty() {
        if query_uses_fts(q) {
            if let Some(match_query) = fts_match_query(q) {
                sql.push_str(" AND n.id IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?)");
                binds.push(match_query.into());
            }
        } else {
            let needle = like_contains(q);
            sql.push_str(
                " AND (n.title LIKE ? ESCAPE '\\' OR n.excerpt LIKE ? ESCAPE '\\' OR n.relative_path LIKE ? ESCAPE '\\')",
            );
            binds.push(needle.clone().into());
            binds.push(needle.clone().into());
            binds.push(needle.into());
        }
    }

    sql.push_str(" ORDER BY n.modified_ms DESC, n.relative_path ASC");

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(binds), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            NoteFile {
                relative_path: row.get(1)?,
                file_name: row.get(2)?,
                extension: row.get(3)?,
                modified_ms: row.get::<_, i64>(4)?.max(0) as u128,
                size: row.get::<_, i64>(5)?.max(0) as u64,
                title: row.get(6)?,
                tags: Vec::new(),
                excerpt: row.get(7)?,
            },
        ))
    })?;
    let mut notes = Vec::new();
    let mut ids = Vec::new();
    for row in rows {
        let (id, note) = row?;
        ids.push(id);
        notes.push(note);
    }
    attach_tags(conn, &ids, &mut notes)?;
    Ok(notes)
}

fn attach_tags(conn: &Connection, ids: &[i64], notes: &mut [NoteFile]) -> rusqlite::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut sql = String::from("SELECT note_id, tag FROM note_tags WHERE note_id IN (");
    for (index, _) in ids.iter().enumerate() {
        if index > 0 {
            sql.push(',');
        }
        sql.push('?');
    }
    sql.push(')');
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(ids.iter().copied()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut by_id: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
    for row in rows {
        let (id, tag) = row?;
        by_id.entry(id).or_default().push(tag);
    }
    for (id, note) in ids.iter().zip(notes.iter_mut()) {
        if let Some(tags) = by_id.remove(id) {
            note.tags = tags;
        }
    }
    Ok(())
}

fn collect_stats(conn: &Connection, favorite_paths: &[String], now: i64) -> rusqlite::Result<LibraryStats> {
    let total = count_sql(conn, "SELECT COUNT(*) FROM notes");
    let recent = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE modified_ms >= ?1",
            params![now - RECENT_WINDOW_MS],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
        .max(0) as u64;
    let uncategorized = count_sql(
        conn,
        "SELECT COUNT(*) FROM notes n WHERE NOT EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id)",
    );
    let favorites = if favorite_paths.is_empty() {
        0
    } else {
        let mut sql = String::from("SELECT COUNT(*) FROM notes WHERE relative_path IN (");
        for (index, _) in favorite_paths.iter().enumerate() {
            if index > 0 {
                sql.push(',');
            }
            sql.push('?');
        }
        sql.push(')');
        let mut statement = conn.prepare(&sql)?;
        statement
            .query_row(params_from_iter(favorite_paths.iter()), |row| row.get::<_, i64>(0))
            .unwrap_or(0)
            .max(0) as u64
    };

    let mut folders = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT folder, COUNT(*) FROM notes GROUP BY folder ORDER BY folder ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FolderStat {
                folder: row.get(0)?,
                count: row.get::<_, i64>(1)?.max(0) as u64,
            })
        })?;
        for row in rows {
            folders.push(row?);
        }
    }

    let mut tags = Vec::new();
    {
        let mut statement = conn.prepare(
            "
            SELECT c.tag_norm, t.tag, c.cnt
              FROM (
                    SELECT tag_norm, MAX(note_id) AS max_id, COUNT(*) AS cnt
                      FROM note_tags
                     GROUP BY tag_norm
                   ) c
              JOIN note_tags t
                ON t.tag_norm = c.tag_norm AND t.note_id = c.max_id
             ORDER BY c.tag_norm ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TagStat {
                tag_norm: row.get(0)?,
                tag: row.get(1)?,
                count: row.get::<_, i64>(2)?.max(0) as u64,
            })
        })?;
        for row in rows {
            tags.push(row?);
        }
    }

    Ok(LibraryStats {
        total,
        recent,
        favorites,
        uncategorized,
        folders,
        tags,
        truncated: false,
    })
}

fn fts_match_query(q: &str) -> Option<String> {
    let tokens: Vec<String> = q
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', " ")))
        .filter(|token| token.len() > 2)
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}

fn like_contains(q: &str) -> String {
    let escaped = q
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn count_sql(conn: &Connection, sql: &str) -> u64 {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .ok()
        .map(|value| value.max(0) as u64)
        .unwrap_or(0)
}

fn meta_string(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
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

fn meta_u64(conn: &Connection, key: &str) -> u64 {
    meta_string(conn, key).parse().unwrap_or(0)
}

pub fn collect_index_info(conn: &Connection, root: &Path, persistent: bool) -> WorkspaceIndexInfo {
    let db_path = root.join(".memoir").join(INDEX_FILE);
    let (file_size, wal_size, shm_size) = if persistent {
        (
            sidecar_len(&db_path, ""),
            sidecar_len(&db_path, "-wal"),
            sidecar_len(&db_path, "-shm"),
        )
    } else {
        (0, 0, 0)
    };
    let parse_algo = parse_algo_version(conn).unwrap_or(PARSE_ALGO_VERSION);
    let index_read_cap = meta_u64(conn, "index_read_cap");
    WorkspaceIndexInfo {
        persistent,
        relative_path: INDEX_RELATIVE_PATH.into(),
        file_size,
        wal_size,
        shm_size,
        schema_version: user_version(conn).unwrap_or(CURRENT_USER_VERSION),
        schema_name: {
            let name = meta_string(conn, "schema_name");
            if name.is_empty() {
                "memoir-index".into()
            } else {
                name
            }
        },
        parse_algo_version: parse_algo,
        index_read_cap: if index_read_cap == 0 {
            INDEX_READ_CAP as u64
        } else {
            index_read_cap
        },
        created_ms: meta_u128(conn, "created_ms"),
        last_reconcile_ms: meta_u128(conn, "last_reconcile_ms"),
        note_count: count_sql(conn, "SELECT COUNT(*) FROM notes"),
        tag_count: count_sql(conn, "SELECT COUNT(DISTINCT tag_norm) FROM note_tags"),
        tag_link_count: count_sql(conn, "SELECT COUNT(*) FROM note_tags"),
        truncated_count: count_sql(conn, "SELECT COUNT(*) FROM notes WHERE parse_truncated = 1"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::index::{
        connection::open_or_rebuild,
        writes::{note_row, upsert_note},
    };
    use tempfile::tempdir;

    fn seed(conn: &Connection) {
        let rows = [
            (
                "work/alpha.md",
                "alpha.md",
                100_i64,
                "Alpha",
                "First project",
                vec!["work".to_string()],
            ),
            (
                "beta.mdx",
                "beta.mdx",
                1_i64,
                "Beta",
                "Second note",
                Vec::new(),
            ),
            (
                "日记/today.md",
                "today.md",
                50_i64,
                "今日笔记",
                "写一点今天的事",
                vec!["日记".to_string()],
            ),
        ];
        for (path, name, mtime, title, excerpt, tags) in rows {
            let row = note_row(
                path.into(),
                name.into(),
                if path.ends_with(".mdx") { "mdx" } else { "md" }.into(),
                mtime as u128,
                10,
                false,
                title.into(),
                excerpt.into(),
                &tags,
            );
            upsert_note(conn, &row).unwrap();
        }
    }

    #[test]
    fn query_matches_filter_notes_corpus() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        seed(&index.conn);

        let all = query_library(&index.conn, &LibraryQuery::default()).unwrap();
        assert_eq!(all.stats.total, 3);
        assert_eq!(all.stats.uncategorized, 1);
        assert_eq!(all.notes.len(), 3);

        let project = query_library(
            &index.conn,
            &LibraryQuery {
                q: "project".into(),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(
            project.notes.iter().map(|n| n.relative_path.as_str()).collect::<Vec<_>>(),
            vec!["work/alpha.md"]
        );
        assert!(query_uses_fts("project"));

        let uncategorized = query_library(
            &index.conn,
            &LibraryQuery {
                nav: LibraryNav::Uncategorized,
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(uncategorized.notes.len(), 1);
        assert_eq!(uncategorized.notes[0].relative_path, "beta.mdx");

        let folder = query_library(
            &index.conn,
            &LibraryQuery {
                folder: Some("work".into()),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(folder.notes.len(), 1);
        assert_eq!(folder.notes[0].relative_path, "work/alpha.md");

        let root_folder = query_library(
            &index.conn,
            &LibraryQuery {
                folder: Some(String::new()),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(root_folder.notes.len(), 1);
        assert_eq!(root_folder.notes[0].relative_path, "beta.mdx");

        let tag = query_library(
            &index.conn,
            &LibraryQuery {
                tag: Some("WORK".into()),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(tag.notes.len(), 1);
        assert_eq!(tag.notes[0].tags, vec!["work"]);

        let favorites = query_library(
            &index.conn,
            &LibraryQuery {
                nav: LibraryNav::Favorites,
                favorite_paths: Some(vec!["work/alpha.md".into()]),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(favorites.notes.len(), 1);
        assert_eq!(favorites.stats.favorites, 1);

        let recent = query_library(
            &index.conn,
            &LibraryQuery {
                nav: LibraryNav::Recent,
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert_eq!(recent.notes.len(), 3);
        assert_eq!(recent.stats.recent, 3);

        let cjk = query_library(
            &index.conn,
            &LibraryQuery {
                q: "笔记".into(),
                now_ms: 100,
                ..LibraryQuery::default()
            },
        )
        .unwrap();
        assert!(!query_uses_fts("笔记"));
        assert_eq!(cjk.notes.len(), 1);
        assert_eq!(cjk.notes[0].title, "今日笔记");
    }
}
