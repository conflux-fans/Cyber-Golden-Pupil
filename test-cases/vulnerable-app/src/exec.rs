use std::process::Command;

/// Command injection via `sh -c`: any shell metacharacter in `host`
/// (e.g. `; rm -rf /`) executes with this process's privileges.
pub fn ping_host(host: &str) -> String {
    let output = Command::new("sh")
        .arg("-c")
        .arg(format!("ping -c 1 {}", host))
        .output()
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

/// Even without `sh -c`, splitting the user's input on whitespace lets them
/// inject extra flags: `archive_name = "x.tar --use-compress-program=evil.sh"`.
pub fn make_tar(archive_name: &str, files: &[&str]) -> std::io::Result<()> {
    let mut cmd = Command::new("tar");
    for piece in archive_name.split_whitespace() {
        cmd.arg(piece);
    }
    cmd.args(files).status()?;
    Ok(())
}

/// Runs whatever the caller asks for. There is no allow-list. The function is
/// essentially `system(3)` with extra steps.
pub fn run_user_script(script: &str) -> std::io::Result<()> {
    Command::new("/bin/sh").arg("-c").arg(script).status()?;
    Ok(())
}
