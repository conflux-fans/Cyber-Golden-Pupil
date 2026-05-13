//! Arithmetic with overflow detection. Every operation that could trap or
//! wrap is expressed via `checked_*` so the failure mode shows up in the
//! return type, not in a runtime panic.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    DivideByZero,
}

pub fn safe_add(a: i32, b: i32) -> Result<i32, MathError> {
    a.checked_add(b).ok_or(MathError::Overflow)
}

pub fn safe_sub(a: i32, b: i32) -> Result<i32, MathError> {
    a.checked_sub(b).ok_or(MathError::Overflow)
}

pub fn safe_mul(a: i32, b: i32) -> Result<i32, MathError> {
    a.checked_mul(b).ok_or(MathError::Overflow)
}

pub fn safe_div(a: i32, b: i32) -> Result<i32, MathError> {
    if b == 0 {
        return Err(MathError::DivideByZero);
    }
    a.checked_div(b).ok_or(MathError::Overflow)
}

/// Sums a slice using `checked_add`, returning `Overflow` rather than wrapping
/// or panicking when the accumulator would exceed `i32::MAX`.
pub fn checked_sum(values: &[i32]) -> Result<i32, MathError> {
    let mut acc: i32 = 0;
    for v in values {
        acc = acc.checked_add(*v).ok_or(MathError::Overflow)?;
    }
    Ok(acc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_overflow_is_reported() {
        assert_eq!(safe_add(i32::MAX, 1), Err(MathError::Overflow));
    }

    #[test]
    fn div_by_zero_is_reported() {
        assert_eq!(safe_div(10, 0), Err(MathError::DivideByZero));
    }

    #[test]
    fn checked_sum_handles_empty() {
        assert_eq!(checked_sum(&[]), Ok(0));
    }

    #[test]
    fn checked_sum_handles_overflow() {
        assert_eq!(checked_sum(&[i32::MAX, 1]), Err(MathError::Overflow));
    }
}
