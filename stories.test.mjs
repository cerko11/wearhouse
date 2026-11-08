import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../netlify/functions/stories.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
function setup(user=null,rows=[]){
  const mutations=[];
  const context=vm.createContext({ Request,Response,URL,Buffer,crypto:{randomUUID:()=> 'story-id'},getUser:async()=>user,isBanned:async id=>id==='banned',isAdminEmail:e=>e==='cerko11real@gmail.com',getStore:()=>({set:async(...a)=>mutations.push(['image',...a]),get:async()=>new ArrayBuffer(2),delete:async()=>mutations.push(['delete-image'])}),drizzle:()=>({select:()=>({from:()=>({where:async()=>rows})}),insert:()=>({values:async v=>mutations.push(['insert',v])}),delete:()=>({where:async()=>mutations.push(['delete'])})}),and:()=>{},eq:()=>{},like:()=>{},accountRecords:{}});
  vm.runInContext(stripTypeScriptTypes(source),context);
  return {mutations,run:async(method='GET',body,query='')=>{context.req=new Request('https://wearhouse.test/.netlify/functions/stories'+query,{method,headers:{Origin:'https://wearhouse.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return vm.runInContext('handler(req)',context)}};
}
test('global story listing is public and excludes banned accounts',async()=>{
  const h=setup(null,[{userId:'a',key:'story:one',value:{username:'ari',caption:'Linen',createdAt:1}},{userId:'banned',key:'story:two',value:{createdAt:2}}]);
  const response=await h.run();assert.equal(response.status,200);const {stories}=await response.json();assert.equal(stories.length,1);assert.equal(stories[0].authorId,'a');assert.match(stories[0].image,/stories\?id=one/);
});
test('story writes require authentication',async()=>{for(const method of ['POST','DELETE'])assert.equal((await setup().run(method)).status,401)});
test('members cannot delete another account story',async()=>{
  const h=setup({id:'b',email:'b@example.com'},[{userId:'a',key:'story:one'}]);assert.equal((await h.run('DELETE',null,'?id=one')).status,403);assert.equal(h.mutations.length,0);
});
test('owners and designated admin can delete stories',async()=>{
  for(const user of [{id:'a'},{id:'admin',email:'cerko11real@gmail.com'}]){const h=setup(user,[{userId:'a',key:'story:one'}]);assert.equal((await h.run('DELETE',null,'?id=one')).status,200);assert.equal(h.mutations.length,2)}
});
test('story publishing validates image and derives author from session',async()=>{
  const h=setup({id:'a'});assert.equal((await h.run('POST',{image:'javascript:alert(1)'})).status,400);
  assert.equal((await h.run('POST',{image:'data:image/jpeg;base64,YQ==',caption:'A look',authorId:'forged'})).status,201);
  const record=h.mutations.find(x=>x[0]==='insert')[1];assert.equal(record.userId,'a');assert.equal(record.key,'story:story-id');assert.equal(record.value.caption,'A look');
});
