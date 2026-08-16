use super::schema::now_ms;
use crate::domain::{folder_of, NoteFile};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct NoteRow {
    #[allow(dead_code)]
    pub id: i64,
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
    pub folder: String,
    pub modified_ms: i64,
    pub size: i64,
    pub parse_truncated: i64,
    pub title: String,
    pub excerpt: String,
    pub tags: Vec<String>,
}

impl NoteRow {
    pub fn to_note_file(&self) -> NoteFile {
        NoteFile {
            relative_path: self.relative_path.clone(),
            file_name: self.file_name.clone(),
            extension: self.extension.clone(),
            modified_ms: self.modified_ms.max(0) as u128,
            size: self.size.max(0) as u64,
            title: self.title.clone(),
            tags: self.tags.clone(),
            excerpt: self.excerpt.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NoteIdentityRow {
    pub relative_path: String,
    pub modified_ms: i64,
    pub size: i64,
    pub parse_truncated: i64,
}

#[derive(Debug, Clone)]
pub struct DirCacheRow {
    pub relative_dir: String,
    pub modified_ms: i64,
    pub size: i64,
    pub entry_count: i64,
}

pub fn note_row(
    relative_path: String,
    file_name: String,
    extension: String,
    modified_ms: u128,
    size: u64,
    parse_truncated: bool,
    title: String,
    excerpt: String,
    tags: &[String],
) -> NoteRow {
    let folder = folder_of(&relative_path);
    NoteRow {
        id: 0,
        relative_path,
        file_name,
        extension,
        folder,
        modified_ms: i64::try_from(modified_ms).unwrap_or(i64::MAX),
        size: i64::try_from(size).unwrap_or(i64::MAX),
        parse_truncated: i64::from(parse_truncated),
        title,
        excerpt,
        tags: tags.to_vec(),
    }
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn parse_algo_version(conn: &Connection) -> rusqlite::Result<u32> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'parse_algo_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|item| item.parse().ok())
        .unwrap_or(crate::domain::note_parse::PARSE_ALGO_VERSION))
}

pub fn select_identities(conn: &Connection) -> rusqlite::Result<Vec<NoteIdentityRow>> {
    let mut statement = conn.prepare(
        "SELECT relative_path, modified_ms, size, parse_truncated FROM notes",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(NoteIdentityRow {
            relative_path: row.get(0)?,
            modified_ms: row.get(1)?,
            size: row.get(2)?,
            parse_truncated: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn load_dir_cache(conn: &Connection) -> rusqlite::Result<HashMap<String, DirCacheRow>> {
    let mut statement =
        conn.prepare("SELECT relative_dir, modified_ms, size, entry_count FROM dir_cache")?;
    let rows = statement.query_map([], |row| {
        Ok(DirCacheRow {
            relative_dir: row.get(0)?,
            modified_ms: row.get(1)?,
            size: row.get(2)?,
            entry_count: row.get(3)?,
        })
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let row = row?;
        map.insert(row.relative_dir.clone(), row);
    }
    Ok(map)
}

pub fn replace_dir_cache(
    conn: &Connection,
    walked: &[DirCacheRow],
    reused: &[String],
) -> rusqlite::Result<()> {
    let existing: Vec<String> = {
        let mut statement = conn.prepare("SELECT relative_dir FROM dir_cache")?;
        let rows = statement.query_map([], |row| row.get(0))?;
        let collected = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        collected
    };
    let mut keep: HashSet<String> = walked
        .iter()
        .map(|row| row.relative_dir.clone())
        .collect();
    for dir in reused {
        keep.insert(dir.clone());
        for name in &existing {
            if dir.is_empty() || name == dir || name.starts_with(&format!("{dir}/")) {
                keep.insert(name.clone());
            }
        }
    }
    for name in existing {
        if !keep.contains(&name) {
            conn.execute("DELETE FROM dir_cache WHERE relative_dir = ?1", params![name])?;
        }
    }
    for row in walked {
        conn.execute(
            "
            INSERT INTO dir_cache(relative_dir, modified_ms, size, entry_count)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(relative_dir) DO UPDATE SET
                modified_ms = excluded.modified_ms,
                size = excluded.size,
                entry_count = excluded.entry_count
            ",
            params![row.relative_dir, row.modified_ms, row.size, row.entry_count],
        )?;
    }
    Ok(())
}

pub fn note_id_for_path(conn: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM notes WHERE relative_path = ?1",
        params![path],
        |row| row.get(0),
    )
    .optional()
}

pub fn upsert_note(conn: &Connection, row: &NoteRow) -> rusqlite::Result<i64> {
    conn.execute(
        "
        INSERT INTO notes (
            relative_path, file_name, extension, folder, modified_ms, size,
            parse_truncated, title, excerpt, indexed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(relative_path) DO UPDATE SET
            file_name = excluded.file_name,
            extension = excluded.extension,
            folder = excluded.folder,
            modified_ms = excluded.modified_ms,
            size = excluded.size,
            parse_truncated = excluded.parse_truncated,
            title = excluded.title,
            excerpt = excluded.excerpt,
            indexed_at_ms = excluded.indexed_at_ms
        ",
        params![
            row.relative_path,
            row.file_name,
            row.extension,
            row.folder,
            row.modified_ms,
            row.size,
            row.parse_truncated,
            row.title,
            row.excerpt,
            now_ms()
        ],
    )?;
    let id = note_id_for_path(conn, &row.relative_path)?.unwrap_or(conn.last_insert_rowid());
    replace_tags(conn, id, &row.tags)?;
    sync_fts(conn, id, &row.title, &row.excerpt, &row.relative_path, &row.tags)?;
    Ok(id)
}

pub fn cas_delete(conn: &Connection, path: &str, modified_ms: i64, size: i64) -> rusqlite::Result<usize> {
    let id = match note_id_for_path(conn, path)? {
        Some(id) => id,
        None => return Ok(0),
    };
    let affected = conn.execute(
        "DELETE FROM notes WHERE relative_path = ?1 AND modified_ms = ?2 AND size = ?3",
        params![path, modified_ms, size],
    )?;
    if affected == 1 {
        let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![id]);
    }
    Ok(affected)
}

pub fn cas_update(
    conn: &Connection,
    row: &NoteRow,
    expected_mtime: i64,
    expected_size: i64,
) -> rusqlite::Result<usize> {
    let affected = conn.execute(
        "
        UPDATE notes SET
            file_name = ?1,
            extension = ?2,
            folder = ?3,
            modified_ms = ?4,
            size = ?5,
            parse_truncated = ?6,
            title = ?7,
            excerpt = ?8,
            indexed_at_ms = ?9
         WHERE relative_path = ?10 AND modified_ms = ?11 AND size = ?12
        ",
        params![
            row.file_name,
            row.extension,
            row.folder,
            row.modified_ms,
            row.size,
            row.parse_truncated,
            row.title,
            row.excerpt,
            now_ms(),
            row.relative_path,
            expected_mtime,
            expected_size
        ],
    )?;
    if affected == 1 {
        if let Some(id) = note_id_for_path(conn, &row.relative_path)? {
            replace_tags(conn, id, &row.tags)?;
            sync_fts(conn, id, &row.title, &row.excerpt, &row.relative_path, &row.tags)?;
        }
    }
    Ok(affected)
}

pub fn insert_ignore(conn: &Connection, row: &NoteRow) -> rusqlite::Result<usize> {
    let affected = conn.execute(
        "
        INSERT OR IGNORE INTO notes (
            relative_path, file_name, extension, folder, modified_ms, size,
            parse_truncated, title, excerpt, indexed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ",
        params![
            row.relative_path,
            row.file_name,
            row.extension,
            row.folder,
            row.modified_ms,
            row.size,
            row.parse_truncated,
            row.title,
            row.excerpt,
            now_ms()
        ],
    )?;
    if affected == 1 {
        if let Some(id) = note_id_for_path(conn, &row.relative_path)? {
            replace_tags(conn, id, &row.tags)?;
            sync_fts(conn, id, &row.title, &row.excerpt, &row.relative_path, &row.tags)?;
        }
    }
    Ok(affected)
}

pub fn delete_note(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    if let Some(id) = note_id_for_path(conn, path)? {
        let _ = conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![id]);
    }
    conn.execute("DELETE FROM notes WHERE relative_path = ?1", params![path])?;
    Ok(())
}

pub fn normalize_tag(tag: &str) -> String {
    tag.trim().to_ascii_lowercase()
}

pub fn replace_tags(conn: &Connection, note_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    let mut seen = HashSet::new();
    let mut next = Vec::new();
    for tag in tags {
        let norm = normalize_tag(tag);
        if norm.is_empty() || !seen.insert(norm.clone()) {
            continue;
        }
        next.push((tag.clone(), norm));
    }
    let mut statement = conn.prepare("SELECT tag_norm FROM note_tags WHERE note_id = ?1")?;
    let old: HashSet<String> = statement
        .query_map(params![note_id], |row| row.get(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    let new_norms: HashSet<String> = next.iter().map(|(_, norm)| norm.clone()).collect();
    if old == new_norms {
        return Ok(());
    }
    conn.execute("DELETE FROM note_tags WHERE note_id = ?1", params![note_id])?;
    if next.is_empty() {
        return Ok(());
    }
    let mut sql = String::from("INSERT INTO note_tags(note_id, tag, tag_norm) VALUES ");
    for (index, _) in next.iter().enumerate() {
        if index > 0 {
            sql.push(',');
        }
        sql.push_str("(?,?,?)");
    }
    let mut statement = conn.prepare(&sql)?;
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    for (tag, norm) in &next {
        params.push(note_id.into());
        params.push(tag.clone().into());
        params.push(norm.clone().into());
    }
    statement.execute(rusqlite::params_from_iter(params))?;
    Ok(())
}

pub fn sync_fts(
    conn: &Connection,
    note_id: i64,
    title: &str,
    excerpt: &str,
    path: &str,
    tags: &[String],
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes_fts WHERE rowid = ?1", params![note_id])?;
    conn.execute(
        "INSERT INTO notes_fts(rowid, title, excerpt, path, tags) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![note_id, title, excerpt, path, tags.join(" ")],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::index::connection::open_or_rebuild;
    use tempfile::tempdir;

    #[test]
    fn upsert_round_trips_tags_without_json_or_hash() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        let row = note_row(
            "one.md".into(),
            "one.md".into(),
            "md".into(),
            10,
            4,
            false,
            "One".into(),
            "body".into(),
            &["a".into(), "A".into()],
        );
        let id = upsert_note(&index.conn, &row).unwrap();
        assert!(id > 0);
        let count: i64 = index
            .conn
            .query_row("SELECT COUNT(*) FROM note_tags WHERE note_id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        let fts: String = index
            .conn
            .query_row(
                "SELECT tags FROM notes_fts WHERE rowid = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(fts.contains('a') || fts.contains('A'));
        let columns: Vec<String> = {
            let mut statement = index.conn.prepare("PRAGMA table_info(notes)").unwrap();
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(!columns.iter().any(|name| name == "content_hash" || name == "tags_json"));
    }

    #[test]
    fn replace_tags_skips_identical_norm_set() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        let row = note_row(
            "one.md".into(),
            "one.md".into(),
            "md".into(),
            10,
            4,
            false,
            "One".into(),
            "body".into(),
            &["Work".into()],
        );
        let id = upsert_note(&index.conn, &row).unwrap();
        replace_tags(&index.conn, id, &["Work".into()]).unwrap();
        let tag: String = index
            .conn
            .query_row(
                "SELECT tag FROM note_tags WHERE note_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tag, "Work");
    }
}
