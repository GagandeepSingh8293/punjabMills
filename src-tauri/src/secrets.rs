//! DB encryption key management.
//!
//! The single on-premises database is SQLCipher-encrypted at rest. The 32-byte
//! key is kept in the OS keyring (Windows Credential Manager, macOS Keychain,
//! Linux Secret Service). On headless Linux with no keyring available we fall
//! back to a 0600-permission file next to the database.

use std::path::Path;

use rand::RngCore;

const KEY_TEXT: &str = "dyeai db key v1";

fn keyring_entry() -> keyring::Entry {
    keyring::Entry::new("dyeai", KEY_TEXT).expect("invalid keyring entry")
}

fn file_key_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("dyeai.key")
}

/// Load the DB key, generating and storing one the first time it's needed.
///
/// Set `DYEAI_KEY_STORE=file` to force the file store (headless setups and
/// hermetic tests, so nothing touches the OS keyring).
pub fn load_or_create_key(app_data_dir: &Path) -> Result<(Vec<u8>, &'static str), String> {
    if std::env::var("DYEAI_KEY_STORE").as_deref() == Ok("file") {
        return load_or_create_file_key(app_data_dir);
    }
    // Try the OS keyring first.
    let entry = keyring_entry();
    match entry.get_password() {
        Ok(pw) => {
            if let Ok(bytes) = hex::decode(&pw) {
                if bytes.len() == 32 {
                    return Ok((bytes, "keyring"));
                }
            }
            // Corrupt entry — regenerate below (overwrite).
            let bytes = new_key();
            let _ = entry.set_password(&hex::encode(&bytes));
            return Ok((bytes, "keyring"));
        }
        Err(e) => {
            match e {
                keyring::Error::NoEntry | keyring::Error::Ambiguous(_) => {
                    // First use — generate and store.
                    let bytes = new_key();
                    entry
                        .set_password(&hex::encode(&bytes))
                        .map_err(|e| format!("could not store key in keyring: {e}"))?;
                    return Ok((bytes, "keyring"));
                }
                _ => {
                    // Keyring unavailable (e.g. no Secret Service) — file fallback.
                    return load_or_create_file_key(app_data_dir);
                }
            }
        }
    }
}

/// Fallback store: a 0600 file. Kept absolute-minimal-ACL on POSIX.
fn load_or_create_file_key(app_data_dir: &Path) -> Result<(Vec<u8>, &'static str), String> {
    let path = file_key_path(app_data_dir);
    let bytes = match std::fs::read(&path) {
        Ok(buf) => {
            if buf.len() != 32 {
                return Err("dyeai.key has an unexpected size; refusing to auto-fix".into());
            }
            buf
        }
        Err(_) => {
            let bytes = new_key();
            write_file_key(&path, &bytes)?;
            bytes
        }
    };
    Ok((bytes, "file"))
}

fn write_file_key(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("no parent dir for key file")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".dyeai.key.tmp{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    set_restrictive_perms(&tmp);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn set_restrictive_perms(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        let _ = path; // Windows keyring is the primary store; ACL handled by OS.
    }
}

fn new_key() -> Vec<u8> {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_32_bytes_and_roundtrips() {
        // Directly exercise the file fallback path.
        let dir = std::env::temp_dir().join(format!("dyeai-secrets-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (k1, src1) = load_or_create_file_key(&dir).unwrap();
        assert_eq!(k1.len(), 32);
        assert_eq!(src1, "file");
        let (k2, src2) = load_or_create_file_key(&dir).unwrap();
        assert_eq!(k1, k2, "key must be stable across loads");
        assert_eq!(src2, "file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("dyeai.key")).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "key file must be 0600");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}