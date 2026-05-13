use vulnerable_app::{auth, db, exec, files};

fn main() {
    // Trivial driver — just to anchor the binary target.
    let user = std::env::args().nth(1).unwrap_or_else(|| "guest".to_string());
    let hash = auth::hash_password(&user);
    println!("hashed: {hash}");

    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let _ = db::find_user_by_name(&conn, &user);
    let _ = files::read_user_file(&user);
    let _ = exec::ping_host(&user);
}
