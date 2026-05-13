use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub struct Accounts {
    pub a: Arc<Mutex<i64>>,
    pub b: Arc<Mutex<i64>>,
}

impl Accounts {
    /// Lock-order inversion: `forward` takes `a` then `b`, while `backward`
    /// takes `b` then `a`. Two threads calling them concurrently can
    /// deadlock the whole process.
    pub fn forward(&self, amount: i64) {
        let mut a = self.a.lock().unwrap();
        // Widens the deadlock window.
        thread::sleep(Duration::from_millis(1));
        let mut b = self.b.lock().unwrap();
        *a -= amount;
        *b += amount;
    }

    pub fn backward(&self, amount: i64) {
        let mut b = self.b.lock().unwrap();
        thread::sleep(Duration::from_millis(1));
        let mut a = self.a.lock().unwrap();
        *b -= amount;
        *a += amount;
    }

    /// Reads the two balances under separate locks, so the returned pair is
    /// not an atomic snapshot — a concurrent `forward` can be observed
    /// mid-transfer and the returned sum will be wrong.
    pub fn total(&self) -> i64 {
        let a = *self.a.lock().unwrap();
        let b = *self.b.lock().unwrap();
        a + b
    }
}

/// Holds the lock across an `await` point in async contexts: any blocking
/// op done by the awaited future cannot complete because the lock is held.
/// Even in sync code, the `expect` panics poison the mutex permanently.
pub fn drain_into<T: Default>(slot: &Mutex<T>) -> T {
    let mut guard = slot.lock().expect("poisoned");
    std::mem::take(&mut *guard)
}
