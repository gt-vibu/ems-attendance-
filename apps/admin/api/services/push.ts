import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const configured = !!(vapidPublicKey && vapidPrivateKey);

if (configured) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublicKey, vapidPrivateKey);
}

export function isPushConfigured(): boolean {
  return configured;
}

// Best-effort fan-out to every device a user has subscribed on. Never
// throws — a missing VAPID config or a delivery failure should never break
// the in-app notification this always accompanies (see notifications.ts).
// A 404/410 from the push service means the subscription is dead (browser
// uninstalled, permission revoked, etc.) — deleted on sight rather than
// retried, since there's nothing to retry.
export async function sendPushToUser(userId: number, title: string, body: string, url?: string) {
  if (!configured) return;
  try {
    const subs = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
    if (subs.length === 0) return;
    const payload = JSON.stringify({ title, body, url: url || '/' });
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
          payload,
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
        }
      }
    }));
  } catch {
    // Never let a push failure surface to the caller — it's always
    // supplementary to an in-app notification that already succeeded.
  }
}

export async function sendPushToUsers(userIds: number[], title: string, body: string, url?: string) {
  await Promise.all([...new Set(userIds)].map((id) => sendPushToUser(id, title, body, url)));
}
