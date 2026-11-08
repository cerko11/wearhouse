import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function setup(){
 const storage=new Map(),timers=[];
 const context=vm.createContext({Date:{now:()=>100000000},Number,Map,Set,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},document:{querySelectorAll:()=>[]},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length},clearTimeout:()=>{},showStory:index=>{context.shown=index},STORIES_CACHE:'stories',globalStories:[],archivedStories:[],storyList:[],storyIndex:0,storyActive:false,storyHighlightMode:false,storyExpiryTimer:0,storyRevision:0,publicHighlights:[]});
 vm.runInContext(html.match(/function activeStory\(s\)\{[^}]+\}/)[0]+html.slice(html.indexOf('function storyGroups()'),html.indexOf('function storiesBar()'))+html.slice(html.indexOf('function syncStoryState()'),html.indexOf('async function loadStories()')),context);
 const stories=[{id:'one',authorId:'a',createdAt:99999900},{id:'two',authorId:'a',createdAt:99999950},{id:'old',authorId:'b',createdAt:1}];
 context.globalStories=stories.slice();context.archivedStories=stories.slice();
 return {context,storage,timers,run:code=>vm.runInContext(code,context)};
}
test('expiry purges active cache, schedules next deadline, and preserves highlight archive',()=>{
 const h=setup();h.run('syncStoryState()');assert.deepEqual(JSON.parse(h.storage.get('stories')).map(s=>s.id),['one','two']);assert.equal(h.context.archivedStories.length,3);assert.equal(h.timers.at(-1).delay,86399900);assert.equal(h.run('storyGroups().length'),1);
 h.context.globalStories[0].createdAt=1;h.context.globalStories[1].createdAt=1;h.timers.at(-1).fn();assert.equal(h.storage.get('stories'),'[]');assert.equal(h.run('storyGroups().length'),0);
});
test('manual deletion updates playlist, cache and author groups without a reload',()=>{
 const h=setup();h.run('syncStoryState();storyList=globalStories.slice();storyActive=true;removeStory("one")');assert.equal(h.run('storyGroups()[0].length'),1);assert.equal(h.context.storyList[0].id,'two');assert.equal(h.context.shown,0);assert.equal(h.context.archivedStories.some(s=>s.id==='one'),false);
 h.run('removeStory("two")');assert.equal(h.run('storyGroups().length'),0);assert.equal(h.storage.get('stories'),'[]');assert.equal(h.context.storyList.length,0);
});
test('highlight playback retains expired stories during active feed cleanup',()=>{
 const h=setup();h.run('storyHighlightMode=true;storyList=[archivedStories[2]];storyActive=true;syncStoryState()');assert.equal(h.context.storyList[0].id,'old');h.run('removeStory("old")');assert.equal(h.context.storyList.length,0);
});

function feedHarness(){
 const pending=[];
 const h=setup();
 Object.assign(h.context,{storyRequest:0,fetch:()=>new Promise(resolve=>pending.push(resolve)),AbortSignal:{timeout:()=>null},state:{isAuthenticated:false},location:{hash:''},URLSearchParams,storiesBar:()=>'',storyStatus:''});
 vm.runInContext(html.slice(html.indexOf('async function loadStories()'),html.indexOf('function stopStory()')),h.context);
 const respond=(index,stories)=>pending[index]({ok:true,json:async()=>({stories})});
 return {...h,pending,respond};
}
test('public refresh discovers other authors without posting and removes remotely deleted bubbles during playback',async()=>{
 const h=feedHarness();h.context.globalStories=[];h.context.archivedStories=[];
 let request=h.run('loadStories()');h.respond(0,[{id:'cerko-story',authorId:'cerko',createdAt:99999900}]);await request;
 assert.equal(h.run('storyGroups()[0][0].authorId'),'cerko');
 h.run('storyList=globalStories.slice();storyActive=true');
 request=h.run('loadStories()');h.respond(1,[]);await request;
 assert.equal(h.run('storyGroups().length'),0);assert.equal(h.context.storyList.length,0);assert.equal(h.storage.get('stories'),'[]');
});
test('older overlapping responses cannot restore a remotely deleted story',async()=>{
 const h=feedHarness(),old=h.run('loadStories()'),latest=h.run('loadStories()');
 h.respond(1,[]);await latest;
 h.respond(0,[{id:'deleted',authorId:'other',createdAt:99999900}]);await old;
 assert.equal(h.context.globalStories.length,0);
});
test('refresh started before local deletion cannot resurrect it',async()=>{
 const h=feedHarness(),request=h.run('loadStories()');h.run('removeStory("one")');
 h.respond(0,[{id:'one',authorId:'a',createdAt:99999900}]);await request;
 assert.equal(h.context.globalStories.some(s=>s.id==='one'),false);
});
