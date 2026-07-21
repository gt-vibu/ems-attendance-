// Offline retry queue for the FINAL attendance submit only. Nothing earlier
// in the flow can be queued this way — WebAuthn's challenge/response and the
// GPS/Wi-Fi preview steps are live round-trips to the server and simply
// can't happen without connectivity. What this queue actually protects
// against is the realistic "dead zone" failure: identity + location were
// already verified, the employee is walking into a spotty-signal building,
// and the LAST network call (the one that actually records the check-in)
// drops. Rather than losing that completed attempt, we store the exact
// request body in IndexedDB and replay it automatically once connectivity
// returns — the identity-pass token still has to be valid when that
// happens (it expires in minutes), so a long outage still means redoing
// verification, surfaced clearly rather than retried silently forever.

const DB_NAME = 'attendance-offline-queue';
const STORE_NAME = 'pending';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface QueuedAttendance {
  id?: number;
  token: string; // auth bearer token at time of queuing
  body: any; // the exact /api/attendance request body
  queuedAt: string;
}

export async function queueAttendanceSubmit(authToken: string, body: any): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ token: authToken, body, queuedAt: new Date().toISOString() } as QueuedAttendance);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getQueuedAttendance(): Promise<QueuedAttendance[]> {
  const db = await openDb();
  const result = await new Promise<QueuedAttendance[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function removeQueuedAttendance(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// Attempts to replay every queued submission. Each one that the server
// accepts (or definitively rejects, e.g. an expired identity-pass token) is
// removed from the queue; anything that fails again for network reasons
// stays queued for the next attempt (next 'online' event or page load).
// Returns a summary so the caller can show the employee what happened.
export async function flushAttendanceQueue(): Promise<{ succeeded: number; failed: number; failedMessages: string[] }> {
  const items = await getQueuedAttendance();
  let succeeded = 0;
  let failed = 0;
  const failedMessages: string[] = [];

  for (const item of items) {
    if (item.id == null) continue;
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${item.token}` },
        body: JSON.stringify(item.body),
      });
      if (res.ok) {
        succeeded++;
        await removeQueuedAttendance(item.id);
      } else {
        // A definitive server response (even a rejection) means the
        // request was actually delivered — retrying it again won't change
        // the outcome, so it's removed rather than retried forever.
        const data = await res.json().catch(() => ({}));
        failed++;
        failedMessages.push(data.error || 'A queued check-in could not be completed.');
        await removeQueuedAttendance(item.id);
      }
    } catch {
      // Still offline / request didn't reach the server — leave it queued.
      failed++;
    }
  }

  return { succeeded, failed, failedMessages };
}
