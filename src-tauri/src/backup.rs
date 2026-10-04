//! Encrypted backups (`.dyeai`) and security status.
//!
//! Backups are SQLCipher-encrypted snapshots (`VACUUM INTO`), so the resulting
//! file is ciphertext-only even though it sits on a USB drive or — later —
//! gets uploaded to the cloud bucket. The restore path opens the candidate
//! with the unit key and runs `quick_check` before it will overwrite anything.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::db;

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

fn sha256_hex(path: &Path) -> String {
    let mut hasher = Sha256::new();
    if let Ok(mut f) = std::fs::File::open(path) {
        use std::io::Read;
        let mut buf = [0u8; 65536];
        while let Ok(n) = f.read(&mut buf) {
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
    }
    hex::encode(hasher.finalize())
}

fn validate_candidate(app_data_dir: &Path, backup: &Path) -> Result<Connection, String> {
    let (key, _source) = crate::secrets::load_or_create_key(app_data_dir)?;
    let conn = Connection::open(backup).map_err(|e| format!("cannot open backup file: {e}"))?;
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(&key)))
        .map_err(|e| format!("backup rejected by SQLCipher: {e}"))?;
    let _ = conn.execute_batch("PRAGMA cipher_migrate;");
    let quick: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("integrity check failed: {e}"))?;
    if quick != "ok" {
        return Err(format!("integrity check reported: {quick}"));
    }
    for table in ["challans", "customers", "masters_settings" /* allowed missing */] {
        if table == "masters_settings" {
            continue;
        }
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![table],
                |r| r.get(0),
            )
            .map_err(|e| format!("could not inspect backup schema: {e}"))?;
        if n == 0 {
            return Err(format!("not a DyeAI database (missing {table} table)"));
        }
    }
    Ok(conn)
}

/// Snapshot the live encrypted DB into `backups/dyeai-<ts>.dyeai`.
pub fn create_backup(app_data_dir: &Path, db_path: &Path) -> Result<Value, String> {
    let dir = backups_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let out = dir.join(format!("dyeai-{ts}.dyeai"));

    let conn = db::open_encrypted(app_data_dir, db_path)?;
    let escaped = out.to_string_lossy().replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{escaped}'"), [])
        .map_err(|e| format!("backup snapshot failed: {e}"))?;

    let size = std::fs::metadata(&out).map_err(|e| e.to_string())?.len();
    let backup = db::open_encrypted(app_data_dir, &out)?;
    let _ = backup;
    Ok(json!({
        "ok": true,
        "path": out.to_string_lossy(),
        "size": size,
        "sha256": sha256_hex(&out),
        "createdAt": ts,
        "encrypted": db::is_sqlcipher(&out),
    }))
}

/// Replace the live DB with a validated encrypted backup. The caller must
/// restart the app afterwards (the running connection keeps its old file
/// inode, so nothing is left half-done).
pub fn restore_from_backup(
    app_data_dir: &Path,
    db_path: &Path,
    backup_path: &str,
) -> Result<Value, String> {
    let candidate = PathBuf::from(backup_path);
    if !candidate.exists() {
        return Err("backup file not found".into());
    }
    validate_candidate(app_data_dir, &candidate)?;

    let tmp = db_path.with_extension("db.restore");
    std::fs::copy(&candidate, &tmp).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, db_path).map_err(|e| e.to_string())?;
    // Drop stale WAL sidecars so the restored file is opened clean on restart.
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", db_path.to_string_lossy(), suffix));
        let _ = std::fs::remove_file(&sidecar);
    }
    Ok(json!({
        "ok": true,
        "requiresRestart": true,
        "restoredFrom": candidate.to_string_lossy(),
    }))
}

pub fn list_backups_files(app_data_dir: &Path) -> Result<Value, String> {
    let dir = backups_dir(app_data_dir);
    let mut items: Vec<Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("dyeai") {
                continue;
            }
            let meta = entry.metadata().ok();
            items.push(json!({
                "path": p.to_string_lossy(),
                "name": p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                "size": meta.as_ref().map(|m| m.len()).unwrap_or(0),
                "modifiedAt": meta.as_ref().and_then(|m| m.modified().ok())
                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)).unwrap_or(0),
            }));
        }
    }
    items.sort_by(|a, b| b["modifiedAt"].as_i64().unwrap_or(0).cmp(&a["modifiedAt"].as_i64().unwrap_or(0)));
    Ok(json!(items))
}

pub fn security_status(app_data_dir: &Path, db_path: &Path) -> Result<Value, String> {
    let (_key, source) = crate::secrets::load_or_create_key(app_data_dir)?;
    let encrypted = db::is_sqlcipher(db_path);
    let last = list_backups_files(app_data_dir)?
        .as_array()
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or(Value::Null);
    Ok(json!({
        "encrypted": encrypted,
        "keySource": source,
        "dbPath": db_path.to_string_lossy(),
        "backupsDir": backups_dir(app_data_dir).to_string_lossy(),
        "lastBackup": last,
    }))
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok((dir.clone(), dir.join("dyeai.db")))
}

/// Create an encrypted `.dyeai` snapshot now.
#[tauri::command]
pub fn backup_now(app: tauri::AppHandle) -> Result<Value, String> {
    let (dir, db_path) = paths(&app)?;
    create_backup(&dir, &db_path)
}

/// Replace the live DB with an encrypted backup (restart required).
#[tauri::command]
pub fn restore_backup(app: tauri::AppHandle, backup_path: String) -> Result<Value, String> {
    let (dir, db_path) = paths(&app)?;
    restore_from_backup(&dir, &db_path, &backup_path)
}

/// List `.dyeai` backups, newest first.
#[tauri::command]
pub fn list_backups(app: tauri::AppHandle) -> Result<Value, String> {
    let (dir, _db_path) = paths(&app)?;
    list_backups_files(&dir)
}

/// Encryption / key-source / last-backup status for the UI.
#[tauri::command]
pub fn security_status_cmd(app: tauri::AppHandle) -> Result<Value, String> {
    let (dir, db_path) = paths(&app)?;
    crate::backup::security_status(&dir, &db_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Hermetic: keep the key store off the OS keyring for tests.
    fn file_key_store_only() {
        std::env::set_var("DYEAI_KEY_STORE", "file");
    }

    fn write_plaintext_fixture(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE challans(id TEXT PRIMARY KEY, name TEXT);
             CREATE TABLE customers(id TEXT PRIMARY KEY, name TEXT);
             INSERT INTO challans VALUES ('c1','hello secret challan');",
        )
        .unwrap();
    }

    #[test]
    fn plaintext_fixture_is_detected_as_such() {
        file_key_store_only();
        let dir = tempdir().unwrap();
        let db = dir.path().join("plain.db");
        write_plaintext_fixture(&db);
        assert!(!db::is_sqlcipher(&db));
    }

    #[test]
    fn open_encrypted_migrates_plaintext_and_hides_content() {
        file_key_store_only();
        let dir = tempdir().unwrap();
        let app = dir.path();
        let db = app.join("dyeai.db");
        write_plaintext_fixture(&db);

        let conn = db::open_encrypted(app, &db).unwrap();
        conn.execute_batch("DELETE FROM challans; INSERT INTO challans VALUES ('c2','now encrypted')")
            .unwrap();

        // The raw file must no longer be plaintext SQLite.
        assert!(db::is_sqlcipher(&db), "file must be SQLCipher after migration");
        let header = std::fs::read(&db).unwrap();
        assert!(!header.starts_with(b"SQLite format 3\0"), "header must not be plaintext");

        // Reopening with the key yields our data.
        let conn2 = db::open_encrypted(app, &db).unwrap();
        let name: String = conn2
            .query_row("SELECT name FROM challans WHERE id='c2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "now encrypted");
    }

    #[test]
    fn create_backup_produces_ciphertext_roundtrip() {
        file_key_store_only();
        let dir = tempdir().unwrap();
        let app = dir.path();
        let db = app.join("dyeai.db");
        let conn = db::open_encrypted(app, &db).unwrap();
        conn.execute_batch("CREATE TABLE challans(id TEXT); CREATE TABLE customers(id TEXT); INSERT INTO challans VALUES ('x1');")
            .unwrap();

        let meta = create_backup(app, &db).unwrap();
        assert_eq!(meta["encrypted"], true);
        let out = PathBuf::from(meta["path"].as_str().unwrap());
        assert!(db::is_sqlcipher(&out), "backup file must be SQLCipher");

        let items = list_backups_files(app).unwrap();
        assert_eq!(items.as_array().unwrap().len(), 1);

        // Mutate live db, then restore from backup and confirm rollback.
        conn.execute_batch("DELETE FROM challans;").unwrap();
        let restore = restore_from_backup(app, &db, meta["path"].as_str().unwrap()).unwrap();
        assert_eq!(restore["requiresRestart"], true);
        let reopened = db::open_encrypted(app, &db).unwrap();
        let n: i64 = reopened.query_row("SELECT COUNT(*) FROM challans", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "restored db must have the backed-up row back");
    }

    #[test]
    fn restore_rejects_foreign_file() {
        file_key_store_only();
        let dir = tempdir().unwrap();
        let app = dir.path();
        let db = app.join("dyeai.db");
        let conn = db::open_encrypted(app, &db).unwrap();
        conn.execute_batch("CREATE TABLE challans(id TEXT); CREATE TABLE customers(id TEXT);")
            .unwrap();

        let fake = app.join("not-a-backup.dyeai");
        std::fs::write(&fake, b"this is definitely not an sqlcipher database").unwrap();
        let result = restore_from_backup(app, &db, fake.to_str().unwrap());
        assert!(result.is_err(), "foreign/invalid backups must be rejected");
    }
}