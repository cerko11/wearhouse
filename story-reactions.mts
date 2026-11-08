import { getUser } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const db = drizzle(), id = new URL(req.url).searchParams.get('id') || '';
    const [story] = await db.select().from(accountRecords).where(eq(accountRecords.key, 'story:' + id));
    if (!story || await isBanned(story.userId)) return new Response(null, { status: 404, headers });
    const user = await getUser(), key = 'story-like:' + id;
    if (req.method === 'POST') {
      if (!user) return new Response(null, { status: 401, headers });
      if (await isBanned(user.id) || req.headers.get('origin') !== new URL(req.url).origin) return new Response(null, { status: 403, headers });
      const { liked, shared } = await req.json();
      if(shared===true){
       await db.insert(accountRecords).values({userId:user.id,key:'story-share:'+id,value:{createdAt:Date.now()}}).onConflictDoNothing();
       return Response.json({ok:true},{headers});
      }
      if (liked === true) await db.insert(accountRecords).values({ userId: user.id, key, value: true }).onConflictDoNothing();
      else await db.delete(accountRecords).where(and(eq(accountRecords.userId, user.id), eq(accountRecords.key, key)));
    } else if (req.method !== 'GET') return new Response(null, { status: 405, headers });
    const rows = await db.select().from(accountRecords).where(eq(accountRecords.key, key));
    const visible = [];
    for (const row of rows) if (!await isBanned(row.userId)) visible.push(row);
    return Response.json({ likes: visible.length, liked: visible.some(r => r.userId === user?.id) }, { headers });
  } catch { return Response.json({ error: 'Reactions unavailable. Please retry.' }, { status: 503, headers }); }
};
