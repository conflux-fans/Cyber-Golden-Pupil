import type { ScanMode } from "../types.js";

export interface Rule {
  hint: string;
  re: RegExp;
}

/**
 * Risk-hint rules for the SAFETY mode: memory safety, panics, unchecked casts,
 * FFI, command/SQL/path injection, crypto misuse, untrusted deserialization.
 */
export const SAFETY_RULES: Rule[] = [
  { hint: "unsafe", re: /\bunsafe\b/ },
  { hint: "ffi", re: /\bextern\s+"C"|#\[no_mangle\]/ },
  { hint: "panic", re: /\.unwrap\(\)|\.expect\(/ },
  { hint: "cast", re: /\bas\s+(u|i)(8|16|32|64|size)\b/ },
  { hint: "process", re: /std::process::Command|Command::new/ },
  { hint: "fs", re: /std::fs::|tokio::fs::/ },
  { hint: "net", re: /reqwest::|hyper::|tokio::net::/ },
  { hint: "sql", re: /sqlx::|diesel::|rusqlite::/ },
  { hint: "crypto", re: /\bmd5\b|\bsha1\b|rand::random|ring::|openssl::/ },
  { hint: "deser", re: /serde_json::from_|bincode::deserialize|rmp_serde::|toml::from_/ },
  { hint: "transmute", re: /std::mem::transmute|mem::transmute/ },
];

/**
 * Risk-hint rules for the LOGIC mode: logic bugs, DoS / resource exhaustion,
 * unsound concurrency design, implementation defects.
 *
 * Selection rationale: each hint flags code shape where the LLM has the highest
 * chance of finding a real defect in this category. We deliberately accept some
 * over-recall here (e.g. all loops, all locks) because the chunk-level prompt
 * filters back down to actual exploitable cases.
 */
export const LOGIC_RULES: Rule[] = [
  // Loops: unbounded iteration over input, or `loop {}` without a clear exit.
  { hint: "loop", re: /\bloop\s*\{|\bwhile\s+let\b|\bwhile\s+!?\w/ },
  // Recursion proxies: `fn` that calls itself is hard to detect via regex, so
  // we hint on common recursion-heavy idioms (the LLM does the real check).
  { hint: "recursion", re: /\bBox<dyn\s+Future|\.boxed\(\)|async fn .*\bself\b/ },
  // Allocations sized by a runtime value — classic DoS amplifier.
  {
    hint: "alloc-sized",
    re: /Vec::with_capacity\s*\(|String::with_capacity\s*\(|HashMap::with_capacity\s*\(|vec!\s*\[\s*\w+\s*;|\bBytes::with_capacity\s*\(/,
  },
  // Unbounded reads from network / file / stdin.
  {
    hint: "io-unbounded",
    re: /\bread_to_end\b|\bread_to_string\b|\bread_until\b|\bread_line\b|\bBufReader::new|copy\s*\(/,
  },
  // Sync primitives — lock-ordering, holding across await, contention.
  {
    hint: "lock",
    re: /\bMutex\b|\bRwLock\b|\bparking_lot::|\bMutexGuard\b|\bRwLockReadGuard\b|\bRwLockWriteGuard\b/,
  },
  // Atomics — Ordering misuse is a common subtle bug.
  { hint: "atomic", re: /\bAtomic(?:U|I)(?:8|16|32|64|size)\b|\bAtomicBool\b|\bOrdering::/ },
  // Async: deadlocks across .await, blocking inside async, cancellation safety.
  {
    hint: "async",
    re: /\.await\b|\btokio::select!|\btokio::join!|\btokio::spawn\b|\bspawn_blocking\b|\bblock_on\b|\basync\s+fn\b|\basync\s+move\b|\basync\s+\{/,
  },
  // Threading.
  { hint: "thread", re: /\bstd::thread::spawn\b|\bthread::spawn\b|\brayon::/ },
  // Channels / queues — backpressure, unbounded growth.
  {
    hint: "channel",
    re: /\bmpsc::|crossbeam_channel::|\btokio::sync::(mpsc|broadcast|watch|oneshot)|\bflume::/,
  },
  // Regex — catastrophic backtracking. (Rust's `regex` crate is backtracking-free,
  // but `fancy-regex` / `regress` / `pcre` bindings aren't.)
  {
    hint: "regex",
    re: /\bRegex::new\b|\bfancy_regex::|\bregress::|\bpcre/,
  },
  // Timeouts & timing — missing timeout is a DoS, system time is non-monotonic.
  {
    hint: "time",
    re: /\bDuration::from_|\btokio::time::|\bInstant::now\b|\bSystemTime::now\b|\btimeout\s*\(/,
  },
  // Cancellation / shutdown plumbing — often where deadlocks hide.
  {
    hint: "cancel",
    re: /\bCancellationToken\b|\bShutdown\b|\bdrop\(\s*tx\s*\)|\bAbortHandle\b/,
  },
  // Result/error swallowing — `let _ = ...` and `.ok()` on a meaningful op.
  {
    hint: "error-swallow",
    re: /\blet\s+_\s*=|\.ok\(\)\s*;|\.unwrap_or_default\(\)|\.unwrap_or\(\s*\)/,
  },
  // Arithmetic on indices / sizes — off-by-one and overflow that flip control flow.
  {
    hint: "arith",
    re: /\.len\(\)\s*[-+]|\bsaturating_|\bwrapping_|\bchecked_|\.checked_(add|sub|mul|div)\b/,
  },
  // HashMap iteration in consensus / replay paths is non-deterministic.
  { hint: "nondet", re: /\bHashMap\b|\bHashSet\b|\bf32\b|\bf64\b/ },
];

/**
 * Risk-hint rules for the PANIC mode: every reachable crash path.
 *
 * Selection rationale: a function can only crash if it does one of these
 * operations. Indexing (`a[i]`) is intentionally NOT hinted here — it appears
 * in nearly every Rust function and would defeat the prefilter. The LLM is
 * instructed to look for indexing/slicing panics inside any chunk gated by the
 * other hints (most panic-prone code touches at least one of them too).
 */
export const PANIC_RULES: Rule[] = [
  // Explicit unwraps on Option/Result — the most common panic source.
  {
    hint: "unwrap",
    re: /\.unwrap\(\)|\.expect\s*\(|\.unwrap_err\(\)|\.expect_err\s*\(|\.unwrap_unchecked\s*\(/,
  },
  // Panic-raising macros.
  {
    hint: "panic-macro",
    re: /\bpanic!\s*\(|\bunreachable!\s*\(|\btodo!\s*\(|\bunimplemented!\s*\(|\bassert!\s*\(|\bassert_eq!\s*\(|\bassert_ne!\s*\(|\bdebug_assert/,
  },
  // Slice / iterator operations that panic on bad indices or zero step.
  {
    hint: "slice-op",
    re: /\.split_at(_mut)?\s*\(|\.chunks(_exact)?\s*\(|\.windows\s*\(|\.step_by\s*\(|\.swap\s*\(|\.remove\s*\(|\.swap_remove\s*\(|\.drain\s*\(/,
  },
  // Arithmetic helpers — their presence shows people are aware; the LLM should
  // also look for the SURROUNDING raw `/`, `%`, `<<` that may not be checked.
  {
    hint: "arith",
    re: /\bchecked_(add|sub|mul|div|rem|shl|shr)\b|\bwrapping_|\bsaturating_|\boverflowing_|\bDuration::from_|\bdiv_euclid\b|\brem_euclid\b/,
  },
  // Parsing / conversion that often becomes `.unwrap()` on bad input.
  {
    hint: "parse",
    re: /\.parse\s*(?:::|\()|\bfrom_str_radix\b|\btry_into\s*\(|\btry_from\s*\(|\bstr::from_utf8\b|\bString::from_utf8\b|\bCStr::from_bytes_with_nul\b/,
  },
  // Interior mutability — runtime-checked borrow can panic.
  {
    hint: "refcell",
    re: /\bRefCell\b|\.borrow\s*\(\)|\.borrow_mut\s*\(\)/,
  },
  // Lock poisoning: `Mutex::lock()` returns Err if a holder panicked.
  {
    hint: "lock",
    re: /\bMutex\b|\bRwLock\b|\bparking_lot::|\.lock\s*\(\)|\.read\s*\(\)|\.write\s*\(\)/,
  },
  // Channel send/recv: returns Err when the other side is dropped, commonly unwrapped.
  {
    hint: "channel",
    re: /\.send\s*\(|\.recv\s*\(\)|\.try_send\s*\(|\.try_recv\s*\(\)|\.blocking_send\s*\(|\.blocking_recv\s*\(\)|\.recv_async\s*\(\)/,
  },
  // Panic across an FFI boundary is UB / forces abort.
  { hint: "ffi", re: /\bextern\s+"C"|#\[no_mangle\]/ },
  // Drop impls — panic during unwind aborts the process.
  { hint: "drop-impl", re: /impl(?:<[^>]*>)?\s+Drop\s+for\b|fn\s+drop\s*\(\s*&mut\s+self\b/ },
  // Env / config lookups commonly unwrapped at startup.
  { hint: "env", re: /\bstd::env::var\b|\benv::var\b|\bvar_os\b/ },
  // Recursion proxies — stack overflow risk (same hint shape as logic mode,
  // kept here because stack overflow IS a crash).
  { hint: "recursion", re: /\bBox<dyn\s+Future|\.boxed\(\)|async fn .*\bself\b/ },
  // Task / future joining — `JoinHandle::await` propagates panics.
  {
    hint: "task-join",
    re: /\bJoinHandle\b|\.join\s*\(\)|\btokio::task::spawn\b|\btokio::spawn\b/,
  },
];

export function getRules(mode: ScanMode): Rule[] {
  if (mode === "logic") return LOGIC_RULES;
  if (mode === "panic") return PANIC_RULES;
  return SAFETY_RULES;
}
