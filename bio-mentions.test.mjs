import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function renderBio('),html.indexOf('function member(id)'));
function setup(directory=[]){
  const calls=[];
  const context=vm.createContext({
    esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    state:{currentUser:{id:'self'}},members:()=>directory,
    publishPublicMembers:()=>{},api:async()=>({members:[]}),toast:s=>calls.push(s),
    closeModal:()=>{},setTab:s=>calls.push(s),loadPublicWardrobe:id=>calls.push(id),
    refreshPublicBios:async()=>{},persist:()=>{},render:()=>{},window:{scrollTo:()=>{}}
  });
  vm.runInContext(source,context);
  return {context,calls};
}
test('bios link multiple handles while escaping markup and preserving text',()=>{
  const {context}=setup();
  const result=vm.runInContext('renderBio("<img src=x onerror=alert(1)>\\nWith @cerko, @alex and @a.b_c.")',context);
  assert.match(result,/&lt;img/);assert.doesNotMatch(result,/<img/);
  assert.equal((result.match(/class="bio-mention"/g)||[]).length,3);
  assert.match(result,/data-username="a.b_c"/);
  assert.match(result,/<\/button>\.$/);
  assert.match(result,/type="button"/);
});
test('emails, URL paths, and overlength usernames remain plain text',()=>{
  const {context}=setup();
  for(const bio of ['alex@example.com','https://example.com/@alex','@@alex','@'+'a'.repeat(31)]){
    context.bio=bio;assert.doesNotMatch(vm.runInContext('renderBio(bio)',context),/bio-mention/);
  }
});
test('mentions navigate by account ID with case-insensitive matching and support self',async()=>{
  const {context,calls}=setup([{id:'cerko-id',username:'cerko'},{id:'self',username:'me'}]);
  await vm.runInContext('openBioMention("Cerko")',context);
  assert.equal(context.publicProfileId,'cerko-id');assert.ok(calls.includes('cerko-id'));
  await vm.runInContext('openBioMention("me")',context);assert.ok(calls.includes('profile'));
});
test('unknown mentions refresh the directory and report a missing user without navigation',async()=>{
  const {context,calls}=setup();
  await vm.runInContext('openBioMention("missing")',context);
  assert.deepEqual(calls,['User not found']);
});
test('directory failures give a retry message',async()=>{
  const {context,calls}=setup();context.api=async()=>{throw Error('offline')};
  await vm.runInContext('openBioMention("alex")',context);
  assert.deepEqual(calls,['Unable to load profile. Please try again.']);
});
