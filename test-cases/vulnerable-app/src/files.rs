use std::fs;
use std::path::PathBuf;

/// Path traversal: caller controls `filename` and can pass
/// `../../etc/passwd` to escape the intended `/var/data` directory.
/// Also panics on any I/O error.
pub fn read_user_file(filename: &str) -> String {
    let path = PathBuf::from("/var/data").join(filename);
    fs::read_to_string(&path).unwrap()
}

/// String-concatenated path with no traversal check — `filename = "../../foo"`
/// writes outside the upload root.
pub fn save_upload(filename: &str, contents: &[u8]) -> std::io::Result<()> {
    let path = format!("/uploads/{}", filename);
    std::fs::write(&path, contents)
}

/// TOCTOU pattern: we check `exists()` and then re-open with a fresh syscall,
/// so a symlink swap between the two steps lets the caller redirect the read.
pub fn read_if_exists(filename: &str) -> Option<String> {
    let path = PathBuf::from(filename);
    if !path.exists() {
        return None;
    }
    // Race window here.
    Some(std::fs::read_to_string(&path).expect("read failed"))
}
