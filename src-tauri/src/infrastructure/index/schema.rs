use crate::domain::note_parse::{INDEX_READ_CAP, PARSE_ALGO_VERSION};
use rusqlite::{params, Connection};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CURRENT_USER_VERSION: i32 = 4;

pub const ALLOWED_TABLES: &[&str] = &[
    "meta",
    "notes",
    "note_tags",
    "note_links",
    "dir_cache",
    "notes_fts",
    "notes_fts_data",
    "notes_fts_idx",
    "notes_fts_docsize",
    "notes_fts_config",
    "notes_fts_content",
    "ai_vector_meta",
    "ai_vector_state",
    "note_chunks",
];

pub const ALLOWED_INDEXES: &[&str] = &[
    "notes_modified",
    "notes_folder",
    "note_tags_norm",
    "note_links_source",
    "note_links_target",
    "note_chunks_note",
    "note_chunks_model",
];

pub fn user_version(conn: &Connection) -> rusqlite::Result<i32> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn apply_schema_v2(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
            id               INTEGER PRIMARY KEY,
            relative_path    TEXT    NOT NULL UNIQUE,
            file_name        TEXT    NOT NULL,
            extension        TEXT    NOT NULL,
            folder           TEXT    NOT NULL,
            modified_ms      INTEGER NOT NULL,
            size             INTEGER NOT NULL,
            parse_truncated  INTEGER NOT NULL DEFAULT 0,
            title            TEXT    NOT NULL,
            excerpt          TEXT    NOT NULL,
            indexed_at_ms    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notes_modified ON notes(modified_ms DESC, relative_path);
        CREATE INDEX IF NOT EXISTS notes_folder   ON notes(folder, modified_ms DESC);
        CREATE TABLE IF NOT EXISTS note_tags (
            note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            tag       TEXT    NOT NULL,
            tag_norm  TEXT    NOT NULL,
            PRIMARY KEY (note_id, tag_norm)
        );
        CREATE INDEX IF NOT EXISTS note_tags_norm ON note_tags(tag_norm);
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            excerpt,
            path,
            tags,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE TABLE IF NOT EXISTS dir_cache (
            relative_dir  TEXT PRIMARY KEY,
            modified_ms   INTEGER NOT NULL,
            size          INTEGER NOT NULL,
            entry_count   INTEGER NOT NULL
        );
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
    conn.pragma_update(None, "user_version", 2)?;
    Ok(())
}

pub fn apply_note_links_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS note_links (
            id           INTEGER PRIMARY KEY,
            source_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target_ref   TEXT    NOT NULL,
            target_path  TEXT,
            display_text TEXT    NOT NULL,
            heading      TEXT    NOT NULL DEFAULT '',
            kind         TEXT    NOT NULL,
            UNIQUE(source_id, target_ref, heading, kind)
        );
        CREATE INDEX IF NOT EXISTS note_links_source ON note_links(source_id);
        CREATE INDEX IF NOT EXISTS note_links_target ON note_links(target_path);
        ",
    )?;
    Ok(())
}

pub fn apply_vector_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_vector_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_vector_state (
            note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            model         TEXT    NOT NULL,
            modified_ms   INTEGER NOT NULL,
            size          INTEGER NOT NULL,
            status        TEXT    NOT NULL,
            error         TEXT,
            chunk_count   INTEGER NOT NULL DEFAULT 0,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (note_id, model)
        );
        CREATE TABLE IF NOT EXISTS note_chunks (
            id                INTEGER PRIMARY KEY,
            note_id           INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            model             TEXT    NOT NULL,
            chunk_index       INTEGER NOT NULL,
            start_offset      INTEGER NOT NULL,
            end_offset        INTEGER NOT NULL,
            source_modified_ms INTEGER NOT NULL,
            content_hash      TEXT    NOT NULL,
            content           TEXT    NOT NULL,
            dimensions        INTEGER NOT NULL,
            embedding         BLOB    NOT NULL,
            created_at_ms     INTEGER NOT NULL,
            UNIQUE(note_id, model, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS note_chunks_note ON note_chunks(note_id);
        CREATE INDEX IF NOT EXISTS note_chunks_model ON note_chunks(model);
        ",
    )?;
    Ok(())
}

pub fn apply_schema(conn: &Connection) -> rusqlite::Result<()> {
    apply_schema_v2(conn)?;
    apply_note_links_schema(conn)?;
    apply_vector_schema(conn)?;
    conn.pragma_update(None, "user_version", CURRENT_USER_VERSION)?;
    Ok(())
}

pub fn upgrade_schema(conn: &Connection, version: i32) -> Result<(), ()> {
    if version == 0 {
        apply_schema(conn).map_err(|_| ())
    } else if version == 2 {
        apply_note_links_schema(conn).map_err(|_| ())?;
        apply_vector_schema(conn).map_err(|_| ())?;
        conn.pragma_update(None, "user_version", CURRENT_USER_VERSION)
            .map_err(|_| ())?;
        Ok(())
    } else if version == 3 {
        apply_vector_schema(conn).map_err(|_| ())?;
        conn.pragma_update(None, "user_version", CURRENT_USER_VERSION)
            .map_err(|_| ())?;
        Ok(())
    } else if version == CURRENT_USER_VERSION {
        Ok(())
    } else {
        Err(())
    }
}

/// Rejects any sqlite_master object that is not on the index whitelist.
/// `sqlite_%` names (including `sqlite_autoindex_*`) are excluded from the scan.
pub fn schema_is_safe(conn: &Connection) -> bool {
    let mut statement =
        match conn.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'") {
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
    for table in [
        "meta",
        "notes",
        "note_tags",
        "note_links",
        "dir_cache",
        "notes_fts",
        "ai_vector_meta",
        "ai_vector_state",
        "note_chunks",
    ] {
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

#[cfg(test)]
pub fn master_objects(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_fts5_shadow_tables_are_on_the_whitelist() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        let objects = master_objects(&conn).unwrap();
        assert!(schema_is_safe(&conn), "unsafe schema: {objects:?}");
        assert!(!objects.is_empty());
        for (kind, name) in &objects {
            let allowed = match kind.as_str() {
                "table" => ALLOWED_TABLES.contains(&name.as_str()),
                "index" => ALLOWED_INDEXES.contains(&name.as_str()),
                _ => false,
            };
            assert!(
                allowed,
                "unexpected sqlite_master object {kind} {name}; update ALLOWED_*"
            );
        }
        for required in [
            "notes_fts",
            "notes_fts_data",
            "notes_fts_idx",
            "notes_fts_docsize",
            "notes_fts_config",
            "notes_fts_content",
        ] {
            assert!(
                objects
                    .iter()
                    .any(|(kind, name)| kind == "table" && name == required),
                "missing FTS object {required}: {objects:?}"
            );
        }
    }

    #[test]
    fn extra_table_or_trigger_is_hostile() {
        let conn = Connection::open_in_memory().unwrap();
        apply_schema_v2(&conn).unwrap();
        conn.execute_batch("CREATE TABLE evil (id INTEGER);")
            .unwrap();
        assert!(!schema_is_safe(&conn));

        let conn = Connection::open_in_memory().unwrap();
        apply_schema(&conn).unwrap();
        conn.execute_batch("CREATE TRIGGER evil AFTER INSERT ON notes BEGIN SELECT 1; END;")
            .unwrap();
        assert!(!schema_is_safe(&conn));
    }
}
