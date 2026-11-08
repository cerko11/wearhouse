import { getUser } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq, like } from 'drizzle-orm';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';
export default async (req: Request) => {
 const headers={'Cache-Control':'no-store'},db=drizzle();
 try {
  if(req.method==='GET'){
   const rows=await db.select().from(accountRecords).where(like(accountRecords.key,'highlight:%'));
   const highlights=[];
   for(const r of rows)if(!await isBanned(r.userId))highlights.push({...r.value as object,owner:r.userId,id:r.key.slice(10)});
   return Response.json({highlights},{headers});
  }
  const user=await getUser();if(!user)return new Response(null,{status:401,headers});
  if(req.headers.get('origin')!==new URL(req.url).origin||await isBanned(user.id))return new Response(null,{status:403,headers});
  const body=await req.json();
  if(req.method==='DELETE'){
   await db.delete(accountRecords).where(and(eq(accountRecords.userId,user.id),eq(accountRecords.key,'highlight:'+String(body.id))));
  }else if(req.method==='POST'){
   const title=String(body.title||'').trim().slice(0,40),storyId=String(body.storyId||'');
   const [story]=await db.select().from(accountRecords).where(and(eq(accountRecords.userId,user.id),eq(accountRecords.key,'story:'+storyId)));
   if(!title||!story)return new Response(null,{status:400,headers});
   await db.insert(accountRecords).values({userId:user.id,key:'highlight:'+crypto.randomUUID(),value:{title,storyId,createdAt:Date.now()}});
  }else return new Response(null,{status:405,headers});
  return Response.json({ok:true},{headers});
 }catch{return Response.json({error:'Highlights unavailable. Please retry.'},{status:503,headers})}
};
