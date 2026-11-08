import { isAdminEmail } from './lib/admin.mjs';
import { getUser, admin } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const reply = (body: object, status = 200) => Response.json(body, { status, headers });
  const user = await getUser();
  if (!user) return reply({ error: 'Sign in to continue.' }, 401);
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
  if (req.headers.get('origin') !== new URL(req.url).origin) return reply({ error: 'Invalid origin.' }, 403);
  try {
    if (await isBanned(user.id)) return reply({ error: 'Account suspended.' }, 403);
    const body = await req.text();
    if (body.length > 4096) return reply({ error: 'Request too large.' }, 413);
    const { action, owner, post, comment, verified } = JSON.parse(body);
    if (typeof owner !== 'string' || !/^[\w-]{1,100}$/.test(owner)) return reply({ error: 'Invalid account.' }, 400);
    const elevated = isAdminEmail(user.email);
    if (!elevated && !(action === 'delete-comment' && comment?.startsWith(user.id + ':'))) return reply({ error: 'Admin permission required.' }, 403);
    const db = drizzle();
    const save = async (id: string, key: string, value: any) => {
      await db.insert(accountRecords).values({ userId: id, key, value }).onConflictDoUpdate({ target: [accountRecords.userId, accountRecords.key], set: { value, updatedAt: new Date() } });
    };
    if (action === 'verify') {
      if (typeof verified !== 'boolean') return reply({ error: 'Invalid verification.' }, 400);
      const [existing] = await db.select().from(accountRecords).where(and(eq(accountRecords.userId, owner), eq(accountRecords.key, 'moderation:account')));
      await save(owner, 'moderation:account', { ...(existing?.value as object || {}), verified });
    } else if (action === 'ban' || action === 'delete-account') {
      if (owner === user.id) return reply({ error: 'You cannot remove your own admin account.' }, 400);
      // Persist suspension before deleting Identity so existing JWTs cannot continue using the app.
      await save(owner, 'moderation:account', { banned: true, verified: false });
      if (action === 'delete-account') {
        await admin.deleteUser(owner);
        const rows = await db.select().from(accountRecords).where(eq(accountRecords.userId, owner));
        for (const row of rows) if (!row.key.startsWith('moderation:')) await save(owner, row.key, null);
      }
    } else if (action === 'delete-post' || action === 'delete-comment') {
      if (typeof post !== 'string' || !/^[\w-]{1,100}$/.test(post)) return reply({ error: 'Invalid post.' }, 400);
      if (action === 'delete-post') {
        await save(owner, 'moderation:post:' + post, true);
        await save(owner, 'posts:' + post, null);
      } else {
        if (typeof comment !== 'string' || !/^[\w-]+:[\w-]+$/.test(comment)) return reply({ error: 'Invalid comment.' }, 400);
        await save(owner, 'moderation:comment:' + post + ':' + comment, true);
      }
    } else return reply({ error: 'Unknown action.' }, 400);
    return reply({ ok: true });
  } catch { return reply({ error: 'Moderation could not be completed. Refresh and retry.' }, 503); }
};
