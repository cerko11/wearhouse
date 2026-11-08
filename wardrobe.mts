import { isBanned } from './lib/moderation.mjs';
import { getUser } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, sql } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const user = await getUser();
  if (!user) return Response.json({ error: 'Please log in again to sync.' }, { status: 401, headers });
  if (new URL(req.url).searchParams.get('owner') !== user.id) return new Response(null, { status: 403, headers });
  if (!['GET', 'POST'].includes(req.method)) return new Response(null, { status: 405, headers });
  try {
    if (await isBanned(user.id)) return new Response(null, { status: 403, headers });
    const db = drizzle();
    if (req.method === 'POST') {
      if (new URL(req.url).origin !== req.headers.get('origin')) return new Response(null, { status: 403, headers });
      const body = await req.text();
      if (body.length > 2_000_000) return new Response(null, { status: 413, headers });
      const { key, value, patch } = JSON.parse(body);
      const fields = ['userProfile','weeklyPlan','referencePhoto','styleSettings','dailyOutfit','generatedOutfit','wishlist','communityReactions'];
      if (typeof key !== 'string' || key.length > 180 || !(fields.includes(key) || /^(wardrobe|savedOutfits|posts):[\w-]+$/.test(key))) {
        return Response.json({ error: 'Invalid wardrobe record.' }, { status: 400, headers });
      }
      if (key.startsWith('posts:')) {
        const [removed] = await db.select().from(accountRecords).where(and(eq(accountRecords.userId, user.id), eq(accountRecords.key, 'moderation:post:' + key.slice(6))));
        if (removed?.value === true && value !== null) return Response.json({ ok: true }, { headers });
      }
      // Tombstones prevent a stale device from recreating a deleted item on its next pull.
      await db.insert(accountRecords).values({ userId: user.id, key, value: value ?? null })
        .onConflictDoUpdate({ target: [accountRecords.userId, accountRecords.key], set: { value: key === 'userProfile' && patch && typeof patch === 'object' && !Array.isArray(patch) ? sql`coalesce(${accountRecords.value}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` : value ?? null, updatedAt: new Date() } });
      return Response.json({ ok: true }, { headers });
    }
    const records = await db.select({ key: accountRecords.key, value: accountRecords.value }).from(accountRecords).where(eq(accountRecords.userId, user.id));
    return Response.json({ records: Object.fromEntries(records.map(r => [r.key, r.value])) }, { headers });
  } catch {
    return Response.json({ error: 'Cloud sync is unavailable. Your pending changes remain on this device.' }, { status: 503, headers });
  }
};
