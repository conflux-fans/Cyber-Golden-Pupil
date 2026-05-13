use serde::Deserialize;

#[derive(Deserialize)]
pub struct Config {
    pub admin: bool,
    pub api_key: String,
    pub allow_remote_exec: bool,
}

/// Trusts attacker-controlled JSON. No size cap, no schema enforcement beyond
/// the struct shape, no defaults — and a forged payload with `admin: true`
/// silently elevates the resulting object.
pub fn load_config_from_input(json: &str) -> Config {
    serde_json::from_str(json).unwrap()
}

/// `bincode::deserialize` on untrusted bytes is well-known to allow
/// constructing types in states that would be unreachable via the safe API,
/// including resource-exhaustion via huge length prefixes.
pub fn load_bincode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> T {
    bincode::deserialize(bytes).unwrap()
}

/// Reads a request body and parses without any length limit. A 1 GB body of
/// nested `[`s allocates proportionally and OOMs the process.
pub fn parse_request_body(body: &[u8]) -> serde_json::Value {
    serde_json::from_slice(body).expect("invalid json")
}
