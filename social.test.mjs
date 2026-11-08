import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
function harness(name,{user={id:'a'},rows=[],banned=[]}={}){
 const writes=[];
 const context=vm.createContext({Request,Response,URL,Date,crypto:{randomUUID:()=> 'new'},getUser:async()=>user,isBanned:async id=>banned.includes(id),and:(...predicates)=>r=>predicates.every(p=>p(r)),eq:(key,value)=>r=>r[key]===value,like:(key,value)=>r=>r[key]?.startsWith(value.replace(/%$/,'')),accountRecords:{userId:'userId',key:'key'},drizzle:()=>({select:()=>({from:()=>({where:async predicate=>rows.filter(predicate)})}),insert:()=>({values:v=>{writes.push(v);return {onConflictDoNothing:async()=>{}}}}),delete:()=>({where:async()=>{writes.push('delete')}})})});
 const source=readFileSync(new URL('../netlify/functions/'+name+'.mts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default','const handler =');
 vm.runInContext(stripTypeScriptTypes(source),context);
 return {writes,run:(method='GET',body,origin='https://wearhouse.test')=>{context.req=new Request('https://wearhouse.test/.netlify/functions/'+name+'?id=one',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return vm.runInContext('handler(req)',context)}};
}
test('conversations require login and only return messages involving the viewer',async()=>{
 assert.equal((await harness('conversations',{user:null}).run()).status,401);
 const h=harness('conversations',{rows:[{userId:'a',key:'message:1',value:{recipient:'b',createdAt:2,text:'Hello'}},{userId:'b',key:'message:2',value:{recipient:'a',createdAt:3,text:'Reply'}},{userId:'b',key:'message:3',value:{recipient:'c',text:'Private'}}]});
 const {messages}=await (await h.run()).json();assert.deepEqual(messages.map(m=>m.id),['1','2']);
});
test('message sender comes from session and blocked or cross-origin messages are rejected',async()=>{
 const rows=[{userId:'a',key:'userProfile',value:{}},{userId:'b',key:'userProfile',value:{}}],h=harness('conversations',{rows});
 assert.equal((await h.run('POST',{recipient:'b',sender:'forged',text:'Hello'})).status,201);assert.equal(h.writes[0].userId,'a');
 assert.equal((await h.run('POST',{recipient:'b',text:'Hello'},'https://other.test')).status,403);
 rows[1].value.blockedUsers=['a'];assert.equal((await h.run('POST',{recipient:'b',text:'Hello'})).status,403);
});
test('message validation rejects empty text, self messages and oversized text',async()=>{
 const h=harness('conversations');for(const body of [{recipient:'b',text:' '},{recipient:'a',text:'Hello'},{recipient:'b',text:'x'.repeat(1001)}])assert.equal((await h.run('POST',body)).status,400);assert.equal(h.writes.length,0);
});
test('story hearts require authenticated same-origin writes and enforce banned sessions',async()=>{
 const rows=[{userId:'owner',key:'story:one',value:{}}];
 assert.equal((await harness('story-reactions',{user:null,rows}).run('POST',{liked:true})).status,401);
 assert.equal((await harness('story-reactions',{rows}).run('POST',{liked:true},'https://other.test')).status,403);
 assert.equal((await harness('story-reactions',{rows,banned:['a']}).run('POST',{liked:true})).status,403);
 const h=harness('story-reactions',{rows});assert.equal((await h.run('POST',{liked:true})).status,200);assert.equal(h.writes[0].userId,'a');assert.equal(h.writes[0].key,'story-like:one');
});
test('single-file application scripts parse and mobile copy stays synchronized',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');for(const [,attributes,script] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){if(!attributes.includes('src='))new vm.Script(script.replace(/^import .*;?$/gm,''))}assert.equal(html,readFileSync(new URL('../www/index.html',import.meta.url),'utf8'));
});
test('new incoming messages are requests and cannot be answered without acceptance',async()=>{
 const rows=[{userId:'a',key:'userProfile',value:{}},{userId:'b',key:'userProfile',value:{}},{userId:'b',key:'message:incoming',value:{recipient:'a',text:'Hello',createdAt:1}}];
 const h=harness('conversations',{rows});
 const inbox=await (await h.run()).json();assert.deepEqual(inbox.requests,['b']);
 assert.equal((await h.run('POST',{recipient:'b',text:'Reply'})).status,403);
 rows.push({userId:'a',key:'chat-status:b',value:'accept'});
 assert.equal((await h.run('POST',{recipient:'b',text:'Reply'})).status,201);
});
test('declined conversations disappear and rejecting recipients cannot be messaged again',async()=>{
 const rows=[{userId:'a',key:'userProfile',value:{}},{userId:'b',key:'userProfile',value:{}},{userId:'b',key:'message:incoming',value:{recipient:'a',text:'Hello',createdAt:1}},{userId:'a',key:'chat-status:b',value:'decline'}];
 const inbox=await (await harness('conversations',{rows}).run()).json();assert.equal(inbox.messages.length,0);assert.equal(inbox.requests.length,0);
 rows.push({userId:'b',key:'chat-status:a',value:'decline'});
 assert.equal((await harness('conversations',{rows}).run('POST',{recipient:'b',text:'Hello again'})).status,403);
});
test('active story lifetime ends exactly after 24 hours; archive data is retained',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const source=html.match(/function activeStory\(s\)\{[^}]+\}/)[0];
 const context=vm.createContext({Date:{now:()=>100000000},Number});vm.runInContext(source,context);
 assert.equal(vm.runInContext('activeStory({createdAt:100000000-86400000+1})',context),true);
 assert.equal(vm.runInContext('activeStory({createdAt:100000000-86400000})',context),false);
 assert.equal(vm.runInContext('activeStory({})',context),false);
});
test('highlights are public and only owners can archive their stories',async()=>{
 const rows=[{userId:'b',key:'highlight:look',value:{title:'Looks',storyId:'one'}},{userId:'b',key:'story:one',value:{}}];
 const publicResult=await (await harness('highlights',{user:null,rows}).run()).json();assert.equal(publicResult.highlights[0].owner,'b');
 assert.equal((await harness('highlights',{rows}).run('POST',{title:'Stolen',storyId:'one'})).status,400);
 assert.equal((await harness('highlights',{user:null,rows}).run('POST',{title:'Looks',storyId:'one'})).status,401);
 assert.equal((await harness('highlights',{rows}).run('POST',{title:'Looks',storyId:'one'},'https://other.test')).status,403);
});
test('request decisions require same-origin recipient action and an incoming message',async()=>{
 const h=harness('conversations');
 assert.equal((await h.run('PATCH',{peer:'b',action:'accept'},'https://other.test')).status,403);
 assert.equal((await h.run('PATCH',{peer:'b',action:'accept'})).status,403);
 assert.equal((await h.run('PATCH',{peer:'b',action:'arbitrary'})).status,400);
});
