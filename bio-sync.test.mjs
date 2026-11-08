import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf("const PUBLIC_MEMBERS_CACHE="),html.indexOf('setInterval(refreshPublicBios'));
function setup(){
 const cache={records:{userProfile:{bio:'old'}},pending:{}};
 const node={dataset:{bioOwner:'other'},innerHTML:'old'};
 const store=new Map();
 const context=vm.createContext({state:{currentUser:{id:'self'},isAuthenticated:true,userProfile:{bio:'mine'}},communityMembers:[],document:{hidden:false,querySelectorAll:selector=>selector==='[data-bio-owner]'?[node]:[]},renderBio:s=>s||'',member:id=>context.communityMembers.find(m=>m.id===id)||{},readCache:()=>cache,writeCache:()=>{},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},api:async()=>({members:[]})});
 vm.runInContext(source,context);
 return {context,cache,node,store};
}
test('public updates replace visible bios, including clearing text and cached member records',()=>{
 const {context,node,store}=setup();
 vm.runInContext("publishPublicMembers([{id:'other',bio:'With @cerko'}])",context);
 assert.equal(node.innerHTML,'With @cerko');
 vm.runInContext("publishPublicMembers([{id:'other',bio:''}])",context);
 assert.equal(node.innerHTML,'');
 assert.equal(context.communityMembers[0].bio,'');
 assert.equal(store.has('wearhouse_all_users'),false);
 assert.equal(store.has('wearhouse_current_user'),false);
});
test('public directory updates preserve unsent own bio edits',()=>{
 const {context,cache}=setup();cache.pending.userProfile={bio:'mine'};
 vm.runInContext("publishPublicMembers([{id:'self',bio:'outdated'}])",context);
 assert.equal(context.state.userProfile.bio,'mine');
 delete cache.pending.userProfile;
 vm.runInContext("publishPublicMembers([{id:'self',bio:'another device'}])",context);
 assert.equal(context.state.userProfile.bio,'another device');
 assert.equal(cache.records.userProfile.bio,'another device');
});
test('an in-flight directory response cannot restore an older bio after a newer local publication',async()=>{
 const {context,node}=setup();let resolve;
 context.api=()=>new Promise(r=>{resolve=r});
 const pending=vm.runInContext('refreshPublicBios()',context);
 vm.runInContext("publishPublicMembers([{id:'other',bio:'new'}])",context);
 resolve({members:[{id:'other',bio:'old'}]});await pending;
 assert.equal(node.innerHTML,'new');
});
test('directory publication synchronizes all public profile fields and the current session',()=>{
 const {context,cache,store}=setup();
 vm.runInContext("publishPublicMembers([{id:'self',name:'Updated',username:'new_handle',bio:'New bio',avatar:'',verified:true}])",context);
 const session=context.state.currentUser;
 assert.equal(session.name,'Updated');assert.equal(session.username,'new_handle');
 assert.equal(session.bio,'New bio');assert.equal(session.avatar,'');assert.equal(session.verified,true);
 assert.equal(cache.records.userProfile.username,'new_handle');
 assert.equal(context.communityMembers[0].name,'Updated');
});
test('public avatar URLs preserve a cached private image for subsequent profile saves',()=>{
 const {context,cache}=setup();cache.images={abc:'data:image/png;base64,YQ=='};
 vm.runInContext("publishPublicMembers([{id:'self',avatar:'/.netlify/functions/community-photo?profile=1&key=abc'}])",context);
 assert.equal(context.state.userProfile.avatar,'data:image/png;base64,YQ==');
 assert.equal(cache.records.userProfile.avatar,'data:image/png;base64,YQ==');
});
test('a directory refresh cannot publish an older bio or avatar over queued edits',()=>{
 const {context,cache,store}=setup();
 cache.pending.userProfile={bio:'',avatar:'',username:'updated'};
 vm.runInContext("publishPublicMembers([{id:'self',bio:'old bio',avatar:'old photo',username:'old',verified:true},{id:'other',bio:'remote update'}])",context);
 const directory=context.communityMembers;
 const own=directory.find(m=>m.id==='self');
 assert.equal(own.bio,'');assert.equal(own.avatar,'');assert.equal(own.username,'updated');
 assert.equal(own.verified,true);
 assert.equal(directory.find(m=>m.id==='other').bio,'remote update');
});
test('every member lookup reads the shared array for both self and other profiles',()=>{
 const {context,store}=setup();
 context.safeParse=(key,fallback)=>store.has(key)?JSON.parse(store.get(key)):fallback;
 const lookup=html.slice(html.indexOf('function members(){'),html.indexOf('function renderBio('));
 vm.runInContext(lookup,context);
 context.communityMembers=[{id:'self',bio:'live self',avatar:''},{id:'other',bio:'live other'}];
 assert.equal(vm.runInContext("members().find(m=>m.id==='self').bio",context),'live self');
 context.communityMembers=[{id:'self',bio:''},{id:'other',bio:'changed'}];
 assert.equal(vm.runInContext("members().find(m=>m.id==='self').bio",context),'');
 assert.equal(vm.runInContext("members().find(m=>m.id==='other').bio",context),'changed');
});

test('legacy local directories cannot override cloud profiles',()=>{
 const {context,store}=setup();
 context.safeParse=(key,fallback)=>store.has(key)?JSON.parse(store.get(key)):fallback;
 vm.runInContext(html.slice(html.indexOf('function members(){'),html.indexOf('function renderBio(')),context);
 store.set('wearhouse_users',JSON.stringify([{id:'other',bio:'legacy'}]));
 context.communityMembers=[{id:'other',bio:'cloud'}];
 assert.equal(vm.runInContext("members()[0].bio",context),'cloud');
 store.set('wearhouse_all_users',JSON.stringify([{id:'other',bio:'current'}]));
 assert.equal(vm.runInContext("members()[0].bio",context),'cloud');
});
test('avatar updates and removal reach open dialogs without replacing their content',()=>{
 const {context}=setup();
 const avatar={dataset:{avatarOwner:'other'},innerHTML:'old photo'};
 context.document.querySelectorAll=selector=>selector==='[data-avatar-owner]'?[avatar]:[];
 context.avatarImageMarkup=p=>p.avatar||'initial';
 context.modalRoot={innerHTML:'draft stays open'};
 context.render=()=>assert.fail('must not replace an open dialog');
 vm.runInContext("publishPublicMembers([{id:'other',avatar:'new photo'}])",context);
 assert.equal(avatar.innerHTML,'new photo');
 vm.runInContext("publishPublicMembers([{id:'other',avatar:''}])",context);
 assert.equal(avatar.innerHTML,'initial');
 assert.equal(context.modalRoot.innerHTML,'draft stays open');
});

test('live names and handles refresh during an open editor without replacing drafts',()=>{
 const {context}=setup();
 const name={dataset:{profileOwner:'other',profileField:'name'},textContent:'Old name'};
 const handle={dataset:{profileOwner:'other',profileField:'username'},textContent:'old_handle'};
 context.document.querySelectorAll=selector=>selector==='[data-profile-owner]'?[name,handle]:[];
 context.modalRoot={innerHTML:'unsent editor contents'};
 context.render=()=>assert.fail('must preserve the editor');
 vm.runInContext("publishPublicMembers([{id:'other',name:'New name',username:'new_handle'}])",context);
 assert.equal(name.textContent,'New name');
 assert.equal(handle.textContent,'new_handle');
 assert.equal(context.modalRoot.innerHTML,'unsent editor contents');
});

test('queued aesthetic changes reach the registry and remain authoritative during refresh',()=>{
 const {context,cache,store}=setup();
 cache.pending.userProfile={aesthetic:'Minimalist'};
 vm.runInContext("publishPublicMembers([{id:'self',aesthetic:'Vintage',verified:true}])",context);
 const own=context.communityMembers[0];
 assert.equal(own.aesthetic,'Minimalist');
 assert.equal(own.verified,true);
 delete cache.pending.userProfile;
 vm.runInContext("publishPublicMembers([{id:'self',aesthetic:'Streetwear'}])",context);
 assert.equal(context.state.userProfile.aesthetic,'Streetwear');
});

test('profile text renders current registry values and escapes markup',()=>{
 const {context}=setup();
 context.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 context.communityMembers=[{id:'other',username:'updated_handle',name:'<New name>'}];
 assert.match(vm.runInContext("profileText('other','username','historical_handle')",context),/>updated_handle<\/span>/);
 assert.match(vm.runInContext("profileText('other','name','Historical name')",context),/>&lt;New name><\/span>/);
});
