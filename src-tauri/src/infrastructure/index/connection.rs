use super::schema::{apply_schema_v2, schema_is_safe, user_version, CURRENT_USER_VERSION};
use crate::domain::path::ensure_inside;
use rusqlite::Connection;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const INDEX_DIR: &str = ".memoir";
pub const INDEX_FILE: &str = "index.sqlite";
pub const INDEX_RELATIVE_PATH: &str = ".memoir/index.sqlite";

#[derive(Debug)]
pub struct WorkspaceIndex {
    pub conn: Connection,
    pub persistent: bool,
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
    if version == 0 {
        apply_schema_v2(&conn).map_err(|_| ())?;
    } else if version != CURRENT_USER_VERSION {
        return Err(());
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
        PRAGMA cache_size = -8000;
        PRAGMA mmap_size = 67108864;
        ",
    );
    let _ = conn.execute_batch("PRAGMA journal_mode = WAL;");
}

fn sidecar_path(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path
        .file_name()
        .map(|value| value.to_os_string())
        .unwrap_or_default();
    name.push(suffix);
    db_path.with_file_name(name)
}

pub fn try_delete_triple(db_path: &Path) -> bool {
    let mut ok = true;
    for suffix in ["", "-wal", "-shm"] {
        let path = if suffix.is_empty() {
            db_path.to_path_buf()
        } else {
            sidecar_path(db_path, suffix)
        };
        if path.exists() && fs::remove_file(&path).is_err() {
            ok = false;
        }
    }
    ok
}

pub fn checkpoint(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
}

pub fn optimize(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA optimize;");
}

pub fn sidecar_len(db_path: &Path, suffix: &str) -> u64 {
    let path = if suffix.is_empty() {
        db_path.to_path_buf()
    } else {
        sidecar_path(db_path, suffix)
    };
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use tempfile::tempdir;

    fn v1_ddl(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE notes (
                relative_path TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                modified_ms INTEGER NOT NULL,
                size INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                parse_truncated INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL,
                excerpt TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                indexed_at_ms INTEGER NOT NULL
            );
            CREATE TABLE note_tags (
                relative_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                tag_norm TEXT NOT NULL,
                PRIMARY KEY (relative_path, tag)
            );
            ",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
    }

    #[test]
    fn opens_v1_file_as_empty_v2() {
        let root = tempdir().unwrap();
        let dir = root.path().join(".memoir");
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join(INDEX_FILE);
        let conn = Connection::open(&db).unwrap();
        v1_ddl(&conn);
        conn.execute(
            "INSERT INTO notes VALUES ('old.md','old.md','md',1,1,'h',0,'Old','','[]',1)",
            [],
        )
        .unwrap();
        drop(conn);

        let index = open_or_rebuild(root.path());
        assert!(index.persistent);
        assert_eq!(user_version(&index.conn).unwrap(), CURRENT_USER_VERSION);
        let count: i64 = index
            .conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(schema_is_safe(&index.conn));
    }

    #[test]
    fn rebuilds_garbage_future_and_hostile_files() {
        let root = tempdir().unwrap();
        let db = root.path().join(".memoir/index.sqlite");
        fs::create_dir_all(db.parent().unwrap()).unwrap();
        fs::write(&db, b"not a database").unwrap();
        let notes = open_or_rebuild(root.path());
        assert!(notes.persistent);
        notes
            .conn
            .execute(
                "INSERT INTO notes(relative_path, file_name, extension, folder, modified_ms, size, parse_truncated, title, excerpt, indexed_at_ms)
                 VALUES ('a.md','a.md','md','',1,1,0,'A','',1)",
                [],
            )
            .unwrap();
        drop(notes);

        let conn = Connection::open(&db).unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        drop(conn);
        let rebuilt = open_or_rebuild(root.path());
        let count: i64 = rebuilt
            .conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        drop(rebuilt);

        let conn = Connection::open(&db).unwrap();
        apply_schema_v2(&conn).unwrap();
        conn.execute_batch("CREATE TRIGGER evil AFTER INSERT ON notes BEGIN SELECT 1; END;")
            .unwrap();
        drop(conn);
        let cleaned = open_or_rebuild(root.path());
        assert!(cleaned.persistent);
        assert!(schema_is_safe(&cleaned.conn));
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

    #[test]
    fn missing_required_table_rebuilds() {
        let root = tempdir().unwrap();
        let index = open_or_rebuild(root.path());
        index.conn.execute_batch("DROP TABLE notes;").unwrap();
        drop(index);
        let rebuilt = open_or_rebuild(root.path());
        assert!(schema_is_safe(&rebuilt.conn));
        let _exists: i64 = rebuilt
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'notes'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(_exists, 1);
        let _ = params![];
    }
}
