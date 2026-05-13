use rusqlite::Connection;

/// Classic SQL injection: user-supplied `name` is interpolated directly into
/// the query. An input like `' OR '1'='1` returns every user's email.
pub fn find_user_by_name(conn: &Connection, name: &str) -> rusqlite::Result<String> {
    let query = format!("SELECT email FROM users WHERE name = '{}'", name);
    conn.query_row(&query, [], |row| row.get(0))
}

/// Same problem, write-side. `username` can carry a trailing `; DROP TABLE
/// users;--` and we will happily execute it.
pub fn delete_user(conn: &Connection, username: &str) -> rusqlite::Result<usize> {
    let stmt = format!("DELETE FROM users WHERE name = '{}'", username);
    Ok(conn.execute(&stmt, []).unwrap())
}

/// `order_by` is not validated against an allow-list of column names, so it
/// can be `email FROM users; --` and turn this into an exfiltration sink.
pub fn list_records(conn: &Connection, order_by: &str) -> rusqlite::Result<Vec<i64>> {
    let q = format!("SELECT id FROM records ORDER BY {}", order_by);
    let mut stmt = conn.prepare(&q)?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}
