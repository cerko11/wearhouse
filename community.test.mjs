import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const adminSource=readFileSync(new URL('../netlify/functions/lib/admin.mts',import.meta.url),'utf8').replace(/export /g,'');
function feed(rows,user={id:'viewer'},accounts={}) {
  const source=readFileSync(new URL('../netlify/functions/community.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
  const context=vm.createContext({isBanned:async()=>false,Request,Response,URL,Map,getUser:async()=>user,admin:{getUser:async id=>accounts[id]||{id}},drizzle:()=>({select:()=>({from:()=>({where:async()=>rows})})}),or:()=>{},like:()=>{},eq:()=>{},accountRecords:{}});
  vm.runInContext(stripTypeScriptTypes(adminSource+"\n"+source),context);
  return vm.runInContext("handler(new Request('https://wearhouse.test/.netlify/functions/community'))",context);
}
test('shared feed includes all authors, aggregates likes, and excludes private profile fields',async()=>{
  const rows=[
    {userId:'a',key:'userProfile',value:{name:'Ari',username:'ari',email:'private@example.com',bio:'Style with @bea'}},
    {userId:'a',key:'posts:one',value:{caption:'Linen layers',createdAt:1,image:{__wearhouseImage:'a'.repeat(64)}}},
    {userId:'b',key:'posts:two',value:{caption:'Wool coat',createdAt:2}},
    {userId:'a',key:'posts:deleted',value:null},
    {userId:'viewer',key:'communityReactions',value:{'a:one':{liked:true,bookmarked:true}}},
    {userId:'b',key:'communityReactions',value:{'a:one':{liked:true}}}
  ];
  const response=await feed(rows),data=await response.json();
  assert.equal(data.members.find(m=>m.id==='a').bio,'Style with @bea');
  assert.equal(data.posts.length,2);assert.equal(data.posts[0].authorId,'b');
  const post=data.posts[1];assert.equal(post.authorName,'Ari');assert.equal(post.likes,2);assert.equal(post.bookmarked,true);
  assert.match(post.image,/community-photo\?owner=a&post=one/);
  assert.doesNotMatch(JSON.stringify(data),/private@example|userProfile/);
});
test('shared feed requires authentication',async()=>{assert.equal((await feed([],null)).status,401)});
test('complete HTML copies keep gallery selection and email privacy',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(html,readFileSync(new URL('../www/index.html',import.meta.url),'utf8'));
  assert.doesNotMatch(html, /\bcapture\s*=/i);
  for(const input of html.matchAll(/<input[^>]*type="file"[^>]*>/g))assert.match(input[0],/accept="image\/\*"/);
  assert.match(html,/emailVisible=false/);assert.match(html,/Email hidden/);
  assert.doesNotMatch(html,/target="_blank"/);
});

test('community comments use authenticated record owners and public usernames only',async()=>{
  const response=await feed([
    {userId:'a',key:'posts:one',value:{createdAt:1}},
    {userId:'viewer',key:'userProfile',value:{username:'linenlover',email:'secret@example.com'}},
    {userId:'viewer',key:'communityReactions',value:{'a:one':{comments:[{id:'c1',text:'Lovely layers',authorId:'forged',username:'forged',createdAt:5}]}}}
  ]);
  const {posts}=await response.json();
  assert.deepEqual(posts[0].comments,[{id:'viewer:c1',text:'Lovely layers',createdAt:5,authorId:'viewer',username:'linenlover'}]);
  assert.doesNotMatch(JSON.stringify(posts),/secret@example|forged/);
});

test('member directory exposes safe profiles and excludes blocked or self follows',async()=>{
  const data=await (await feed([
    {userId:'a',key:'userProfile',value:{username:'ari',email:'secret@example.com',following:['b','a','c','b'],wardrobePublic:true}},
    {userId:'b',key:'userProfile',value:{username:'bea',following:['a']}},
    {userId:'c',key:'userProfile',value:{username:'cam',blockedUsers:['a']}}
  ])).json();
  assert.deepEqual(data.members[0].following,['b']);
  assert.equal(data.members[0].wardrobePublic,true);
  assert.equal(data.members[1].wardrobePublic,false);
  assert.doesNotMatch(JSON.stringify(data),/secret@example|blockedUsers/);
});

async function wardrobe(rows, url='?member=a', user={id:'viewer'}) {
  const source=readFileSync(new URL('../netlify/functions/public-wardrobe.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
  let query=0,blobReads=0;
  const context=vm.createContext({isBanned:async()=>false,Request,Response,URL,Uint8Array,atob,getUser:async()=>user,getStore:()=>({get:async()=>{blobReads++;return 'data:image/png;base64,YQ=='}}),drizzle:()=>({select:()=>({from:()=>({where:async()=>rows[query++]||[]})})}),and:()=>{},or:()=>{},like:()=>{},eq:()=>{},accountRecords:{}});
  vm.runInContext(stripTypeScriptTypes(adminSource+"\n"+source),context);
  const response=await vm.runInContext(`handler(new Request('https://wearhouse.test/.netlify/functions/public-wardrobe${url}'))`,context);
  return {response,blobReads};
}
test('private wardrobes and images cannot be retrieved by another account',async()=>{
  for(const value of [{}, {wardrobePublic:false}, {wardrobePublic:true,blockedUsers:['viewer']}]) {
    const result=await wardrobe([[{userId:'a',value}]],'?member=a&key='+'a'.repeat(64));
    assert.equal(result.response.status,403);assert.equal(result.blobReads,0);
  }
});
test('public wardrobe returns clothing fields only and checks image membership',async()=>{
  const profiles=[{userId:'a',value:{wardrobePublic:true}}];
  const items=[{key:'wardrobe:coat',value:{name:'Wool coat',privateNote:'secret',photo:{__wearhouseImage:'a'.repeat(64)}}}];
  const {response}=await wardrobe([profiles,items]);
  const data=await response.json();assert.equal(data.items[0].name,'Wool coat');assert.doesNotMatch(JSON.stringify(data),/privateNote|secret/);
  assert.match(data.items[0].photo,/public-wardrobe/);
  const denied=await wardrobe([profiles,items],'?member=a&key='+'b'.repeat(64));assert.equal(denied.response.status,404);assert.equal(denied.blobReads,0);
  const allowed=await wardrobe([profiles,items],'?member=a&key='+'a'.repeat(64));assert.equal(allowed.response.status,200);assert.equal(allowed.blobReads,1);
});

test('member directory publishes avatars without private profile fields',async()=>{
  const response=await feed([{userId:'a',key:'userProfile',value:{name:'Mara',avatar:{__wearhouseImage:'a'.repeat(64)},email:'private@example.com'}}]);
  const data=await response.json();
  assert.match(data.members[0].avatar,/community-photo\?owner=a&profile=1&key=a{64}$/);
  assert.doesNotMatch(JSON.stringify(data),/private@example/);
});

test('public avatar reads require authentication and only serve the current profile image',async()=>{
  const source=readFileSync(new URL('../netlify/functions/community-photo.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
  let viewer={id:'viewer'},reads=0;
  const context=vm.createContext({isBanned:async()=>false,Request,Response,URL,Uint8Array,atob,getUser:async()=>viewer,getStore:()=>({get:async()=>{reads++;return 'data:image/png;base64,YQ=='}}),drizzle:()=>({select:()=>({from:()=>({where:async()=>[{value:{avatar:{__wearhouseImage:'a'.repeat(64)}}}]})})}),and:()=>{},eq:()=>{},accountRecords:{}});
  vm.runInContext(stripTypeScriptTypes(adminSource+"\n"+source),context);
  const request=key=>vm.runInContext(`handler(new Request('https://wearhouse.test/.netlify/functions/community-photo?owner=a&profile=1&key=${key}'))`,context);
  assert.equal((await request('a'.repeat(64))).status,200);
  assert.equal((await request('b'.repeat(64))).status,404);
  assert.equal(reads,1);
  viewer=null;
  assert.equal((await request('a'.repeat(64))).status,401);
});

test('moderation hides suspended accounts, deleted posts and deleted comments; verification is server controlled',async()=>{
  const data=await (await feed([
    {userId:'a',key:'userProfile',value:{username:'ari',verified:true}},
    {userId:'b',key:'userProfile',value:{username:'bea'}},
    {userId:'a',key:'posts:one',value:{createdAt:1}},
    {userId:'a',key:'posts:gone',value:{createdAt:2}},
    {userId:'b',key:'posts:hidden',value:{createdAt:3}},
    {userId:'a',key:'moderation:post:gone',value:true},
    {userId:'b',key:'moderation:account',value:{banned:true}},
    {userId:'viewer',key:'communityReactions',value:{'a:one':{comments:[{id:'c',text:'Removed'}]}}},
    {userId:'a',key:'moderation:comment:one:viewer:c',value:true}
  ])).json();
  assert.equal(data.posts.length,1);assert.equal(data.posts[0].comments.length,0);
  assert.equal(data.members.length,1);assert.equal(data.members[0].verified,false);
  assert.deepEqual(data.removedComments,['a:one:viewer:c']);
  assert.equal(data.admin,false);
  const verified=await (await feed([{userId:'a',key:'userProfile',value:{}},{userId:'a',key:'moderation:account',value:{verified:true}}],{id:'viewer',email:'cerko11real@gmail.com'})).json();
  assert.equal(verified.members[0].verified,true);assert.equal(verified.admin,true);
});
test('suspended sessions cannot read community with an existing token',async()=>{
  assert.equal((await feed([{userId:'viewer',key:'moderation:account',value:{banned:true}}])).status,403);
});

async function moderation(body,user={id:'viewer'},origin='https://wearhouse.test'){
 const writes=[];
 const source=readFileSync(new URL('../netlify/functions/moderation.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
 const context=vm.createContext({Request,Response,URL,Date,getUser:async()=>user,isBanned:async()=>false,admin:{deleteUser:async()=>{}},drizzle:()=>({insert:()=>({values:row=>({onConflictDoUpdate:async()=>writes.push(row)})}),select:()=>({from:()=>({where:async()=>[]})})}),and:()=>{},eq:()=>{},accountRecords:{}});
 vm.runInContext(stripTypeScriptTypes(adminSource+"\n"+source),context);
 context.request=new Request('https://wearhouse.test/.netlify/functions/moderation',{method:'POST',headers:{origin},body:JSON.stringify(body)});
 return {response:await vm.runInContext('handler(request)',context),writes};
}
test('moderation denies forged privileges, cross-origin writes and self removal',async()=>{
 const body={action:'verify',owner:'other',verified:true};
 assert.equal((await moderation(body,{id:'viewer',userMetadata:{roles:['admin']}})).response.status,403);
 assert.equal((await moderation(body,{id:'viewer',email:'cerko11real@gmail.com'},'https://other.test')).response.status,403);
 assert.equal((await moderation({action:'ban',owner:'viewer'},{id:'viewer',email:'cerko11real@gmail.com'})).response.status,400);
});
test('admin verification persists separately and authors can only delete their own comments',async()=>{
 const result=await moderation({action:'verify',owner:'other',verified:true},{id:'viewer',email:'cerko11real@gmail.com'});
 assert.equal(result.response.status,200);assert.equal(result.writes[0].key,'moderation:account');assert.equal(result.writes[0].value.verified,true);
 assert.equal((await moderation({action:'delete-comment',owner:'other',post:'one',comment:'viewer:c'})).response.status,200);
 assert.equal((await moderation({action:'delete-comment',owner:'other',post:'one',comment:'other:c'})).response.status,403);
});

test('email allowlist ignores case and whitespace and rejects roles or profile email claims',async()=>{
 for(const email of ['cerko11real@gmail.com','  CERKO11REAL@GMAIL.COM  ']) {
  assert.equal((await (await feed([],{id:'viewer',email})).json()).admin,true);
 }
 for(const user of [{id:'viewer',appMetadata:{roles:['admin']}},{id:'viewer',email:'someone@example.com',role:'admin'},{id:'viewer',userMetadata:{email:'cerko11real@gmail.com'}},{id:'viewer',email:'cerko11real@gmail.com.attacker.test'}]) {
  assert.equal((await (await feed([],user)).json()).admin,false);
  assert.equal((await moderation({action:'verify',owner:'other',verified:true},user)).response.status,403);
 }
});
test('email administrator can delete any post, comment and account without Identity roles',async()=>{
 for(const body of [{action:'delete-post',owner:'other',post:'one'},{action:'delete-comment',owner:'other',post:'one',comment:'third:c'},{action:'delete-account',owner:'other'}]) {
  const result=await moderation(body,{id:'viewer',email:'CERKO11REAL@GMAIL.COM'});
  assert.equal(result.response.status,200);assert.ok(result.writes.length>0);
 }
});


test('automatic verification uses Identity email and retains admin grants for other members',async()=>{
  const rows=[
    {userId:'cerko-id',key:'userProfile',value:{username:'cerko'}},
    {userId:'fake',key:'userProfile',value:{username:'cerko',email:'cerko11real@gmail.com',verified:true}},
    {userId:'standard',key:'userProfile',value:{username:'standard'}},
    {userId:'granted',key:'userProfile',value:{username:'granted'}},
    {userId:'granted',key:'moderation:account',value:{verified:true}},
    {userId:'cerko-id',key:'moderation:account',value:{verified:false}}
  ];
  const data=await (await feed(rows,{id:'viewer'},{'cerko-id':{email:' CERKO11REAL@GMAIL.COM '},fake:{email:'other@example.com'}})).json();
  assert.deepEqual(data.members.map(m=>[m.id,m.verified]),[['cerko-id',true],['fake',false],['standard',false],['granted',true]]);
  assert.doesNotMatch(JSON.stringify(data),/gmail.com|other@example/);
  const self=await (await feed(rows,{id:'cerko-id',email:'cerko11real@gmail.com'})).json();
  assert.equal(self.members.find(m=>m.id==='cerko-id').verified,true);
  const changed=await (await feed(rows,{id:'viewer'},{'cerko-id':{email:'changed@example.com'}})).json();
  assert.equal(changed.members.find(m=>m.id==='cerko-id').verified,false);
});
