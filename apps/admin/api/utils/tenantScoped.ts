import { and, eq } from 'drizzle-orm';
import { db } from '../../db';

/**
 * Enforces database-level multi-tenant isolation.
 * Every query automatically bakes tenant_id into the WHERE clause so
 * cross-tenant record leakage is prevented at the database query boundary.
 */

export async function getByIdForTenant(table: any, id: number, tenantId: number): Promise<any> {
  if (!id || !tenantId) return null;
  const rows = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId))).limit(1);
  return rows[0] || null;
}

export async function getAllForTenant(table: any, tenantId: number): Promise<any[]> {
  if (!tenantId) return [];
  return await db.select().from(table).where(eq(table.tenantId, tenantId));
}

export async function updateByIdForTenant(table: any, id: number, tenantId: number, updateData: Record<string, any>): Promise<boolean> {
  if (!id || !tenantId) return false;
  const res = await db.update(table)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  return (res as any)?.rowCount > 0 || (res as any)?.affectedRows > 0;
}

export async function deleteByIdForTenant(table: any, id: number, tenantId: number): Promise<boolean> {
  if (!id || !tenantId) return false;
  const res = await db.delete(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
  return (res as any)?.rowCount > 0 || (res as any)?.affectedRows > 0;
}

export function assertTenantOwnership(record: any, tenantId: number, resourceName: string = 'Resource'): void {
  if (!record) {
    const err: any = new Error(`${resourceName} not found`);
    err.status = 404;
    throw err;
  }
  if (record.tenantId !== undefined && record.tenantId !== null && Number(record.tenantId) !== Number(tenantId)) {
    const err: any = new Error(`Unauthorized access to ${resourceName} across tenant boundaries`);
    err.status = 403;
    throw err;
  }
}
