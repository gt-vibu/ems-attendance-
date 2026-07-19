import { db, schema } from '../../db';

// In-app notifications for a tenant's own users (employees, managers, HR,
// tenant_admin, etc.) — distinct from the super-admin inbox, which
// pre-dates this and uses userId: null (see super.routes.ts). Every row
// here is addressed to exactly one real users.id, so "my notifications"
// is always a simple filter by the caller's own id — no separate
// broadcast/tenant-wide row type is needed; a tenant-wide event (e.g. a
// new holiday) just fans out one row per affected user via notifyUsers().

export async function notifyUser(userId: number, title: string, message: string) {
  await db.insert(schema.notifications).values({ userId, title, message });
}

export async function notifyUsers(userIds: number[], title: string, message: string) {
  const uniqueIds = [...new Set(userIds)].filter((id) => typeof id === 'number' && !Number.isNaN(id));
  if (uniqueIds.length === 0) return;
  await db.insert(schema.notifications).values(
    uniqueIds.map((userId) => ({ userId, title, message }))
  );
}
