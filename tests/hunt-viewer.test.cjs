'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../hunt-shared');
const source=fs.readFileSync(require.resolve('../hunt-view.js'),'utf8');
const clone=value=>structuredClone(value);
function bonus(id,slot,payout=null,bet=10){return{id,slot,provider:'',bet,payout};}
function hunt(id,title,status='complete',date='2026-11-16',rows=[]){return{id,title,status,date,rows,currency:'USD',start:100,balance:0};}
function state(hunts,activeId=hunts[0].id){return{schema:2,activeId,hunts,settings:{public:true}};}

// Run the actual viewer script against a small DOM and a controllable read API.
// Timers are captured so tests drive refreshes without background polling.
async function start({data,hash='',overlay=false,predictionWindows={}}={}){
  const nodes=new Map(),windowEvents=new Map(),documentEvents=new Map(),timers=new Map(),calls=[],focuses=[],scrolls=[],dispatched=[];
  let response={state:clone(data),revision:'v1',predictionWindows:clone(predictionWindows)},timerId=0;
  const attributes=text=>{const attrs=Object.fromEntries(Array.from(text.matchAll(/([\w-]+)="([^"]*)"/g),match=>[match[1],match[2]]));for(const name of ['hidden','disabled'])if(new RegExp('(?:^|\\s)'+name+'(?=\\s|>|$)').test(text))attrs[name]='';return attrs;};
  const plainText=text=>text.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[entity]);
  const document={activeElement:null,hidden:false,getElementById:id=>nodes.get(id)||null,addEventListener:(name,fn)=>documentEvents.set(name,fn),dispatchEvent:event=>dispatched.push(event),querySelectorAll:()=>[]};
  class Element{
    constructor(attrs={}){this.attributes=attrs;this.id=attrs.id||'';this._html='';this.textContent='';this.hidden='hidden'in attrs;this.disabled=false;this.scrollLeft=0;this.scrollTop=0;this.clientWidth=600;this.scrollWidth=1200;this.offsetHeight=960;this.listeners=new Map();this.dataset={};this.style={setProperty(name,value){this[name]=value;}};const classes=new Set((attrs.class||'').split(' '));this.classList={contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,on)=>{if(on===undefined)on=!classes.has(name);if(on)classes.add(name);else classes.delete(name);return on;}};}
    get innerHTML(){return this._html;}
    set innerHTML(value){this._html=value;if(this.id==='hunt-view'){for(const key of nodes.keys())if(key!=='hunt-view')nodes.delete(key);for(const match of value.matchAll(/<([a-z][\w-]*)\b[^>]*>/g)){const attrs=attributes(match[0]);if(attrs.id){const node=new Element(attrs),start=match.index+match[0].length,end=value.indexOf('</'+match[1]+'>',start);if(end>=0)node.textContent=plainText(value.slice(start,end));nodes.set(attrs.id,node);}}this.cards=Array.from(value.matchAll(/<a\b[^>]*data-view-hunt="[^"]*"[^>]*>/g),match=>new Element(attributes(match[0])));}}
    getAttribute(name){return this.attributes[name]??null;}
    setAttribute(name,value){this.attributes[name]=String(value);}
    addEventListener(name,fn){this.listeners.set(name,fn);}
    querySelector(selector){return selector==='[data-overlay-panel]'&&this._html.includes('data-overlay-panel')?{}:null;}
    querySelectorAll(selector){return selector==='[data-view-hunt]'?container.cards||[]:[];}
    focus(){document.activeElement=this;focuses.push(this.id||this.getAttribute('data-view-hunt'));}
    scrollIntoView(options){scrolls.push({id:this.id,...options});}
    scrollBy(options){this.scrollLeft+=options.left;this.listeners.get('scroll')?.();}
  }
  const container=new Element({id:'hunt-view'});nodes.set('hunt-view',container);
  document.body=new Element({class:overlay?'overlay-body':''});
  const location={hash,search:'',origin:'https://thorshall.test'};
  const window={HuntCore:Core,innerWidth:640,innerHeight:1080,addEventListener:(name,fn)=>windowEvents.set(name,fn),matchMedia:()=>({matches:true}),HuntOverlayMotion:{create:()=>({destroy(){},update:()=>({mode:'following',focusId:null})})}};
  const context={document,window,location,URLSearchParams,AbortController,Date,Intl,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),fetch:async(url,options={})=>{calls.push({url,method:options.method||'GET',credentials:options.credentials,headers:clone(options.headers)});if(response.error)throw response.error;const current=clone(response);return{ok:!current.status||current.status===200,status:current.status||200,json:async()=>({ok:true,state:current.state,revision:current.revision,predictionWindows:current.predictionWindows})};}};
  vm.runInNewContext(source,context);
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};await settle();
  return{nodes,calls,focuses,scrolls,container,windowEvents,documentEvents,dispatched,location,html:()=>container.innerHTML,setResponse:next=>{response=next.error?next:clone(next);},poll:async()=>{await windowEvents.get('online')();await settle();},select:async id=>{location.hash='#hunt='+encodeURIComponent(id);windowEvents.get('hashchange')?.();await settle();},clearSelection:async()=>{location.hash='';windowEvents.get('hashchange')?.();await settle();}};
}
function detail(html){return html.slice(html.indexOf('<section class="hunt-detail"'));}
function cardIds(html){return Array.from(html.matchAll(/data-view-hunt="([^"]+)"/g),match=>match[1]);}

test('gallery shows active first, dated completed hunts next, and excludes inactive drafts',async()=>{
  const data=state([hunt('older','Older','complete','2026-09-01'),hunt('draft','Hidden draft','collecting'),hunt('live','Live hunt','opening','2026-08-01'),hunt('newer','Newer','complete','2026-10-01'),hunt('same-date','Same date','complete','2026-10-01')],'live');
  const before=clone(data),app=await start({data});
  assert.deepEqual(cardIds(app.html()),['live','newer','same-date','older']);assert.match(detail(app.html()),/>Live hunt<\/h2>/);assert.doesNotMatch(app.html(),/Hidden draft/);assert.deepEqual(data,before);
  assert.deepEqual(app.calls.map(call=>[call.method,call.url]),[['GET','/.netlify/functions/bonus-hunts-api?mode=viewer']]);
});

test('deep links show the selected full ledger with its own currency, zero payout and escaped text',async()=>{
  const past=hunt('past','Past <script>title</script>','complete','2026-10-01',[bonus('zero','Zero <img src=x>',0),bonus('win','Winner',300),bonus('waiting','Waiting bonus',null)]);past.currency='EUR';past.start=200;past.balance=25;
  const app=await start({data:state([hunt('live','Live hunt','opening',undefined,[bonus('live-row','Live-only slot')]),past]),hash:'#hunt=past'}),html=detail(app.html());
  assert.match(html,/Past &lt;script&gt;title&lt;\/script&gt;/);assert.match(html,/Zero &lt;img src=x&gt;/);assert.doesNotMatch(app.html(),/<script>|<img src=x>/);assert.doesNotMatch(html,/Live-only slot/);
  assert.match(html,/<tr class=" zero-payout">.*?0\.00x.*?€0\.00<\/td><\/tr>/);assert.match(html,/Waiting bonus.*?class="unopened">Unopened<\/td>/);assert.match(html,/€325\.00/);assert.match(html,/\+€125\.00/);assert.match(html,/2 of 3 opened/);
});

test('hash navigation is local, supports fallback and never changes the active hunt',async()=>{
  const data=state([hunt('live','Live hunt','opening'),hunt('past','Past hunt'),hunt('draft','Secret draft','collecting')]),before=clone(data),app=await start({data});
  await app.select('past');assert.match(detail(app.html()),/>Past hunt<\/h2>/);assert.equal(app.focuses.length,0);assert.equal(app.scrolls.length,0);assert.equal(app.calls.length,1);
  await app.select('does-not-exist');assert.match(detail(app.html()),/>Live hunt<\/h2>/);await app.select('draft');assert.match(detail(app.html()),/>Live hunt<\/h2>/);await app.clearSelection();assert.match(detail(app.html()),/>Live hunt<\/h2>/);
  assert.deepEqual(data,before);assert.equal(app.calls.length,1);assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('refresh preserves an explicit archive selection and rail position without scrolling the page',async()=>{
  const data=state([hunt('live','Live hunt','opening'),hunt('past','Past hunt','complete',undefined,[bonus('a','Old payout',50)])]),app=await start({data,hash:'#hunt=past'});
  app.nodes.get('hunt-cards').scrollLeft=275;const next=clone(data);next.hunts[1].rows[0].payout=500;next.hunts.unshift(hunt('new-live','New current hunt','opening'));next.activeId='new-live';
  app.setResponse({state:next,revision:'v2'});await app.poll();assert.match(detail(app.html()),/>Past hunt<\/h2>/);assert.match(detail(app.html()),/\$500\.00/);assert.equal(app.nodes.get('hunt-cards').scrollLeft,275);assert.equal(app.scrolls.length,0);assert.equal(app.location.hash,'#hunt=past');
});

test('the default view follows a newly active hunt and a removed selection falls back to it',async()=>{
  const data=state([hunt('first','First live hunt','opening'),hunt('past','Past hunt')]),app=await start({data});
  const next=clone(data);next.hunts.unshift(hunt('second','Second live hunt','collecting'));next.activeId='second';app.setResponse({state:next,revision:'v2'});await app.poll();assert.match(detail(app.html()),/>Second live hunt<\/h2>/);assert.equal(app.location.hash,'');
  await app.select('past');assert.match(detail(app.html()),/>Past hunt<\/h2>/);next.hunts=next.hunts.filter(h=>h.id!=='past');app.setResponse({state:next,revision:'v3'});await app.poll();assert.match(detail(app.html()),/>Second live hunt<\/h2>/);assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('private responses clear cached results so hash changes cannot restore them',async()=>{
  const data=state([hunt('live','Live private result','opening'),hunt('past','Past private result')]),app=await start({data,hash:'#hunt=past'});
  app.setResponse({status:403});await app.poll();assert.match(app.html(),/This hunt is private/);assert.doesNotMatch(app.html(),/Past private result|Live private result/);await app.select('live');assert.match(app.html(),/This hunt is private/);
  app.setResponse({state:data,revision:'v1'});await app.poll();assert.match(detail(app.html()),/>Live private result<\/h2>/);assert.ok(app.calls.every(call=>call.method==='GET'));
});

test('network failures keep the selected saved results and clear the warning after recovery',async()=>{
  const app=await start({data:state([hunt('live','Live hunt','opening'),hunt('past','Past hunt')]),hash:'#hunt=past'}),saved=app.html();
  app.setResponse({error:new Error('Offline')});await app.poll();assert.equal(app.html(),saved);assert.equal(app.nodes.get('sync-label').hidden,false);assert.match(app.nodes.get('sync-label').textContent,/last saved results/);
  await app.select('live');assert.match(detail(app.html()),/>Live hunt<\/h2>/);assert.equal(app.nodes.get('sync-label').hidden,false);assert.match(app.nodes.get('sync-label').textContent,/last saved results/);await app.select('past');assert.equal(app.nodes.get('sync-label').hidden,false);
  app.setResponse({state:state([hunt('live','Live hunt','opening'),hunt('past','Past hunt')]),revision:'v1'});await app.poll();assert.equal(app.nodes.get('sync-label').hidden,true);assert.match(detail(app.html()),/>Past hunt<\/h2>/);
});

test('stream overlay keeps token authentication and active hunt independent of archive selection',async()=>{
  const app=await start({overlay:true,hash:'#token=stream-secret&hunt=past',data:state([hunt('live','Live hunt','opening',undefined,[bonus('a','Live stream slot',30)]),hunt('past','Past hunt','complete',undefined,[bonus('b','Archive-only slot',900)])])});
  assert.deepEqual(app.calls.map(call=>[call.method,call.url,call.credentials,call.headers.Authorization]),[['GET','/.netlify/functions/bonus-hunts-api?mode=overlay','omit','Bearer stream-secret']]);
  assert.match(app.nodes.get('overlay-slot-rows').innerHTML,/Live stream slot/);assert.doesNotMatch(app.nodes.get('overlay-slot-rows').innerHTML,/Archive-only slot/);assert.equal(app.windowEvents.has('hashchange'),false);assert.equal(app.nodes.get('overlay-balance').textContent,'$30.00');
});

test('top hunt cards control both the selected predictions and ledger without skipping predictions',async()=>{
  const data=state([hunt('live','Live hunt','opening'),hunt('past','Past hunt')]);
  const windows={live:{accepting:true,closedAt:null},past:{accepting:false,closedAt:'2026-11-18T12:00:00.000Z'}};
  const app=await start({data,predictionWindows:windows});
  assert.doesNotMatch(app.html(),/Bonus hunts\.|Choose a hunt to explore|Choose your hunt|completed ·|in progress<\/span>|archive-count/);
  assert.ok(app.html().indexOf('id="hunt-cards"')<app.html().indexOf('id="hunt-predictions"'));
  assert.ok(app.html().indexOf('id="hunt-predictions"')<app.html().indexOf('id="hunt-detail"'));
  assert.match(app.html(),/aria-controls="hunt-predictions hunt-detail"/);
  assert.equal(app.dispatched.at(-1).detail.hunt.id,'live');
  assert.deepEqual(clone(app.dispatched.at(-1).detail.predictionWindow),windows.live);
  await app.select('past');
  assert.equal(app.dispatched.at(-1).detail.hunt.id,'past');
  assert.deepEqual(clone(app.dispatched.at(-1).detail.predictionWindow),windows.past);
  assert.match(detail(app.html()),/>Past hunt<\/h2>/);assert.equal(app.scrolls.length,0);
  assert.match(app.html(),/Predictions open/);assert.match(app.html(),/Predictions closed/);
});

test('manual close metadata reaches the selected prediction view on hunt refresh',async()=>{
  const data=state([hunt('live','Live hunt','opening'),hunt('past','Past hunt')]);
  const app=await start({data,predictionWindows:{live:{accepting:true,closedAt:null}}});
  app.setResponse({state:data,revision:'closed-v2',predictionWindows:{live:{accepting:false,closedAt:'2026-11-19T12:00:00.000Z'}}});
  await app.poll();
  assert.equal(app.dispatched.at(-1).detail.hunt.id,'live');
  assert.equal(app.dispatched.at(-1).detail.predictionWindow.accepting,false);
  assert.equal(app.dispatched.at(-1).detail.predictionWindow.closedAt,'2026-11-19T12:00:00.000Z');
  assert.doesNotMatch(app.html(),/Predictions open/);
});

test('reopening refresh passes the new prediction window token without changing the selected hunt',async()=>{
  const data=state([hunt('live','Live hunt','opening'),hunt('past','Past hunt')]);
  const app=await start({data,predictionWindows:{live:{accepting:false,closedAt:'2026-11-19T12:00:00.000Z',windowId:'0'}}});
  const reopened=clone(data);reopened.hunts.find(h=>h.id==='live').status='collecting';
  app.setResponse({state:reopened,revision:'reopened-v3',predictionWindows:{live:{accepting:true,closedAt:null,windowId:'new-cycle'}}});
  await app.poll();
  assert.equal(app.dispatched.at(-1).detail.hunt.id,'live');
  assert.deepEqual(clone(app.dispatched.at(-1).detail.predictionWindow),{accepting:true,closedAt:null,windowId:'new-cycle'});
  assert.match(app.html(),/Predictions open/);
});
