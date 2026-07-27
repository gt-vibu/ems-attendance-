// Tiny in-process per-key mutex. Used to serialize the read-then-write
// attendance check-in/check-out flow for a single user: without it, a
// double-tap on a slow connection (or two open tabs) can both read "no
// active check-in yet" before either has inserted its row, producing two
// check-in rows or a mismatched checkout. This only coordinates within one
// Node process — fine for this app's single-instance deployment; a
// multi-instance deployment would need a DB-level lock (e.g. a Postgres
// advisory lock, as tryAcquireSchedulerLeadership in db.ts already does for
// the scheduler) instead.
const locks = new Map<string, Promise<void>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, previous.then(() => current));

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
