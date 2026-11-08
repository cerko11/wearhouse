import { isBanned } from './lib/moderation.mjs';
import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'private, no-store' };
  const viewer = await getUser();
  if (!viewer) return new Response(null, { status: 401, headers });
  if (await isBanned(viewer.id)) return new Response(null, { status: 403, headers });
  if (req.method !== 'GET') return new Response(null, { status: 405, headers });
  const params = new URL(req.url).searchParams, owner = params.get('owner'), post = params.get('post'), key = params.get('key'), profile = params.get('profile') === '1';
  if (!owner || (!post && !profile) || !key || !/^[a-f0-9]{64}$/.test(key)) return new Response(null, { status: 400, headers });
  try {
    if (await isBanned(owner)) return new Response(null, { status: 403, headers });
    const [row] = await drizzle().select().from(accountRecords).where(and(eq(accountRecords.userId, owner), eq(accountRecords.key, profile ? 'userProfile' : 'posts:' + post)));
    const p = row?.value as any;
    if (!p || !(profile ? [p.avatar] : [p.image, ...(p.piecesSnapshot || []).map((i: any) => i.photo)]).some(v => v?.__wearhouseImage === key)) return new Response(null, { status: 404, headers });
    const data = await getStore({ name: 'wardrobe-images', consistency: 'strong' }).get(owner + '/' + key, { type: 'text' });
    const match = data?.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return new Response(null, { status: 404, headers });
    return new Response(Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)), { headers: { ...headers, 'Content-Type': match[1], 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response(null, { status: 503, headers }); }
};
