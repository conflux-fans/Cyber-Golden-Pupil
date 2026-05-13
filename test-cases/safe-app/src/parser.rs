//! String → number parsing with explicit error types. No panics, no silent
//! truncation: range checks are done in a wider type before narrowing via
//! `TryFrom` so any overflow surfaces as `ParseError::OutOfRange`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    Empty,
    InvalidNumber(String),
    OutOfRange,
}

/// Parses a non-negative integer in `i32` range. Negative values and overflow
/// both return `ParseError::OutOfRange`.
pub fn parse_positive_int(s: &str) -> Result<i32, ParseError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err(ParseError::Empty);
    }
    let n: i64 = trimmed
        .parse()
        .map_err(|_| ParseError::InvalidNumber(trimmed.to_string()))?;
    if n < 0 || n > i64::from(i32::MAX) {
        return Err(ParseError::OutOfRange);
    }
    i32::try_from(n).map_err(|_| ParseError::OutOfRange)
}

/// Splits a `"key=value"` pair. Whitespace is trimmed around both sides.
pub fn parse_kv(line: &str) -> Result<(&str, &str), ParseError> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err(ParseError::Empty);
    }
    let (k, v) = trimmed
        .split_once('=')
        .ok_or_else(|| ParseError::InvalidNumber(trimmed.to_string()))?;
    let k = k.trim();
    let v = v.trim();
    if k.is_empty() || v.is_empty() {
        return Err(ParseError::InvalidNumber(trimmed.to_string()));
    }
    Ok((k, v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_positive() {
        assert_eq!(parse_positive_int("  42 "), Ok(42));
    }

    #[test]
    fn rejects_negative() {
        assert_eq!(parse_positive_int("-1"), Err(ParseError::OutOfRange));
    }

    #[test]
    fn rejects_overflow() {
        let too_big = i64::from(i32::MAX) + 1;
        assert_eq!(
            parse_positive_int(&too_big.to_string()),
            Err(ParseError::OutOfRange),
        );
    }

    #[test]
    fn rejects_non_numeric() {
        assert!(matches!(
            parse_positive_int("abc"),
            Err(ParseError::InvalidNumber(_)),
        ));
    }

    #[test]
    fn parses_kv() {
        assert_eq!(parse_kv("name = alice"), Ok(("name", "alice")));
    }
}
