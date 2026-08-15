use crate::domain::{
    note_parse::{INDEX_READ_CAP, PARSE_ALGO_VERSION},
    path::ensure_inside,
    NoteFile,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const INDEX_DIR: &str = ".memoir";
pub const INDEX_FILE: &str = "index.sqlite";
pub const CURRENT_USER_VERSION: i32 = 1;

const ALLOWED_TABLES: &[&str] = &["meta", "notes", "note_tags"];
const ALLOWED_INDEXES: &[&str] = &["note_tags_norm"];

#[derive(Debug)]
pub struct WorkspaceIndex {
    pub conn: Connection,
    pub persistent: bool,
}

#[derive(Debug, Clone)]
pub struct NoteRow {
    pub relative_path: String,
    pub file_name: String,
    pub extension: String,
    pub modified_ms: i64,
    pub size: i64,
    pub content_hash: String,
    pub parse_truncated: i64,
    pub title: String,
    pub excerpt: String,
    pub tags_json: String,
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
            tags: serde_json::from_str(&self.tags_json).unwrap_or_default(),
            excerpt: self.excerpt.clone(),
        }
    }
}

pub fn index_dir(root: &Path) -> PathBuf {
    root.join(INDEX_DIR)
}

pub fn open_or_rebuild(root: &Path) -> WorkspaceIndex {
    match try_open_persistent(root) {
        Some(index) => index,
        None => open_in_memory(),
    }
}

fn try_open_persistent(root: &Path) -> Option<WorkspaceIndex> {
    let dir = index_dir(root);
    if dir.exists() {
        let metadata = fs::symlink_metadata(&dir).ok()?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return None;
        }
    } else if fs::create_dir_all(&dir).is_err() {
        return None;
    }

    let canonical = dir.canonicalize().ok()?;
    ensure_inside(root, &canonical).ok()?;

    let gitignore = dir.join(".gitignore");
    if !gitignore.exists() {
        let _ = fs::write(&gitignore, "*\n");
    }

    let db_path = dir.join(INDEX_FILE);
    if db_path.exists() {
        let metadata = fs::symlink_metadata(&db_path).ok()?;
        if metadata.file_type().is_symlink() {
            return None;
        }
    }

    match Connection::open(&db_path) {
        Ok(conn) => match prepare_connection(conn, true) {
            Ok(index) => Some(index),
            Err(_) => rebuild_persistent(&db_path),
        },
        Err(_) => rebuild_persistent(&db_path),
    }
}

fn rebuild_persistent(db_path: &Path) -> Option<WorkspaceIndex> {
    if !try_delete_triple(db_path) {
        return None;
    }
    let conn = Connection::open(db_path).ok()?;
    prepare_connection(conn, true).ok()
}

fn open_in_memory() -> WorkspaceIndex {
    let conn = Connection::open_in_memory().expect("in-memory sqlite");
    prepare_connection(conn, false).unwrap_or_else(|_| WorkspaceIndex {
        conn: Connection::open_in_memory().expect("in-memory sqlite"),
        persistent: false,
    })
}

fn prepare_connection(conn: Connection, persistent: bool) -> Result<WorkspaceIndex, ()> {
    apply_pragmas(&conn);
    let version = user_version(&conn).map_err(|_| ())?;
    if version > CURRENT_USER_VERSION {
        return Err(());
    }
    if version == 0 {
        apply_schema_v1(&conn).map_err(|_| ())?;
    }
    if !schema_is_safe(&conn) {
        return Err(());
    }
    Ok(WorkspaceIndex { conn, persistent })
}

fn apply_pragmas(conn: &Connection) {
    let _ = conn.execute_batch(
        "
        PRAGMA trusted_schema = OFF;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA temp_store = MEMORY;
        PRAGMA synchronous = NORMAL;
        ",
    );
    let _ = conn.execute_batch("PRAGMA journal_mode = WAL;");
}

fn user_version(conn: &Connection) -> rusqlite::Result<i32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

fn apply_schema_v1(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
            relative_path     TEXT PRIMARY KEY,
            file_name         TEXT NOT NULL,
            extension         TEXT NOT NULL,
            modified_ms       INTEGER NOT NULL,
            size              INTEGER NOT NULL,
            content_hash      TEXT NOT NULL,
            parse_truncated   INTEGER NOT NULL DEFAULT 0,
            title             TEXT NOT NULL,
            excerpt           TEXT NOT NULL,
            tags_json         TEXT NOT NULL,
            indexed_at_ms     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS note_tags (
            relative_path TEXT NOT NULL REFERENCES notes(relative_path) ON DELETE CASCADE,
            tag           TEXT NOT NULL,
            tag_norm      TEXT NOT NULL,
            PRIMARY KEY (relative_path, tag)
        );
        CREATE INDEX IF NOT EXISTS note_tags_norm ON note_tags(tag_norm);
        ",
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_name', 'memoir-index')",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('parse_algo_version', ?1)",
        params![PARSE_ALGO_VERSION.to_string()],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('index_read_cap', ?1)",
        params![INDEX_READ_CAP.to_string()],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('created_ms', ?1)",
        params![now_ms().to_string()],
    )?;
    conn.pragma_update(None, "user_version", CURRENT_USER_VERSION)?;
    Ok(())
}

fn schema_is_safe(conn: &Connection) -> bool {
    let mut statement = match conn.prepare(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
    ) {
        Ok(statement) => statement,
        Err(_) => return false,
    };
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });
    let Ok(rows) = rows else {
        return false;
    };
    for row in rows {
        let Ok((kind, name)) = row else {
            return false;
        };
        let allowed = match kind.as_str() {
            "table" => ALLOWED_TABLES.contains(&name.as_str()),
            "index" => ALLOWED_INDEXES.contains(&name.as_str()),
            _ => false,
        };
        if !allowed {
            return false;
        }
    }
    for table in ALLOWED_TABLES {
        let exists: Result<i64, _> = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        );
        if !matches!(exists, Ok(1)) {
            return false;
        }
    }
    true
}

pub fn try_delete_triple(db_path: &Path) -> bool {
    let mut ok = true;
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{suffix}", db_path.display()));
        if path.exists() && fs::remove_file(&path).is_err() {
            ok = false;
        }
    }
    ok
}

pub fn checkpoint(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

pub fn select_all_notes(conn: &Connection) -> rusqlite::Result<Vec<NoteRow>> {
    let mut statement = conn.prepare(
        "
        SELECT relative_path, file_name, extension, modified_ms, size, content_hash,
               parse_truncated, title, excerpt, tags_json
          FROM notes
         ORDER BY modified_ms DESC, relative_path ASC
        ",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(NoteRow {
            relative_path: row.get(0)?,
            file_name: row.get(1)?,
            extension: row.get(2)?,
            modified_ms: row.get(3)?,
            size: row.get(4)?,
            content_hash: row.get(5)?,
            parse_truncated: row.get(6)?,
            title: row.get(7)?,
            excerpt: row.get(8)?,
            tags_json: row.get(9)?,
        })
    })?;
    rows.collect()
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
        .unwrap_or(PARSE_ALGO_VERSION))
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn cas_delete(conn: &Connection, path: &str, modified_ms: i64, size: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM notes WHERE relative_path = ?1 AND modified_ms = ?2 AND size = ?3",
        params![path, modified_ms, size],
    )
}

pub fn cas_update(
    conn: &Connection,
    row: &NoteRow,
    expected_mtime: i64,
    expected_size: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "
        UPDATE notes SET
            file_name = ?1,
            extension = ?2,
            modified_ms = ?3,
            size = ?4,
            content_hash = ?5,
            parse_truncated = ?6,
            title = ?7,
            excerpt = ?8,
            tags_json = ?9,
            indexed_at_ms = ?10
         WHERE relative_path = ?11 AND modified_ms = ?12 AND size = ?13
        ",
        params![
            row.file_name,
            row.extension,
            row.modified_ms,
            row.size,
            row.content_hash,
            row.parse_truncated,
            row.title,
            row.excerpt,
            row.tags_json,
            now_ms(),
            row.relative_path,
            expected_mtime,
            expected_size
        ],
    )
}

pub fn insert_ignore(conn: &Connection, row: &NoteRow) -> rusqlite::Result<usize> {
    conn.execute(
        "
        INSERT OR IGNORE INTO notes (
            relative_path, file_name, extension, modified_ms, size, content_hash,
            parse_truncated, title, excerpt, tags_json, indexed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ",
        params![
            row.relative_path,
            row.file_name,
            row.extension,
            row.modified_ms,
            row.size,
            row.content_hash,
            row.parse_truncated,
            row.title,
            row.excerpt,
            row.tags_json,
            now_ms()
        ],
    )
}

pub fn upsert_note(conn: &Connection, row: &NoteRow) -> rusqlite::Result<()> {
    conn.execute(
        "
        INSERT INTO notes (
            relative_path, file_name, extension, modified_ms, size, content_hash,
            parse_truncated, title, excerpt, tags_json, indexed_at_ms
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(relative_path) DO UPDATE SET
            file_name = excluded.file_name,
            extension = excluded.extension,
            modified_ms = excluded.modified_ms,
            size = excluded.size,
            content_hash = excluded.content_hash,
            parse_truncated = excluded.parse_truncated,
            title = excluded.title,
            excerpt = excluded.excerpt,
            tags_json = excluded.tags_json,
            indexed_at_ms = excluded.indexed_at_ms
        ",
        params![
            row.relative_path,
            row.file_name,
            row.extension,
            row.modified_ms,
            row.size,
            row.content_hash,
            row.parse_truncated,
            row.title,
            row.excerpt,
            row.tags_json,
            now_ms()
        ],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE relative_path = ?1", params![path])?;
    Ok(())
}

pub fn replace_tags(conn: &Connection, path: &str, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM note_tags WHERE relative_path = ?1",
        params![path],
    )?;
    for tag in tags {
        conn.execute(
            "INSERT OR IGNORE INTO note_tags(relative_path, tag, tag_norm) VALUES (?1, ?2, ?3)",
            params![path, tag, tag.trim().to_ascii_lowercase()],
        )?;
    }
    Ok(())
}

pub fn note_row(
    relative_path: String,
    file_name: String,
    extension: String,
    modified_ms: u128,
    size: u64,
    content_hash: String,
    parse_truncated: bool,
    title: String,
    excerpt: String,
    tags: &[String],
) -> NoteRow {
    NoteRow {
        relative_path,
        file_name,
        extension,
        modified_ms: i64::try_from(modified_ms).unwrap_or(i64::MAX),
        size: i64::try_from(size).unwrap_or(i64::MAX),
        content_hash,
        parse_truncated: i64::from(parse_truncated),
        title,
        excerpt,
        tags_json: serde_json::to_string(tags).unwrap_or_else(|_| "[]".into()),
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_schema_and_round_trips_a_note() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        assert!(index.persistent);
        assert!(root.path().join(".memoir/index.sqlite").exists());
        assert_eq!(
            fs::read_to_string(root.path().join(".memoir/.gitignore")).unwrap(),
            "*\n"
        );
        let row = note_row(
            "one.md".into(),
            "one.md".into(),
            "md".into(),
            10,
            4,
            "abcd".into(),
            false,
            "One".into(),
            "body".into(),
            &["a".into(), "a".into()],
        );
        upsert_note(&index.conn, &row).unwrap();
        replace_tags(&index.conn, "one.md", &["a".into(), "a".into()]).unwrap();
        let listed = select_all_notes(&index.conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "One");
        let tags: Vec<String> = serde_json::from_str(&listed[0].tags_json).unwrap();
        assert_eq!(tags, vec!["a", "a"]);
    }

    #[test]
    fn rebuilds_garbage_and_future_and_hostile_files() {
        let root = tempdir().unwrap();
        let db = root.path().join(".memoir/index.sqlite");
        fs::create_dir_all(db.parent().unwrap()).unwrap();
        fs::write(&db, b"not a database").unwrap();
        let notes = open_or_rebuild(root.path());
        assert!(notes.persistent);
        upsert_note(
            &notes.conn,
            &note_row(
                "a.md".into(),
                "a.md".into(),
                "md".into(),
                1,
                1,
                "h".into(),
                false,
                "A".into(),
                "".into(),
                &[],
            ),
        )
        .unwrap();
        drop(notes);

        let conn = Connection::open(&db).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        let rebuilt = open_or_rebuild(root.path());
        assert!(select_all_notes(&rebuilt.conn).unwrap().is_empty());
        drop(rebuilt);

        let conn = Connection::open(&db).unwrap();
        apply_schema_v1(&conn).unwrap();
        conn.execute_batch("CREATE TRIGGER evil AFTER INSERT ON notes BEGIN SELECT 1; END;")
            .unwrap();
        drop(conn);
        let cleaned = open_or_rebuild(root.path());
        assert!(cleaned.persistent);
        assert!(schema_is_safe(&cleaned.conn));
    }

    #[test]
    fn rebuilds_when_required_table_is_missing() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        index
            .conn
            .execute_batch("DROP TABLE notes;")
            .unwrap();
        drop(index);
        let rebuilt = open_or_rebuild(root.path());
        assert!(schema_is_safe(&rebuilt.conn));
    }

    #[test]
    fn unwritable_or_symlinked_memoir_uses_memory() {
        let root = tempdir().unwrap();
        fs::write(root.path().join(".memoir"), b"file").unwrap();
        let index = open_or_rebuild(root.path());
        assert!(!index.persistent);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let linked = tempdir().unwrap();
            let _ = fs::remove_file(linked.path().join(".memoir"));
            let _ = fs::remove_dir_all(linked.path().join(".memoir"));
            symlink("/tmp", linked.path().join(".memoir")).unwrap();
            let memory = open_or_rebuild(linked.path());
            assert!(!memory.persistent);
        }
    }
}
