import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('message shares render same-origin content actions and escape untrusted text',()=>{
  const source=html.slice(html.indexOf('function renderMessageText('),html.indexOf('function openSharedPost('));
  const ctx=vm.createContext({URL,URLSearchParams,location:{origin:'https://wearhouse.test'},esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(source,ctx);
  assert.match(vm.runInContext("renderMessageText('Shared https://wearhouse.test/#post=look')",ctx),/data-social="shared-post" data-id="look"/);
  assert.match(vm.runInContext("renderMessageText('https://wearhouse.test/#story=one')",ctx),/data-social="shared-story"/);
  assert.doesNotMatch(vm.runInContext("renderMessageText('https://other.test/#post=look')",ctx),/button/);
  assert.equal(vm.runInContext("renderMessageText('<img onerror=evil()>')",ctx),'&lt;img onerror=evil()>');
});
test('opening a blocked or unavailable shared post keeps the current view',()=>{
  const source=html.slice(html.indexOf('function openSharedPost('),html.indexOf('function openPostFromHash('));
  const messages=[];
  const ctx=vm.createContext({state:{posts:[{id:'hidden',authorId:'blocked'}]},isBlocked:()=>true,toast:s=>messages.push(s)});
  vm.runInContext(source,ctx);
  vm.runInContext("openSharedPost('hidden');openSharedPost('deleted')",ctx);
  assert.equal(messages.length,2);
  assert.ok(messages.every(s=>s==='This post is no longer available.'));
});
