use safe_app::calculator::{safe_add, MathError};
use safe_app::parser::{parse_positive_int, ParseError};
use safe_app::validator::{validate_username, ValidationError};

fn main() {
    let username = std::env::args().nth(1).unwrap_or_else(|| "alice".to_string());

    match validate_username(&username) {
        Ok(()) => println!("username ok: {username}"),
        Err(ValidationError::Empty) => {
            eprintln!("username must not be empty");
            return;
        }
        Err(ValidationError::TooLong { max }) => {
            eprintln!("username exceeds {max} characters");
            return;
        }
        Err(ValidationError::InvalidChar(ch)) => {
            eprintln!("username contains invalid character: {ch:?}");
            return;
        }
    }

    let count_arg = std::env::args().nth(2).unwrap_or_else(|| "10".to_string());
    let count = match parse_positive_int(&count_arg) {
        Ok(n) => n,
        Err(ParseError::Empty) => {
            eprintln!("count must not be empty");
            return;
        }
        Err(ParseError::InvalidNumber(s)) => {
            eprintln!("count is not a valid number: {s}");
            return;
        }
        Err(ParseError::OutOfRange) => {
            eprintln!("count is out of range");
            return;
        }
    };

    match safe_add(count, 1) {
        Ok(next) => println!("next = {next}"),
        Err(MathError::Overflow) => eprintln!("count + 1 would overflow"),
        Err(MathError::DivideByZero) => unreachable!(),
    }
}
