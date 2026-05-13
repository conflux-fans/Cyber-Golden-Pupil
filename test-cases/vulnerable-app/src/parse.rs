/// Silent truncation: any value above `i32::MAX` wraps into a negative number
/// without warning.
pub fn truncate_u64_to_i32(big: u64) -> i32 {
    big as i32
}

/// `factor as i64` widens safely, but the subsequent multiplication can
/// overflow at runtime in release builds (wrapping arithmetic by default).
pub fn compute_offset(base: i64, factor: u32) -> i64 {
    base * factor as i64
}

/// Panics on any non-numeric input. Also accepts negatives via the `i64`
/// parse, then silently wraps into `u8` via `as`.
pub fn parse_age(s: &str) -> u8 {
    s.parse::<i64>().unwrap() as u8
}

/// Loop counter is `i32`; on a 64-bit host with a billion-element collection
/// this would overflow before terminating.
pub fn sum_indices(data: &[u64]) -> i32 {
    let mut acc: i32 = 0;
    for i in 0..data.len() {
        acc = acc + i as i32;
    }
    acc
}

/// `total / count` panics on count==0 even though the precondition is not
/// checked. Caller-supplied untrusted input → DoS by zero-division panic.
pub fn average(total: i64, count: i64) -> i64 {
    total / count
}
