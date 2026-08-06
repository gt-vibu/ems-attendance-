import { and, eq } from 'drizzle-orm';
import { db } from '../../db';

// A recurring pattern across route files: fetch a row by its raw numeric
// id, THEN check row.tenantId === req.user.tenantId and 404 if it doesn't
// match, rather than filtering by tenantId in the query itself. Every
// instance of this actually reviewed across two audits was correct — but
// the pattern requires every future call site to remember the post-fetch
// check, and one missed instance is a direct cross-tenant BOLA
// vulnerability. This makes the safe form the only form: tenantId is
// baked into the WHERE clause, so a cross-tenant id simply returns no rows,
// with no separate check to forget.
//
// Typed loosely (`table: any`) rather than fighting Drizzle's generic
// PgTable inference — matches this codebase's existing convention of `any`
// throughout every route handler rather than introducing a stricter style
// in one isolated utility.
export async function getByIdForTenant(table: any, id: number, tenantId: number): Promise<any> {
  const rows = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).limit(1);
  return rows[0];
}
