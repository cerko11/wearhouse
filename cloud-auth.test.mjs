import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

function endpoint(name,user){
  const source=readFileSync(new URL('../netlify/functions/'+name+'.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
  const context=vm.createContext({isBanned:async()=>false,Request,Response,URL,getUser:async()=>user,getStore:()=>({}),drizzle:()=>({})});
  vm.runInContext(stripTypeScriptTypes(source),context);
  return request=>{context.request=request;return vm.runInContext('handler(request)',context)};
}
for(const name of ['wardrobe','photo']){
  test(name+' rejects unauthenticated requests',async()=>{
    const response=await endpoint(name,null)(new Request('https://wearhouse.test/.netlify/functions/'+name));assert.equal(response.status,401);
  });
  test(name+' rejects a different account owner',async()=>{
    const response=await endpoint(name,{id:'a'})(new Request('https://wearhouse.test/.netlify/functions/'+name+'?owner=b'));assert.equal(response.status,403);
  });
  test(name+' rejects writes from another origin',async()=>{
    const response=await endpoint(name,{id:'a'})(new Request('https://wearhouse.test/.netlify/functions/'+name+'?owner=a&key='+'a'.repeat(64),{method:name==='photo'?'PUT':'POST',headers:{Origin:'https://other.test'},body:'{}'}));assert.equal(response.status,403);
  });
}
test('wardrobe rejects credential records',async()=>{
  const response=await endpoint('wardrobe',{id:'a'})(new Request('https://wearhouse.test/.netlify/functions/wardrobe?owner=a',{method:'POST',headers:{Origin:'https://wearhouse.test'},body:JSON.stringify({key:'password',value:'invalid'})}));assert.equal(response.status,400);
});
