import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Local-disk storage adapter for employee documents. Swappable later for a
// cloud object store (S3, GCS, etc.) without touching documents.routes.ts —
// every call site here only deals with a storagePath string, never a raw
// filesystem path, so the adapter is the only thing that would need to
// change.
//
// Files are named by a random key, never the original filename — the
// original name is preserved separately (employeeDocuments.fileName) purely
// for the Content-Disposition header on download. Never build a path from a
// client-supplied filename; that's the classic path-traversal opening
// ("../../etc/passwd" as a "filename").
const STORAGE_ROOT = process.env.DOCUMENTS_STORAGE_DIR
  ? path.resolve(process.env.DOCUMENTS_STORAGE_DIR)
  : path.join(process.cwd(), 'uploads', 'documents');

function ensureRoot() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

export async function saveDocument(tenantId: number, buffer: Buffer): Promise<string> {
  ensureRoot();
  const tenantDir = path.join(STORAGE_ROOT, String(tenantId));
  if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true });
  const key = crypto.randomBytes(24).toString('hex');
  const storagePath = `${tenantId}/${key}`;
  await fs.promises.writeFile(path.join(tenantDir, key), buffer);
  return storagePath;
}

// storagePath is always a value this service itself generated and stored in
// the database — never taken directly from a request — so no traversal
// characters can appear in it, but resolve+prefix-check anyway as a second
// line of defense against a future call site that gets this wrong.
function resolveSafePath(storagePath: string): string {
  const resolved = path.resolve(STORAGE_ROOT, storagePath);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error('Invalid document storage path.');
  }
  return resolved;
}

export async function readDocument(storagePath: string): Promise<Buffer> {
  return fs.promises.readFile(resolveSafePath(storagePath));
}

export async function deleteDocument(storagePath: string): Promise<void> {
  try {
    await fs.promises.unlink(resolveSafePath(storagePath));
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Used when a whole tenant is hard-deleted — removes every file this
// tenant ever uploaded in one shot rather than one unlink per row.
export async function deleteTenantDocumentsDir(tenantId: number): Promise<void> {
  const tenantDir = path.join(STORAGE_ROOT, String(tenantId));
  await fs.promises.rm(tenantDir, { recursive: true, force: true });
}
