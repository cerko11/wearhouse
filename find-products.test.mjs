import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

async function search({ user={id:'member'}, body={query:'linen shirt'}, rows=[], sources=[], fail=false }={}) {
  const source=readFileSync(new URL('../netlify/functions/find-products.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
  class GoogleGenAI { models={ generateContent:async()=>{if(fail)throw Error('Private provider error');return {text:JSON.stringify({results:rows,summary:'Matches'}),candidates:[{groundingMetadata:{groundingChunks:sources.map(uri=>({web:{uri}}))}}]}} }; }
  const context=vm.createContext({isBanned:async()=>false,Request,Response,URL,Set,Promise,AbortSignal,getUser:async()=>user,GoogleGenAI});
  vm.runInContext(stripTypeScriptTypes(source),context);
  context.request=new Request('https://wearhouse.test/.netlify/functions/find-products',{method:'POST',body:JSON.stringify(body)});
  return vm.runInContext('handler(request)',context);
}
test('product search requires authentication and validates photo content',async()=>{
  assert.equal((await search({user:null})).status,401);
  assert.equal((await search({body:{image:'data:text/html;base64,YQ=='}})).status,400);
});
test('only exact grounded HTTPS product URLs survive, including same-host fabricated URLs',async()=>{
  const rows=[
    {url:'https://www.asos.com/brand/linen/prd/123',title:'Linen',amount:42,currency:'USD',match:'exact'},
    {url:'https://www.asos.com/brand/invented/prd/456'},
    {url:'https://store.example/'},
    {url:'https://store.example/search?q=linen'},
    {url:'http://store.example/products/unsafe'},
  ];
  const response=await search({rows,sources:rows.filter((_,i)=>i!==1).map(x=>x.url)});
  const data=await response.json();assert.equal(data.results.length,1);
  assert.equal(data.results[0].url,rows[0].url);assert.equal(data.results[0].price.amount,42);
});
test('missing prices stay unknown and provider failures return useful non-sensitive errors',async()=>{
  const response=await search({rows:[{url:'https://www.asos.com/brand/shirt/prd/1'}],sources:['https://www.asos.com/brand/shirt/prd/1']});
  assert.equal((await response.json()).results[0].price,null);
  const failed=await search({fail:true});assert.equal(failed.status,502);
  assert.doesNotMatch(JSON.stringify(await failed.json()),/Private provider error/);
});
test('retailer policy rejects unknown, lookalike, redirect and non-product URLs and fixes merchant identity',async()=>{
  const urls=['https://unknown.example/products/1','https://www.asos.com.evil.test/brand/shirt/prd/1','https://outlet.asos.com/brand/shirt/prd/1','https://www.asos.com/brand/shirt/prd/1?redirect=https://evil.test','https://www.nike.com/w/mens-shirts','https://www.asos.com/brand/shirt/prd/1'];
  const response=await search({rows:urls.map(url=>({url,store:'Impersonated merchant'})),sources:urls});
  const {results}=await response.json();assert.equal(results.length,1);assert.equal(results[0].site,'ASOS');assert.equal(results[0].trusted,true);
});
test('exact matching offers sort by lowest known price per currency before similar and unknown offers',async()=>{
  const rows=[
    {amount:80,currency:'USD',match:'exact'},
    {amount:10,currency:'USD',match:'similar'},
    {amount:35,currency:'USD',match:'exact'},
    {amount:null,currency:'USD',match:'exact'},
    {amount:20,currency:'GBP',match:'exact'}
  ].map((r,i)=>({...r,url:`https://www.asos.com/brand/shirt/prd/${i+1}`}));
  const {results}=await (await search({rows,sources:rows.map(r=>r.url)})).json();
  assert.deepEqual(results.map(r=>r.price?.amount??null),[20,35,80,null,10]);
});
