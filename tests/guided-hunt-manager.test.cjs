'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../hunt-shared');
const Windows=require('../netlify/lib/hunt-prediction-windows');
const html=fs.readFileSync(require.resolve('../netlify/views/hunts-admin.html'),'utf8');
const source=fs.readFileSync(require.resolve('../hunt-admin.js'),'utf8');
const clone=value=>structuredClone(value);
function initial(rows=[],status='collecting'){return{schema:2,activeId:'hunt-a',hunts:[{id:'hunt-a',title:'Test hunt',date:'2026-11-16',currency:'USD',start:1000,balance:0,status,rows}],settings:{public:true}};}
function bonus(id,slot,payout=null){return{id,slot,provider:'',bet:10,payout};}
async function start({data=initial(),mutate}={}){
  const nodes=new Map(),events=new Map(),timers=new Map(),storage=new Map();let timerId=0,version=1,server=clone(data),writes=0,closed={};
  const windows=()=>Object.fromEntries(server.hunts.map(h=>[h.id,{closedAt:closed[h.id]||null,accepting:server.settings.public&&server.activeId===h.id&&Windows.running(h)&&!closed[h.id]}]));
  const document={activeElement:null,getElementById:id=>{if(!nodes.has(id))throw new Error('Missing DOM element '+id);return nodes.get(id);},createElement:()=>({click(){}})};
  class Element{
    constructor(id,attrs){this.id=id;this.value='';this.textContent='';this.innerHTML='';this.hidden=/\bhidden\b/.test(attrs);this.disabled=/\bdisabled\b/.test(attrs);this.dataset={};this.style={};this.attributes={};this.listeners={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>{if(on===undefined)on=!this.classes.has(x);if(on)this.classes.add(x);else this.classes.delete(x);return on;},contains:x=>this.classes.has(x)};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(key,value){this.attributes[key]=String(value);}
    focus(){if(!this.disabled)document.activeElement=this;}
    select(){this.selectionStart=0;this.selectionEnd=this.value.length;}
    scrollIntoView(options){this.scrolledIntoView=options;}
    click(){return this.fire('click');}
    fire(type,target=this){return this.listeners[type]?.({target,preventDefault(){}});}
  }
  for(const [,attrs,id]of html.matchAll(/<[a-z]+([^>]*\bid="([^"]+)"[^>]*)>/g))nodes.set(id,new Element(id,attrs));
  const calls=[];
  const context={document,window:{HuntCore:Core,addEventListener:(name,fn)=>events.set(name,fn)},location:{origin:'https://thorshall.test'},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},localStorage:{getItem:()=>null},navigator:{clipboard:{writeText:async()=>{}}},AbortSignal,URL,Blob,Date,Intl,confirm:()=>true,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options={})=>{
      const body=options.body?JSON.parse(options.body):undefined;calls.push({url,method:options.method,body:clone(body)});
      if(options.method==='GET')return{ok:true,status:200,json:async()=>({ok:true,state:clone(server),revision:'v'+version,streamToken:'x'.repeat(43),predictionWindows:windows()})};
      writes++;let result=mutate?await mutate(body,writes,options):null;if(result instanceof Error)throw result;
      if(result?.status)return{ok:false,status:result.status,json:async()=>({ok:false,error:result.error||'Save failed'})};
      assert.equal(body.revision,'v'+version,'writes must use the latest saved revision');version++;
      const next=options.method==='PUT'?clone(body.state):server;
      closed=Windows.closePredictionWindows({state:server,predictionClosedAt:closed},next,new Date('2026-11-19T15:00:00.000Z'),body.action==='close-predictions'?body.huntId:null);server=next;
      return{ok:true,status:200,json:async()=>({ok:true,state:clone(server),revision:'v'+version,predictionWindows:windows(),...(body.action==='rotate-token'?{streamToken:'y'.repeat(43)}:{})})};
    }};
  vm.runInNewContext(source,context);
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};await settle();
  const target=(key,value)=>({closest:selector=>selector==='[data-'+key+']'?{dataset:{[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:value}}:null});
  return{nodes,events,calls,storage,settle,activeElement:()=>document.activeElement,saved:()=>clone(server),windows:()=>clone(windows()),field:(id,value)=>{nodes.get(id).value=String(value);return nodes.get(id).fire('input');},fire:(id,type='click',t)=>nodes.get(id).fire(type,t),target};
}

test('quick collection adds a valid named bonus, keeps the bet and focuses the next slot',async()=>{
  const app=await start();app.field('newSlotName','<img src=x>');app.field('newSlotBet','10');app.fire('slotEntryForm','submit');
  assert.equal(app.nodes.get('newSlotName').value,'');assert.equal(app.nodes.get('newSlotBet').value,'10');assert.equal(app.nodes.get('collectionCount').textContent,'1 collected');assert.match(app.nodes.get('collectedBonuses').innerHTML,/&lt;img src=x&gt;/);assert.doesNotMatch(app.nodes.get('collectedBonuses').innerHTML,/<img/);
  assert.equal(app.activeElement(),app.nodes.get('newSlotName'));
  await app.fire('saveNow');await app.settle();const row=app.saved().hunts[0].rows[0];assert.equal(row.slot,'<img src=x>');assert.equal(row.bet,10);assert.equal(row.payout,null);
  app.field('newSlotName','');app.field('newSlotBet','0');app.fire('slotEntryForm','submit');assert.equal(app.nodes.get('entryError').hidden,false);assert.equal(app.nodes.get('collectionCount').textContent,'1 collected');
});

test('opening waits for pending collection autosave and keeps all entered slots',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);const app=await start({mutate:async(body,count)=>{if(count===1)await gate;}});
  app.field('newSlotName','First slot');app.field('newSlotBet','10');app.fire('slotEntryForm','submit');app.fire('saveNow');await app.settle();
  app.fire('startOpening');await app.settle();assert.equal(app.nodes.get('collectionPhase').hidden,false);assert.equal(app.nodes.get('startOpening').disabled,true);
  release();await app.settle();assert.equal(app.nodes.get('openingPhase').hidden,false);assert.equal(app.nodes.get('collectionPhase').hidden,true);assert.equal(app.nodes.get('huntSetup').hidden,true);assert.equal(app.saved().hunts[0].status,'opening');assert.equal(app.saved().hunts[0].rows.length,1);assert.equal(app.calls.filter(c=>c.method==='PUT').length,2);
});

test('blank payout cannot advance, while zero saves and advances to the next bonus',async()=>{
  const app=await start({data:initial([bonus('a','First'),bonus('b','Second')],'opening')});
  assert.equal(app.nodes.get('payoutSlotName').textContent,'First');app.field('payoutAmount','');app.fire('payoutForm','submit');await app.settle();assert.equal(app.nodes.get('payoutError').hidden,false);assert.equal(app.calls.filter(c=>c.method==='PUT').length,0);
  app.field('payoutAmount','0');app.fire('payoutForm','submit');await app.settle();assert.equal(app.saved().hunts[0].rows[0].payout,0);assert.equal(app.nodes.get('payoutSlotName').textContent,'Second');assert.equal(app.nodes.get('openingProgressText').textContent,'1 of 2 opened');assert.equal(app.nodes.get('finishHunt').disabled,true);
});

test('finish is available only after every payout saves and preserves completed results',async()=>{
  const app=await start({data:initial([bonus('a','Only')],'opening')});app.fire('finishHunt');await app.settle();assert.equal(app.saved().hunts[0].status,'opening');
  app.field('payoutAmount','250');app.fire('payoutForm','submit');await app.settle();assert.equal(app.nodes.get('allOpened').hidden,false);assert.equal(app.nodes.get('finishHunt').disabled,false);app.fire('finishHunt');await app.settle();assert.equal(app.saved().hunts[0].status,'complete');assert.equal(app.saved().hunts[0].rows[0].payout,250);assert.equal(app.nodes.get('completedPhase').hidden,false);assert.match(app.nodes.get('completedSummary').textContent,/250\.00 end balance/);
});

test('failed payout save stays on that bonus; retry saves the same amount before advancing',async()=>{
  const app=await start({data:initial([bonus('a','First'),bonus('b','Second')],'opening'),mutate:async(body,count)=>count===1?new Error('Offline'):null});
  app.field('payoutAmount','0');app.fire('payoutForm','submit');await app.settle();assert.equal(app.nodes.get('payoutSlotName').textContent,'First');assert.equal(app.nodes.get('payoutAmount').value,'0');assert.equal(app.nodes.get('payoutAmount').disabled,true);assert.equal(app.nodes.get('retrySave').classList.contains('hidden'),false);assert.equal(app.saved().hunts[0].rows[0].payout,null);
  app.fire('retrySave');await app.settle();assert.equal(app.nodes.get('payoutSlotName').textContent,'Second');assert.equal(app.saved().hunts[0].rows[0].payout,0);const writes=app.calls.filter(c=>c.method==='PUT');assert.deepEqual(writes[0].body,writes[1].body);
});

test('revision conflicts preserve the payout draft and block a second write or advance',async()=>{
  const app=await start({data:initial([bonus('a','First'),bonus('b','Second')],'opening'),mutate:async()=>({status:409})});
  app.field('payoutAmount','99');app.fire('payoutForm','submit');await app.settle();assert.equal(app.nodes.get('payoutSlotName').textContent,'First');assert.equal(app.nodes.get('reloadRemote').classList.contains('hidden'),false);assert.equal(app.storage.has('thorshall_hunt_admin_draft_v2'),true);app.fire('savePayout');app.fire('payoutForm','submit');await app.settle();assert.equal(app.calls.filter(c=>c.method==='PUT').length,1);
});

test('token rotation and guided actions cannot issue concurrent revision writes',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);const app=await start({data:initial([bonus('a','First')],'opening'),mutate:async(body,count,options)=>{if(options.method==='POST')await gate;}});
  app.fire('rotateToken');await app.settle();assert.equal(app.nodes.get('payoutAmount').disabled,true);assert.equal(app.nodes.get('importData').disabled,true);
  app.field('payoutAmount','100');app.fire('payoutForm','submit');await app.settle();assert.equal(app.calls.filter(c=>c.method==='PUT').length,0);release();await app.settle();assert.equal(app.nodes.get('payoutAmount').disabled,false);app.fire('payoutForm','submit');await app.settle();assert.equal(app.saved().hunts[0].rows[0].payout,100);assert.equal(app.calls.filter(c=>c.method==='PUT')[0].body.revision,'v2');
});

test('Rename focuses and selects the name, and renaming saves in every hunt phase',async()=>{
  for(const phase of ['collecting','opening','complete']){
    const app=await start({data:initial([bonus('a','Only slot',phase==='complete'?0:null)],phase)});
    assert.equal(app.nodes.get('renameHunt').disabled,false);app.fire('renameHunt');
    const title=app.nodes.get('huntTitle');assert.equal(app.activeElement(),title);assert.equal(title.selectionStart,0);assert.equal(title.selectionEnd,'Test hunt'.length);assert.equal(title.scrolledIntoView.block,'center');assert.equal(app.calls.filter(call=>call.method!=='GET').length,0);
    app.field('huntTitle','Renamed '+phase);await app.fire('saveNow');await app.settle();
    assert.equal(app.saved().hunts[0].title,'Renamed '+phase);assert.equal(app.saved().hunts[0].status,phase);assert.equal(app.saved().hunts[0].rows[0].payout,phase==='complete'?0:null);assert.match(app.nodes.get('huntSelect').innerHTML,new RegExp('Renamed '+phase));assert.equal(app.nodes.get('renameHunt').disabled,false);
  }
});

test('Rename stays blocked during an unsaved payout and session or revision errors',async()=>{
  const pending=await start({data:initial([bonus('a','Only slot')],'opening'),mutate:async()=>new Error('Offline')});
  pending.field('payoutAmount','0');pending.fire('payoutForm','submit');await pending.settle();assert.equal(pending.nodes.get('renameHunt').disabled,true);pending.fire('renameHunt');assert.notEqual(pending.activeElement(),pending.nodes.get('huntTitle'));assert.equal(pending.nodes.get('huntTitle').selectionStart,undefined);assert.equal(pending.saved().hunts[0].rows[0].payout,null);
  for(const status of [401,409]){
    const app=await start({mutate:async()=>({status})});app.field('huntTitle','Unsaved title');await app.fire('saveNow');await app.settle();assert.equal(app.nodes.get('renameHunt').disabled,true);app.fire('renameHunt');assert.notEqual(app.activeElement(),app.nodes.get('huntTitle'));assert.equal(app.nodes.get('huntTitle').selectionStart,undefined);assert.equal(app.saved().hunts[0].title,'Test hunt');assert.equal(app.nodes.get('errorNotice').classList.contains('hidden'),false);
  }
});

test('owner can close predictions while opening, after pending edits save, without changing hunt or overlay data',async()=>{
  const data=initial([bonus('a','First',100),bonus('b','Second')],'opening'),app=await start({data});
  assert.equal(app.nodes.get('predictionStatus').textContent,'Predictions open');assert.equal(app.nodes.get('closePredictions').disabled,false);
  app.field('huntTitle','Renamed live hunt');await app.fire('closePredictions');await app.settle();
  const writes=app.calls.filter(c=>c.method!=='GET');assert.deepEqual(writes.map(c=>c.method),['PUT','POST']);
  assert.deepEqual(writes[1].body,{action:'close-predictions',huntId:'hunt-a',revision:'v2'});
  assert.equal(app.saved().hunts[0].title,'Renamed live hunt');assert.equal(app.saved().hunts[0].status,'opening');assert.deepEqual(app.saved().hunts[0].rows,data.hunts[0].rows);
  assert.equal(app.nodes.get('closePredictions').disabled,true);assert.equal(app.nodes.get('predictionStatus').textContent,'Predictions closed');
  assert.equal(app.nodes.get('overlayUrl').value.includes('x'.repeat(43)),true);
  await app.fire('closePredictions');await app.settle();assert.equal(app.calls.filter(c=>c.method==='POST').length,1);
});

test('close predictions locks other actions during its write and closes only the selected saved hunt',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),data=initial();data.hunts.push({...clone(data.hunts[0]),id:'hunt-b',title:'Other hunt'});data.activeId='hunt-b';
  const app=await start({data,mutate:async(body)=>{if(body.action==='close-predictions')await gate;}});
  app.fire('closePredictions');await app.settle();assert.equal(app.nodes.get('huntSelect').disabled,true);assert.equal(app.nodes.get('rotateToken').disabled,true);assert.equal(app.nodes.get('newHunt').disabled,true);
  app.fire('rotateToken');app.fire('newHunt');await app.settle();assert.equal(app.calls.filter(c=>c.method==='POST').length,1);
  release();await app.settle();assert.equal(app.windows()['hunt-b'].closedAt,'2026-11-19T15:00:00.000Z');assert.equal(app.windows()['hunt-a'].closedAt,null);
  assert.equal(app.nodes.get('newHunt').disabled,false);
});

test('failed or conflicting close never claims closure and blocks further edits until reload',async()=>{
  for(const failure of [new Error('Offline'),{status:409},{status:401}]){
    const app=await start({mutate:async body=>body.action==='close-predictions'?failure:null});
    await app.fire('closePredictions');await app.settle();assert.equal(app.windows()['hunt-a'].closedAt,null);assert.equal(app.nodes.get('closePredictions').disabled,true);
    assert.equal(app.nodes.get('errorNotice').classList.contains('hidden'),false);assert.doesNotMatch(app.nodes.get('toast').textContent,/Predictions closed/);
    assert.equal(app.nodes.get(failure.status===401?'loginAgain':'reloadRemote').classList.contains('hidden'),false);
  }
});
