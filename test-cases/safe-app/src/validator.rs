//! Username validation. Pure logic, no I/O, no allocations beyond the
//! returned error. Every failure mode is encoded in `ValidationError`.

const MAX_USERNAME_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    Empty,
    TooLong { max: usize },
    InvalidChar(char),
}

/// Validates that `username` is non-empty, within the length cap, and made of
/// ASCII alphanumerics plus underscore.
pub fn validate_username(username: &str) -> Result<(), ValidationError> {
    if username.is_empty() {
        return Err(ValidationError::Empty);
    }
    if username.len() > MAX_USERNAME_LEN {
        return Err(ValidationError::TooLong { max: MAX_USERNAME_LEN });
    }
    for ch in username.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '_' {
            return Err(ValidationError::InvalidChar(ch));
        }
    }
    Ok(())
}

/// Validates an email-ish string with a deliberately small grammar: exactly
/// one `@`, non-empty on either side, no whitespace.
pub fn validate_email(email: &str) -> Result<(), ValidationError> {
    if email.is_empty() {
        return Err(ValidationError::Empty);
    }
    if let Some(ws) = email.chars().find(|c| c.is_whitespace()) {
        return Err(ValidationError::InvalidChar(ws));
    }
    let mut parts = email.splitn(2, '@');
    let local = parts.next().unwrap_or("");
    let domain = parts.next().unwrap_or("");
    if local.is_empty() || domain.is_empty() || email.matches('@').count() != 1 {
        return Err(ValidationError::InvalidChar('@'));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_simple_name() {
        assert_eq!(validate_username("alice_99"), Ok(()));
    }

    #[test]
    fn rejects_empty() {
        assert_eq!(validate_username(""), Err(ValidationError::Empty));
    }

    #[test]
    fn rejects_long() {
        let s = "a".repeat(MAX_USERNAME_LEN + 1);
        assert_eq!(
            validate_username(&s),
            Err(ValidationError::TooLong { max: MAX_USERNAME_LEN }),
        );
    }

    #[test]
    fn rejects_bad_char() {
        assert_eq!(
            validate_username("alice!"),
            Err(ValidationError::InvalidChar('!')),
        );
    }
}
