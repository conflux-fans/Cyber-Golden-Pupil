extern "C" {
    fn strlen(s: *const u8) -> usize;
    fn memcpy(dst: *mut u8, src: *const u8, n: usize) -> *mut u8;
}

/// No null check on `p` and no upper bound: `strlen` will walk off the end of
/// any buffer that isn't NUL-terminated and segfault — or worse, return a
/// length controlled by surrounding heap layout.
pub unsafe fn count_chars(p: *const u8) -> usize {
    strlen(p)
}

/// `transmute` between two layouts the caller asserts are equivalent. If the
/// invariant is violated by a future change to either type, this is instant
/// UB without a compiler error.
pub unsafe fn reinterpret(v: u32) -> i32 {
    std::mem::transmute(v)
}

/// `#[no_mangle]` export with a raw `*mut u8`, `len: u32` parameters. The
/// caller is trusted to honor the (undocumented) precondition `len <= cap`.
/// Also silently truncates `len` to `usize` via `as`.
#[no_mangle]
pub extern "C" fn xor_buf(buf: *mut u8, len: u32) {
    unsafe {
        for i in 0..(len as usize) {
            let p = buf.add(i);
            *p = *p ^ 0x42;
        }
    }
}

/// `Box::from_raw` on a pointer of unknown provenance. If the caller didn't
/// produce `p` via `Box::into_raw`, this is UB.
pub unsafe fn free_unknown(p: *mut [u8; 32]) {
    let _ = Box::from_raw(p);
}

/// Returns a borrowed slice into a local buffer — use-after-free as soon as
/// the function returns.
pub unsafe fn dangling_slice<'a>() -> &'a [u8] {
    let local = [1u8, 2, 3, 4];
    let ptr = local.as_ptr();
    std::slice::from_raw_parts(ptr, local.len())
}
