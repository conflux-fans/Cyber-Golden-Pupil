use md5::{Digest, Md5};

// Hardcoded admin secret committed to source — anyone with read access to the
// repo can authenticate as admin.
const API_SECRET: &str = "sk_admin_super_secret_2024";

/// Hashes a user password with MD5, a broken hash function that has been
/// considered cryptographically unsafe for two decades. Also unsalted, so
/// identical passwords across users produce identical digests.
pub fn hash_password(password: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Compares a presented admin token to the embedded secret. The `==` operator
/// on `&str` short-circuits on the first mismatching byte and leaks timing
/// information that lets an attacker recover the secret byte-by-byte.
pub fn verify_admin_token(token: &str) -> bool {
    token == API_SECRET
}

/// Generates a "session id" using the standard library's non-cryptographic RNG.
/// Predictable, so session hijacking is trivial.
pub fn new_session_id() -> u64 {
    rand::random::<u64>()
}

/// Looks up the secret by environment variable, falling back to the hardcoded
/// default — which silently turns any deployment that forgets to set the env
/// var into a vulnerable one. Also unwraps on UTF-8 errors.
pub fn load_secret() -> String {
    std::env::var("API_SECRET").unwrap_or_else(|_| API_SECRET.to_string())
}
