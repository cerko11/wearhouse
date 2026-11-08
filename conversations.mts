import { getUser } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, like } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const user = await getUser();
    if (!user) return new Response(null, { status: 401, headers });
    if (await isBanned(user.id)) return new Response(null, { status: 403, headers });
    const db = drizzle();
    if (req.method === 'GET') {
      const rows = await db.select().from(accountRecords).where(like(accountRecords.key, 'message:%'));
      const messages = rows.map(r => ({ ...(r.value as any), id: r.key.slice(8), sender: r.userId })).filter(m => m.sender === user.id || m.recipient === user.id).sort((a,b) => a.createdAt-b.createdAt);
      const statuses = await db.select().from(accountRecords).where(like(accountRecords.key,'chat-status:%'));
      const requests = [...new Set(messages.filter(m=>m.recipient===user.id).map(m=>m.sender))].filter(peer=>!messages.some(m=>m.sender===user.id&&m.recipient===peer) && !statuses.some(r=>r.userId===user.id&&r.key==='chat-status:'+peer));
      const declined = statuses.filter(r=>r.userId===user.id&&r.value==='decline').map(r=>r.key.slice(12));
      return Response.json({ messages:messages.filter(m=>!declined.includes(m.sender===user.id?m.recipient:m.sender)), requests }, { headers });
    }
    if (req.method === 'PATCH') {
      if (req.headers.get('origin') !== new URL(req.url).origin) return new Response(null, {status:403,headers});
      const {peer, action} = await req.json();
      if (!['accept','decline'].includes(action) || typeof peer !== 'string') return new Response(null,{status:400,headers});
      const rows = await db.select().from(accountRecords).where(like(accountRecords.key,'message:%'));
      if (!rows.some(r => r.userId === peer && (r.value as any).recipient === user.id)) return new Response(null,{status:403,headers});
      await db.insert(accountRecords).values({userId:user.id,key:'chat-status:'+peer,value:action}).onConflictDoUpdate({target:[accountRecords.userId,accountRecords.key],set:{value:action}});
      return Response.json({ok:true},{headers});
    }
    if (req.method !== 'POST') return new Response(null, { status: 405, headers });
    if (req.headers.get('origin') !== new URL(req.url).origin) return new Response(null, { status: 403, headers });
    const body = await req.json(), recipient = String(body.recipient || ''), text = String(body.text || '').trim();
    if (!recipient || recipient === user.id || !text || text.length > 1000) return new Response(null, { status: 400, headers });
    const profiles = await db.select().from(accountRecords).where(eq(accountRecords.key, 'userProfile'));
    const target = profiles.find(r => r.userId === recipient), own = profiles.find(r => r.userId === user.id);
    if (!target || await isBanned(recipient) || (target.value as any)?.blockedUsers?.includes(user.id) || (own?.value as any)?.blockedUsers?.includes(recipient)) return new Response(null, { status: 403, headers });
    const [decision] = await db.select().from(accountRecords).where(and(eq(accountRecords.userId,recipient),eq(accountRecords.key,'chat-status:'+user.id)));
    if (decision?.value === 'decline') return new Response(null,{status:403,headers});
    const history = await db.select().from(accountRecords).where(like(accountRecords.key,'message:%'));
    const incoming = history.some(r=>r.userId===recipient&&(r.value as any).recipient===user.id);
    const outgoing = history.some(r=>r.userId===user.id&&(r.value as any).recipient===recipient);
    if(incoming&&!outgoing){
      const [ownDecision]=await db.select().from(accountRecords).where(and(eq(accountRecords.userId,user.id),eq(accountRecords.key,'chat-status:'+recipient)));
      if(ownDecision?.value!=='accept')return new Response(null,{status:403,headers});
    }
    const storyId = typeof body.storyId === 'string' ? body.storyId : '';
    if (storyId) {
      const [story] = await db.select().from(accountRecords).where(eq(accountRecords.key, 'story:' + storyId));
      if (!story) return new Response(null, { status: 404, headers });
    }
    const id = crypto.randomUUID(), value = { recipient, text, storyId, createdAt: Date.now() };
    await db.insert(accountRecords).values({ userId: user.id, key: 'message:' + id, value });
    return Response.json({ message: { ...value, id, sender: user.id } }, { status: 201, headers });
  } catch { return Response.json({ error: 'Messages are temporarily unavailable. Please retry.' }, { status: 503, headers }); }
};
