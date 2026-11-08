import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
  .replace(/import \* as identity from "[^"]+";/,'').replace('render();bootCloud();','').replace("(()=>{'use strict';",'').replace(/\}\)\(\);\s*$/,'');
function device(remote,user={id:'account-a',email:'a@example.com',emailVerified:true}) {
  const storage=new Map(),elements=new Map();let fail=false;
  const element=()=>({innerHTML:'',textContent:'',style:{},querySelector:()=>null});
  const context=vm.createContext({console,TextEncoder,Uint8Array,crypto:webcrypto,URL,FormData,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    navigator:{onLine:true},location:{protocol:'https:'},document:{hidden:false,activeElement:null,body:{style:{}},
      querySelectorAll:()=>[],querySelector:k=>{if(!elements.has(k))elements.set(k,element());return elements.get(k)},addEventListener:()=>{},documentElement:{dataset:{}}},
    window:{addEventListener:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,
    identity:{refreshSession:async()=>null,onAuthChange:()=>{}},
    fetch:async(path,options)=>{
      if(fail)throw Error('Network failed');
      const url=new URL(path,'https://wearhouse.test');
      const owner=url.searchParams.get('owner');
      assert.equal(owner,user.id);
      remote[owner]??={records:{},photos:{}};
      const data=remote[owner];
      if(url.pathname.endsWith('/photo')){
        const key=url.searchParams.get('key');
        if(options.method==='PUT')data.photos[key]=options.body;
        return {ok:true,json:async()=>({data:data.photos[key]})};
      }
      if(url.pathname.endsWith('/profiles'))return {ok:true,json:async()=>({members:Object.entries(remote).filter(([,v])=>v.records.userProfile).map(([id,v])=>({...structuredClone(v.records.userProfile),id,avatar:v.records.userProfile.avatar?.__wearhouseImage?'/.netlify/functions/community-photo?owner='+id+'&profile=1&key='+v.records.userProfile.avatar.__wearhouseImage:v.records.userProfile.avatar||''}))})};
      if(options.method==='POST'){const {key,value,patch}=JSON.parse(options.body);data.records[key]=structuredClone(patch&&data.records[key]?{...data.records[key],...patch}:value);return {ok:true,json:async()=>({ok:true})}}
      return {ok:true,json:async()=>({records:structuredClone(data.records)})};
    }});
  vm.runInContext(source,context);vm.runInContext('render=()=>{}',context);
  return {run:code=>vm.runInContext(code,context),login:()=>{context.testUser=user;return vm.runInContext('enterCloud(testUser)',context)},offline:()=>vm.runInContext('navigator.onLine=false',context),online:()=>vm.runInContext('navigator.onLine=true',context),fail:value=>fail=value};
}

test('two devices merge independent wardrobe edits and propagate deletion and saved outfits',async()=>{
  const remote={},phone=device(remote),desktop=device(remote);await phone.login();await desktop.login();
  phone.run("state.wardrobe.push({id:'shirt',name:'Shirt'});persist()");
  desktop.run("state.wardrobe.push({id:'shoes',name:'Shoes'});persist()");
  await phone.run('syncCloud()');await desktop.run('syncCloud()');await phone.run('syncCloud()');
  assert.equal(phone.run('state.wardrobe.length'),2);assert.equal(desktop.run('state.wardrobe.length'),2);
  phone.run("state.wardrobe=state.wardrobe.filter(i=>i.id!=='shirt');state.savedOutfits.push({id:'look',pieces:['shoes']});persist()");
  await phone.run('syncCloud()');await desktop.run('syncCloud()');
  assert.equal(desktop.run('state.wardrobe[0].id'),'shoes');assert.equal(desktop.run('state.savedOutfits[0].id'),'look');
});

test('offline edits and failed uploads remain queued and retry after reconnect',async()=>{
  const remote={},phone=device(remote);await phone.login();phone.offline();
  phone.run("state.wardrobe.push({id:'coat',name:'Coat'});persist()");await phone.run('syncCloud()');
  assert.equal(phone.run('Object.keys(readCache(testUser.id).pending).length')>0,true);
  phone.online();phone.fail(true);await phone.run('syncCloud()');
  assert.equal(phone.run('Object.keys(readCache(testUser.id).pending).length')>0,true);
  phone.fail(false);await phone.run('syncCloud()');assert.equal(remote['account-a'].records['wardrobe:coat'].name,'Coat');
  assert.equal(phone.run('Object.keys(readCache(testUser.id).pending).length'),0);
});

test('photos round-trip through private object storage and stay available in the offline cache',async()=>{
  const remote={},phone=device(remote),desktop=device(remote);await phone.login();
  phone.run("state.wardrobe.push({id:'photo',name:'Photo',photo:'data:image/jpeg;base64,YQ=='});persist()");await phone.run('syncCloud()');
  assert.ok(remote['account-a'].records['wardrobe:photo'].photo.__wearhouseImage);
  await desktop.login();assert.equal(desktop.run('state.wardrobe[0].photo'),'data:image/jpeg;base64,YQ==');
  desktop.offline();assert.equal(desktop.run("readCache(testUser.id).records['wardrobe:photo'].photo"),'data:image/jpeg;base64,YQ==');
});

test('different cloud accounts never share wardrobe records',async()=>{
  const remote={},a=device(remote),b=device(remote,{id:'account-b',email:'b@example.com',emailVerified:true});await a.login();
  a.run("state.wardrobe.push({id:'private',name:'Private'});persist()");await a.run('syncCloud()');await b.login();
  assert.equal(b.run('state.wardrobe.length'),0);
});


test('only owners see deletion controls, and cancellation or a forged confirmation preserves posts',async()=>{
  const phone=device({});await phone.login();
  phone.run("state.posts=[{id:'mine',authorId:testUser.id,caption:'My look'},{id:'other',authorId:'other-user',caption:'Another look'}];persist()");
  assert.match(phone.run('postCard(state.posts[0])'),/data-action="delete-post"/);
  assert.doesNotMatch(phone.run('postCard(state.posts[1])'),/data-action="delete-post"/);
  phone.run("requestPostDeletion('other');confirmPostDeletion('other')");
  assert.equal(phone.run('state.posts.length'),2);
  phone.run("requestPostDeletion('mine');closeModal();confirmPostDeletion('mine')");
  assert.equal(phone.run('state.posts.length'),2);
  phone.run("requestPostDeletion('mine');state.currentUser={id:'other-user'};confirmPostDeletion('mine')");
  assert.equal(phone.run('state.posts.length'),2);
});

test('confirmed offline post deletion updates the cache immediately and stays deleted after sync and a fresh login',async()=>{
  const remote={},phone=device(remote),desktop=device(remote);await phone.login();
  phone.run("state.posts=[{id:'look',authorId:testUser.id,caption:'My look',bookmarked:true}];persist()");
  await phone.run('syncCloud()');await desktop.login();
  phone.offline();phone.run("requestPostDeletion('look');confirmPostDeletion('look')");
  assert.equal(phone.run('state.posts.length'),0);
  assert.equal(phone.run("readCache(testUser.id).pending['posts:look']"),null);
  assert.equal(phone.run("readCache(testUser.id).records['posts:look']"),undefined);
  phone.online();await phone.run('syncCloud()');await desktop.run('syncCloud()');
  assert.equal(desktop.run('state.posts.length'),0);
  const freshBrowser=device(remote);await freshBrowser.login();assert.equal(freshBrowser.run('state.posts.length'),0);
});

test('likes, comments, and blocks survive synchronization and fresh login',async()=>{
  const remote={},phone=device(remote);await phone.login();
  phone.run("state.communityReactions={'other:post':{liked:true,comments:[{id:'c',text:'A thoughtful look',createdAt:1}]}};state.userProfile.blockedUsers=['blocked'];persist()");
  await phone.run('syncCloud()');
  const desktop=device(remote);await desktop.login();
  assert.equal(desktop.run("state.communityReactions['other:post'].liked"),true);
  assert.equal(desktop.run("state.communityReactions['other:post'].comments[0].text"),'A thoughtful look');
  assert.equal(desktop.run("isBlocked('blocked')"),true);
  assert.equal(desktop.run("postCard({id:'hidden',authorId:'blocked'})"),'');
  assert.equal(desktop.run("commentsFor({id:'post',authorId:'other',comments:[{id:'account-a:c',authorId:'account-a',text:'A thoughtful look'}]}).length"),1);
});

test('image liking is idempotent and preserves comments and bookmarks',async()=>{
  const phone=device({});await phone.login();
  phone.run(`state.posts=[{id:'p',authorId:'other',likes:2}];state.communityReactions={'other:p':{comments:[{id:'c',text:'Hello'}],bookmarked:true}};
    document.createElement=()=>({setAttribute:()=>{},remove:()=>{}});
    globalThis.image={dataset:{postImage:'p',owner:'other'},querySelector:()=>null,append:()=>{},closest:()=>({querySelector:()=>({classList:{add:()=>{}},setAttribute:()=>{}})})};
    likeImage(image);likeImage(image);`);
  assert.equal(phone.run('state.posts[0].likes'),3);
  assert.equal(phone.run("state.communityReactions['other:p'].comments.length"),1);
  assert.equal(phone.run("state.communityReactions['other:p'].bookmarked"),true);
});

test('public profiles show only explicitly public wardrobe without edit controls',async()=>{
  const phone=device({});await phone.login();
  phone.run("publicProfileId='other';state.posts=[{id:'p',authorId:'other',authorName:'Mina',piecesSnapshot:[{name:'Shared linen',category:'top'}]}];state.wardrobe=[{id:'private',name:'Private coat'}]");
  phone.run("publicWardrobe={id:'other',status:'ready',items:[{name:'Public jacket',category:'outerwear'}]}");
  const view=phone.run('publicProfileView()');
  assert.match(view,/Public jacket/);assert.doesNotMatch(view,/Private coat|delete-item|edit-profile|delete-post/);
});

test('saved sessions preserve the last tab and refresh credentials before user lookup',async()=>{
  const phone=device({});await phone.login();
  phone.run(`state.activeTab='profile';persist();state.activeTab='home';state.currentUser=null;sessionUser=null;
    globalThis.authOrder=[];
    identity.handleAuthCallback=async()=>null;
    identity.refreshSession=async()=>{authOrder.push('refresh')};
    identity.getUser=async()=>{authOrder.push('user');return testUser};`);
  await phone.run('bootCloud()');
  assert.equal(phone.run('state.currentUser.id'),'account-a');
  assert.equal(phone.run('state.activeTab'),'profile');
  assert.equal(phone.run("authOrder.slice(0,2).join(',')"),'refresh,user');
  assert.equal(phone.run("JSON.parse(localStorage.getItem(CURRENT_USER)).id"),'account-a');
});

test('browser restart rehydrates Identity cookies from SDK storage without storing credentials in the profile marker',async()=>{
  const phone=device({});await phone.login();
  phone.run(`localStorage.setItem('gotrue.user',JSON.stringify({token:{access_token:'test-access',refresh_token:'test-refresh'}}));
    restoreIdentityCookies();`);
  assert.match(phone.run('document.cookie'),/^nf_refresh=test-refresh; Path=\/; SameSite=Lax; Secure$/);
  assert.doesNotMatch(phone.run('localStorage.getItem(CURRENT_USER)'),/token|password/);
});

test('offline logout clears active and legacy sessions even when remote logout fails',async()=>{
  const phone=device({});await phone.login();phone.offline();
  phone.run(`localStorage.setItem(LEGACY_SESSION,testUser.id);
    localStorage.setItem('gotrue.user','{}');
    identity.logout=async()=>{throw Error('Offline')};`);
  await assert.rejects(phone.run('logoutSession()'),/Offline/);
  for(const key of ['CURRENT_USER','SESSION','LEGACY_SESSION'])assert.equal(phone.run(`localStorage.getItem(${key})`),null);
  assert.equal(phone.run("localStorage.getItem('gotrue.user')"),null);
  assert.equal(phone.run('state.currentUser'),null);
  assert.equal(phone.run('state.isAuthenticated'),false);
  assert.equal(phone.run('sessionUser'),null);
});

test('invalidated sessions return to Welcome instead of trusting the cached profile',async()=>{
  const phone=device({});await phone.login();
  phone.run(`identity.handleAuthCallback=async()=>null;identity.getUser=async()=>null;`);
  await phone.run('bootCloud()');
  assert.equal(phone.run('state.currentUser'),null);
  assert.equal(phone.run('localStorage.getItem(CURRENT_USER)'),null);
});


test('followers and following derive from account relationships and privacy is cached',async()=>{
  const phone=device({});await phone.login();
  phone.run("communityMembers=[{id:'other',name:'Mina',username:'mina',following:['account-a']}];state.userProfile.following=['other'];state.userProfile.wardrobePublic=true;persist()");
  assert.equal(phone.run("connections('account-a','followers').length"),1);
  assert.equal(phone.run("connections('account-a','following').length"),1);
  assert.match(phone.run("socialStats('account-a')"),/Followers/);
  await phone.run('syncCloud()');
  assert.equal(phone.run('state.userProfile.wardrobePublic'),true);
});

test('Find uses the server product search and rejects insecure addresses',()=>{
  const app=device({});
  for(const url of ['javascript:alert(1)','http://store.example/item','https://user:password@store.example/item'])assert.equal(app.run('safeWebUrl('+JSON.stringify(url)+')'),'');
  assert.equal(app.run('safeWebUrl("https://store.example/products/linen")'),'https://store.example/products/linen');
  const view=app.run('findView()');
  assert.match(view,/Find matching products/);
  assert.doesNotMatch(view,/Find store sources|Optional API settings/);
  assert.match(html,/fetch\('\/\.netlify\/functions\/find-products'/);
});

test('Find preview retains source details and keeps safe product actions inside the overlay',()=>{
  const app=device({});
  app.run('openModal=(title,html)=>{globalThis.previewMarkup=html};loadStoreFrame=(url)=>{globalThis.frameUrl=url};modalRoot.querySelector=()=>({classList:{add:()=>{}}});state.findResults=[{url:"https://www.asos.com/brand/shirt/prd/123",snippet:"Verified source detail",price:{amount:42,currency:"USD"}}];openPreview("https://www.asos.com/brand/shirt/prd/123","Linen shirt")');
  const markup=app.run('previewMarkup');
  assert.match(markup,/← Back to WearHouse/);
  assert.match(markup,/Verified source detail/);
  assert.match(markup,/Save source/);
  assert.match(markup,/Load store page here/);
  assert.doesNotMatch(markup,/<iframe/);
  assert.match(markup,/View Safe Product Page/);
  assert.equal(app.run("frameUrl"),"https://www.asos.com/brand/shirt/prd/123");
  assert.doesNotMatch(markup,/target="_blank"|<a[^>]+href=/);
  assert.doesNotMatch(html,/window\.open\s*\(|allow-popups|allow-top-navigation/);
  assert.match(html,/sandbox="allow-forms allow-scripts allow-same-origin"/);
});

test('feed cards put author, image, actions, caption, and expanded comments in reading order',async()=>{
  const app=device({});await app.login();
  app.run('state.posts=[{id:"reading-order",authorId:state.currentUser.id,authorName:"Mara",image:"data:image/png;base64,AA==",caption:"Linen for the afternoon",comments:[]}];openComments.add("reading-order")');
  const card=app.run('postCard(state.posts[0])');
  const positions=['class="postHead row"','class="postImage"','class="postActions"','Linen for the afternoon','class="comments"'].map(text=>card.indexOf(text));
  assert.ok(positions.every((position,index)=>position>=0&&(index===0||position>positions[index-1])));
  assert.ok(card.indexOf('data-action="delete-post"')>positions[2]);
  assert.doesNotMatch(card,/data-action="block-user"/);
  app.run('state.posts[0].authorId="another-member"');
  const other=app.run('postCard(state.posts[0])');
  assert.doesNotMatch(other,/data-action="delete-post"/);
  assert.ok(other.indexOf('data-action="block-user"')>other.indexOf('class="postActions"'));
});

test('profile avatars survive cloud sync and fresh login without exposing arbitrary image URLs',async()=>{
  const remote={},phone=device(remote);await phone.login();
  phone.run(`globalThis.FileReader=class{readAsDataURL(){this.result='data:image/jpeg;base64,YQ==';this.onload()}};
    globalThis.Image=class{constructor(){this.width=640;this.height=480}async decode(){}};
    openModal=()=>{};
    document.querySelector('#avatarCropCanvas').getContext=()=>({clearRect(){},drawImage(){}});
    document.querySelector('#avatarCropCanvas').addEventListener=(name,fn)=>{globalThis.cropWheel=fn};
    document.querySelector('#avatarCropCanvas').getBoundingClientRect=()=>({left:0,top:0,width:320});
    document.querySelector('#avatarCropCanvas').setPointerCapture=()=>{};
    globalThis.cropExport=[];
    document.createElement=()=>({getContext:()=>({beginPath(){cropExport.push('begin')},arc(...args){cropExport.push(args)},clip(){cropExport.push('clip')},drawImage(){cropExport.push('draw')}}),toDataURL:type=>{cropExport.push(type);return 'data:image/png;base64,YQ=='}});

    document.querySelector('#avatarCropCanvas').toDataURL=()=>"data:image/jpeg;base64,YQ==";
  `);
  await phone.run('saveProfilePhoto({type:"image/jpeg",size:1024})');
  assert.equal(phone.run('state.userProfile.avatar'),'data:image/png;base64,YQ==');
  assert.equal(phone.run("communityMembers.find(m=>m.id===state.currentUser.id).avatar"),'data:image/png;base64,YQ==');
  assert.equal(phone.run("state.currentUser.avatar"),'data:image/png;base64,YQ==');
  phone.run('cropExport=[]');
  phone.run('avatarCrop.zoom=2;avatarCrop.x=9999;drawAvatarCrop()');
  assert.ok(phone.run('avatarCrop.x')<9999);
  phone.run('setAvatarZoom(99)');assert.equal(phone.run('avatarCrop.zoom'),4);
  phone.run('setAvatarZoom(-2)');assert.equal(phone.run('avatarCrop.zoom'),1);
  phone.run(`const c=document.querySelector('#avatarCropCanvas');
    c.onpointerdown({pointerId:1,pointerType:'touch',clientX:100,clientY:160,preventDefault(){}});
    c.onpointerdown({pointerId:2,pointerType:'touch',clientX:200,clientY:160,preventDefault(){}});
    c.onpointermove({pointerId:2,clientX:300,clientY:160});`);
  assert.equal(phone.run('avatarCrop.zoom'),2);
  phone.run('cropWheel({deltaY:-100,clientX:160,clientY:160,preventDefault(){}})');
  assert.ok(phone.run('avatarCrop.zoom')>2);
  phone.run('confirmAvatarCrop()');
  assert.equal(phone.run('cropExport[1].join(",")'),'160,160,160,0,'+Math.PI*2);
  assert.equal(phone.run('cropExport.slice(2).join(",")'),'clip,draw,image/png');
  assert.match(phone.run('avatarMarkup(state.userProfile)'),/<img/);
  await phone.run('syncCloud()');
  const desktop=device(remote);await desktop.login();
  assert.equal(desktop.run('state.userProfile.avatar'),'data:image/png;base64,YQ==');
  assert.doesNotMatch(desktop.run('avatarMarkup({avatar:"https://untrusted.example/photo",name:"Mara"})'),/<img/);
  assert.doesNotMatch(desktop.run('avatarMarkup({avatar:"data:image/svg+xml;base64,YQ==",name:"Mara"})'),/<img/);
  await desktop.run('saveProfilePhoto({type:"text/html",size:12})');
  assert.equal(desktop.run('state.userProfile.avatar'),'data:image/png;base64,YQ==');
  await phone.run('saveProfilePhoto({type:"image/jpeg",size:16*1024*1024})');
  assert.equal(phone.run('state.userProfile.avatar'),'data:image/png;base64,YQ==');
  phone.run(`globalThis.FileReader=class{readAsDataURL(){this.onerror()}};`);
  await phone.run('saveProfilePhoto({type:"image/jpeg",size:1024})');
  assert.equal(phone.run('state.userProfile.avatar'),'data:image/png;base64,YQ==');
  phone.run(`globalThis.FileReader=class{readAsDataURL(){globalThis.finishRead=()=>{this.result='data:image/jpeg;base64,Yg==';this.onload()}}};`);
  const oldAccountUpload=phone.run('saveProfilePhoto({type:"image/jpeg",size:1024})');
  phone.run(`state.currentUser={id:'different-account',cloud:true};state.userProfile.avatar='';finishRead();`);
  await oldAccountUpload;
  assert.equal(phone.run('state.userProfile.avatar'),'');
});

test('theme preference persists on the device through logout and toggles both directions',async()=>{
  const app=device({});await app.login();
  app.run('toggleTheme()');
  assert.equal(app.run('localStorage.getItem("wearhouse-theme")'),'dark');
  app.run('clearActiveSession()');
  assert.equal(app.run('applyTheme()'),'dark');
  app.run('toggleTheme()');
  assert.equal(app.run('applyTheme()'),'light');
});

test('main navigation has three destinations and the drawer holds secondary screens',()=>{
  const nav=html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]),['home','stylist','community']);
  const app=device({});
  app.run('openModal=(title,html)=>{globalThis.drawerMarkup=html};modalRoot.querySelector=()=>({classList:{add:()=>{}}});openDrawer()');
  assert.deepEqual([...app.run('drawerMarkup').matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]),['wardrobe','find','learn']);
  assert.match(html, /id="profileShortcut" data-tab="profile"/);
  assert.match(html,/role="menuitem" data-action="edit-profile">Edit Profile/);
  app.run("state.currentUser={id: 'account-a'}");
  const profile=app.run("profileView()");
  assert.doesNotMatch(profile,/profileTheme/);
  assert.equal((profile.match(/data-action="change-avatar"/g)||[]).length,1);
  assert.doesNotMatch(profile.slice(0,profile.indexOf('id="profileMenu"')),/data-action="change-avatar"/);
  assert.ok(profile.indexOf('class="avatar"')<profile.indexOf('id="accountSettings"'));
  for(const action of ['change-avatar','remove-avatar','edit-profile','logout'])assert.ok(profile.includes('data-action="'+action+'"'));
});

test('academy quiz advances beyond the third question and finishes at its dynamic length',()=>{
  const app=device({});
  app.run('openModal=(title,html)=>{globalThis.quizTitle=title;globalThis.quizMarkup=html};startQuiz()');
  assert.equal(app.run('lessons.length'),18);
  assert.equal(app.run('questions.length'),8);
  for(let i=0;i<8;i++){
    app.run('answerQuiz(questions[state.quiz.index].correct)');
    app.run('state.quiz.index++;state.quiz.answered=false;showQuestion()');
  }
  assert.equal(app.run('quizTitle'),'Quiz complete');
  assert.match(app.run('quizMarkup'),/8 \/ 8/);
});

test('Find ranks cheap comparable offers first and filters unsafe persisted results',()=>{
  const app=device({});
  app.run(`state.findResults=[
    {url:'https://www.asos.com/brand/shirt/prd/1',title:'Expensive',price:{amount:80,currency:'USD'},match:'exact'},
    {url:'https://www.asos.com/brand/shirt/prd/2',title:'Cheapest',price:{amount:30,currency:'USD'},match:'exact'},
    {url:'https://unknown.example/products/cheap',title:'Unsafe',price:{amount:1,currency:'USD'},match:'exact'},
    {url:'https://www.asos.com/brand/shirt/prd/3',title:'Unknown price',price:null,match:'exact'}
  ];`);
  const markup=app.run('renderFindResults()');
  assert.ok(markup.indexOf('Cheapest')<markup.indexOf('Expensive'));
  assert.doesNotMatch(markup,/Unsafe|unknown\.example/);
  assert.match(markup,/Lowest sourced price/);
  assert.equal(app.run('comparableCheapest(rankedFindResults(state.findResults)).price.amount'),30);
  app.run("state.findResults.push({url:'https://www.asos.com/brand/shirt/prd/4',price:{amount:10,currency:'GBP'},match:'exact'})");
  assert.equal(app.run('comparableCheapest(rankedFindResults(state.findResults))'),null);
  assert.match(app.run('renderFindResults()'),/currencies are not converted/);
});

test('admin email sets role on login and refresh and clears stale privileges',async()=>{
 const d=device({}, {id:'admin-a',email:'cerko11real@gmail.com',emailVerified:true});
 await d.login();
 assert.equal(d.run('state.admin'),true);
 assert.equal(d.run('state.currentUser.role'),'admin');
 assert.equal(d.run('sessionUser.isAdmin'),true);
 d.run("restore({id:'admin-a',email:'CERKO11REAL@GMAIL.COM'},readCache('admin-a').records)");
 assert.equal(d.run('state.admin'),true);
 d.run("restore({id:'other',email:'other@example.com'},{});");
 assert.equal(d.run('state.admin'),false);
 assert.equal(d.run('state.currentUser.role'),'user');
});


test('profile saves use the post sync queue and reject pre-save directory responses after upload',async()=>{
  const remote={},app=device(remote);await app.login();
  app.run("state.userProfile.bio='New bio with @cerko';state.userProfile.avatar='data:image/png;base64,YQ==';persist()");
  assert.equal(app.run("communityMembers.find(m=>m.id===testUser.id).bio"),'New bio with @cerko');
  assert.equal(app.run("state.currentUser.avatar"),'data:image/png;base64,YQ==');
  // A community read begins while the old profile is still in the database.
  app.run("globalThis.realApi=api;globalThis.delayDirectory=true;api=(path,options)=>{if(path==='profiles'&&delayDirectory){delayDirectory=false;return new Promise(resolve=>{globalThis.releaseDirectory=resolve})}return realApi(path,options)};globalThis.directoryRequest=refreshPublicBios()");
  await app.run('syncCloud()');
  assert.equal(remote['account-a'].records.userProfile.bio,'New bio with @cerko');
  assert.ok(remote['account-a'].records.userProfile.avatar.__wearhouseImage);
  assert.equal(app.run("Object.hasOwn(readCache(testUser.id).pending,'userProfile')"),false);
  await app.run("releaseDirectory({members:[{id:testUser.id,bio:'Old bio',avatar:''}]});directoryRequest");
  assert.equal(app.run('state.userProfile.bio'),'New bio with @cerko');
  assert.equal(app.run("member(testUser.id).avatar"),'data:image/png;base64,YQ==');
});


test('live profile polling updates another device and preserves independent profile edits',async()=>{
 const remote={},phone=device(remote),desktop=device(remote);
 await phone.login();await desktop.login();
 phone.run("state.userProfile.bio='From phone';state.userProfile.avatar='data:image/png;base64,YQ==';state.userProfile.following=['other'];persist()");
 await phone.run('syncCloud()');
 // The desktop edits a different field before it sees the phone changes.
 desktop.run("state.userProfile.name='Desktop name';persist()");
 await desktop.run('syncCloud()');
 await phone.run('refreshPublicBios()');
 assert.equal(phone.run('state.userProfile.name'),'Desktop name');
 assert.equal(desktop.run('state.userProfile.bio'),'From phone');
 assert.equal(desktop.run('state.userProfile.following[0]'),'other');
 assert.ok(remote['account-a'].records.userProfile.avatar.__wearhouseImage);
 phone.run("state.userProfile.bio='';state.userProfile.avatar='';state.userProfile.following=[];persist()");
 await phone.run('syncCloud()');await desktop.run('refreshPublicBios()');
 assert.equal(desktop.run('state.userProfile.bio'),'');
 assert.equal(desktop.run('state.userProfile.avatar'),'');
 assert.equal(desktop.run('state.userProfile.following.length'),0);
});

test('public avatar references survive an unrelated profile save without a local photo cache',async()=>{
 const remote={},phone=device(remote),desktop=device(remote);await phone.login();await desktop.login();
 phone.run("state.userProfile.avatar='data:image/png;base64,YQ==';persist()");await phone.run('syncCloud()');
 await desktop.run('refreshPublicBios()');
 assert.match(desktop.run('state.userProfile.avatar'),/community-photo/);
 desktop.run("state.userProfile.bio='Updated from PC';persist()");await desktop.run('syncCloud()');
 assert.ok(remote['account-a'].records.userProfile.avatar.__wearhouseImage);
});

test('profile and post edits persist in the cloud without local profile, feed, or image records',async()=>{
 const remote={},phone=device(remote);await phone.login();
 phone.run("state.userProfile.bio='Cloud bio';state.userProfile.following=['other'];state.userProfile.avatar='data:image/png;base64,YQ==';state.posts=[{id:'cloud-post',authorId:testUser.id,caption:'Cloud caption',image:'data:image/png;base64,Yg=='}];persist()");
 await phone.run('syncCloud()');
 assert.equal(remote['account-a'].records.userProfile.bio,'Cloud bio');
 assert.equal(remote['account-a'].records['posts:cloud-post'].caption,'Cloud caption');
 const disk=JSON.parse(phone.run('localStorage.getItem(CACHE_PREFIX+testUser.id)'));
 assert.equal(disk.records.userProfile,undefined);
 assert.equal(disk.records['posts:cloud-post'],undefined);
 assert.equal(disk.members,undefined);assert.equal(disk.community,undefined);
 assert.deepEqual(disk.images,{});
 assert.equal(phone.run("localStorage.getItem('wearhouse_all_users')"),null);
 assert.equal(JSON.parse(phone.run('localStorage.getItem(CURRENT_USER)')).avatar,undefined);
 const desktop=device(remote);await desktop.login();
 assert.equal(desktop.run('state.userProfile.bio'),'Cloud bio');
 assert.equal(desktop.run('state.posts[0].caption'),'Cloud caption');
});

test('community refresh discovers own posts from another device and respects pending deletions',async()=>{
 const app=device({});await app.login();
 app.run("globalThis.originalApi=api;api=(path,options)=>path==='community'?Promise.resolve({posts:[{id:'remote-post',authorId:testUser.id,caption:'From phone'}],members:[]}):originalApi(path,options)");
 await app.run('loadCommunity(testUser)');
 assert.equal(app.run('state.posts[0].caption'),'From phone');
 app.offline();app.run("state.posts=[];const cache=readCache(testUser.id);cache.pending['posts:remote-post']=null;writeCache(testUser.id,cache)");
 await app.run('loadCommunity(testUser)');assert.equal(app.run('state.posts.length'),0);
});

test('failed post saves remain pending in the open page and never become local-only saved posts',async()=>{
 const remote={},app=device(remote);await app.login();app.fail(true);
 app.run("state.posts=[{id:'retry',authorId:testUser.id,caption:'Retry me'}];persist()");
 await app.run('syncCloud()');
 assert.equal(app.run("readCache(testUser.id).pending['posts:retry'].caption"),'Retry me');
 assert.equal(JSON.parse(app.run('localStorage.getItem(CACHE_PREFIX+testUser.id)')).pending['posts:retry'],undefined);
 app.fail(false);await app.run('syncCloud()');
 assert.equal(remote['account-a'].records['posts:retry'].caption,'Retry me');
});
