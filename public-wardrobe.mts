import { isBanned } from './lib/moderation.mjs';
import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, like, or } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'private, no-store' };
  const user = await getUser();
  if (!user) return new Response(null, { status: 401, headers });
  if (req.method !== 'GET') return new Response(null, { status: 405, headers });
  const params = new URL(req.url).searchParams, owner = params.get('member'), key = params.get('key');
  if (!owner || (key && !/^[a-f0-9]{64}$/.test(key))) return new Response(null, { status: 400, headers });
  try {
    if (await isBanned(owner)) return new Response(null, { status: 403, headers });
    if (await isBanned(user.id)) return new Response(null, { status: 403, headers });
    const db = drizzle();
    const profiles = await db.select().from(accountRecords).where(and(eq(accountRecords.key, 'userProfile'), or(eq(accountRecords.userId, owner), eq(accountRecords.userId, user.id))));
    const profile = profiles.find(r => r.userId === owner)?.value as any;
    const viewer = profiles.find(r => r.userId === user.id)?.value as any;
    if (owner !== user.id && (profile?.wardrobePublic !== true || profile?.blockedUsers?.includes(user.id) || viewer?.blockedUsers?.includes(owner))) return new Response(null, { status: 403, headers });
    const rows = await db.select().from(accountRecords).where(and(eq(accountRecords.userId, owner), like(accountRecords.key, 'wardrobe:%')));
    const items = rows.filter(r => r.value).map(r => ({ ...(r.value as any), id: r.key.slice(9) }));
    if (key) {
      if (!items.some(i => i.photo?.__wearhouseImage === key)) return new Response(null, { status: 404, headers });
      const data = await getStore({ name: 'wardrobe-images', consistency: 'strong' }).get(owner + '/' + key, { type: 'text' });
      const match = data?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return new Response(null, { status: 404, headers });
      return new Response(Uint8Array.from(atob(match[2]), c => c.charCodeAt(0)), { headers: { ...headers, 'Content-Type': match[1], 'X-Content-Type-Options': 'nosniff' } });
    }
    return Response.json({ items: items.map(i => ({ id: i.id, name: i.name, category: i.category, color: i.color, brand: i.brand, photo: i.photo?.__wearhouseImage ? '/.netlify/functions/public-wardrobe?member=' + encodeURIComponent(owner) + '&key=' + encodeURIComponent(i.photo.__wearhouseImage) : typeof i.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(i.photo) ? i.photo : '' })) }, { headers });
  } catch { return Response.json({ error: 'Wardrobe temporarily unavailable.' }, { status: 503, headers }); }
};
