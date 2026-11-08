import { getUser } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, like } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';
import { isAdminEmail } from './lib/admin.mjs';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  const db = drizzle(), url = new URL(req.url);
  const store = getStore({ name: 'story-images', consistency: 'strong' });
  try {
    if (req.method === 'GET') {
      const rows = await db.select().from(accountRecords).where(like(accountRecords.key, 'story:%'));
      const visible = [];
      for (const row of rows) if (!await isBanned(row.userId)) visible.push(row);
      const id = url.searchParams.get('id');
      if (id) {
        const row = visible.find(r => r.key === 'story:' + id);
        if (!row) return new Response(null, { status: 404, headers });
        const image = await store.get(id, { type: 'arrayBuffer' });
        return image ? new Response(image, { headers: { ...headers, 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404, headers });
      }
      return Response.json({ stories: visible.map(r => ({ ...(r.value as object), id: r.key.slice(6), authorId: r.userId, image: '/.netlify/functions/stories?id=' + encodeURIComponent(r.key.slice(6)) })).sort((a: any, b: any) => b.createdAt - a.createdAt) }, { headers });
    }
    const user = await getUser();
    if (!user) return new Response(null, { status: 401, headers });
    if (url.origin !== req.headers.get('origin') || await isBanned(user.id)) return new Response(null, { status: 403, headers });
    if (req.method === 'POST') {
      const body = await req.json();
      if (typeof body.image !== 'string' || body.image.length > 1_500_000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image)) return new Response(null, { status: 400, headers });
      const id = crypto.randomUUID();
      const [profile] = await db.select().from(accountRecords).where(and(eq(accountRecords.userId, user.id), eq(accountRecords.key, 'userProfile')));
      const username = (profile?.value as any)?.username || 'member';
      await store.set(id, Buffer.from(body.image.split(',')[1], 'base64'));
      await db.insert(accountRecords).values({ userId: user.id, key: 'story:' + id, value: { username, caption: String(body.caption || '').slice(0, 300), createdAt: Date.now() } });
      return Response.json({ id }, { status: 201, headers });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      const [row] = await db.select().from(accountRecords).where(eq(accountRecords.key, 'story:' + id));
      if (!row) return new Response(null, { status: 404, headers });
      if (row.userId !== user.id && !isAdminEmail(user.email)) return new Response(null, { status: 403, headers });
      await db.delete(accountRecords).where(and(eq(accountRecords.userId, row.userId), eq(accountRecords.key, row.key)));
      await store.delete(id);
      return Response.json({ ok: true }, { headers });
    }
    return new Response(null, { status: 405, headers });
  } catch { return Response.json({ error: 'Stories are temporarily unavailable.' }, { status: 503, headers }); }
};
