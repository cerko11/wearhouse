import { getUser } from '@netlify/identity';
import { drizzle } from 'drizzle-orm/netlify-db';
import { accountRecords } from '../../db/schema.js';
import { isBanned } from './lib/moderation.mjs';
export default async(req:Request)=>{
 const headers={'Cache-Control':'no-store'};
 try{
 const user=await getUser();if(!user)return new Response(null,{status:401,headers});
 if(req.method!=='GET')return new Response(null,{status:405,headers});
 if(await isBanned(user.id))return new Response(null,{status:403,headers});
 const rows=await drizzle().select().from(accountRecords),notifications=[];
 const ownStories=new Set(rows.filter(r=>r.userId===user.id&&r.key.startsWith('story:')).map(r=>r.key.slice(6)));
 const ownPosts=new Set(rows.filter(r=>r.userId===user.id&&r.key.startsWith('posts:')).map(r=>user.id+':'+r.key.slice(6)));
 for(const r of rows){
 if(r.userId===user.id||await isBanned(r.userId))continue;
 const profile=rows.find(p=>p.userId===r.userId&&p.key==='userProfile')?.value as any;
 const ownProfile=rows.find(p=>p.userId===user.id&&p.key==='userProfile')?.value as any;
 if(profile?.blockedUsers?.includes(user.id)||ownProfile?.blockedUsers?.includes(r.userId))continue;
 const add=(type:string,target:string,time=0)=>notifications.push({id:r.userId+':'+type+':'+target,actor:r.userId,username:profile?.username||'member',type,target,createdAt:time});
 const v=r.value as any;
 if(r.key==='userProfile'&&v.following?.includes(user.id))add('follow',user.id);
 if(r.key==='communityReactions')for(const key of ownPosts)if(v[key]?.liked)add('post-like',key);
 if(r.key.startsWith('story-like:')&&ownStories.has(r.key.slice(11))&&v)add('story-like',r.key.slice(11));
 if(r.key.startsWith('story-share:')&&ownStories.has(r.key.slice(12)))add('story-share',r.key.slice(12),v.createdAt);
 if(r.key.startsWith('message:')&&v.recipient===user.id&&ownStories.has(v.storyId))add('story-comment',r.key.slice(8),v.createdAt);
 }
 return Response.json({notifications:notifications.slice(-200)},{headers});
 }catch{return Response.json({error:'Notifications unavailable'},{status:503,headers})}
};
