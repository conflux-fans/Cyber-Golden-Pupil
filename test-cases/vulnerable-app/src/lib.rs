// Fixture crate intentionally containing security and correctness bugs.
// Each module demonstrates a distinct vulnerability class. Do not deploy.

pub mod auth;
pub mod concurrency;
pub mod db;
pub mod deser;
pub mod exec;
pub mod ffi;
pub mod files;
pub mod parse;
