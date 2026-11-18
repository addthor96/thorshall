"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {renderAdminPage}=require("../netlify/lib/admin-page");
const giveawaySource=fs.readFileSync(require.resolve("../assets/admin-giveaways.js"),"utf8");
const adminSource=fs.readFileSync(require.resolve("../assets/admin.js"),"utf8");
const clone=value=>structuredClone(value);
const partner={code:"t1",name:"Private partner",campaignId:"130933",landingPath:"/t1",dashboardPath:"/t1-dashboard",campaignUrl:"https://playrainbet.com/testcode",passwordConfigured:true,management:{workflow:"active",notes:"Private notes",revision:0,updatedAt:null}};
function entry(id,amountMinor=10000,status="recorded"){return{id,amountMinor,status,createdAt:"2026-11-18T12:00:00Z"};}
function ledger(entries=[],revision=0){const active=entries.filter(row=>row.status==="recorded");return{ok:true,currency:"USD",totalMinor:active.reduce((sum,row)=>sum+row.amountMinor,0),count:active.length,revision,entries};}
class Element{
  constructor(id="",tagName="div"){this.id=id;this.tagName=tagName;this.children=[];this.dataset={};this.listeners=new Map();this.attributes={};this._text="";this.value="";this.hidden=false;this.disabled=false;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join("");}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;this._text="";}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
  fire(type,event={}){return Promise.all((this.listeners.get(type)||[]).map(fn=>fn({preventDefault(){},...event})));}
  focus(){this.focused=true;}
  descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  find(className){return this.descendants().find(child=>(child.className||"").split(" ").includes(className));}
}
async function start({giveaways=()=>ledger(),directory=()=>({ok:true,partners:[clone(partner)]}),both=false,delayGiveawayStartup=false}={}){
  const nodes=new Map(),events=new Map(),calls=[];let uuid=0;
  for(const [,tag,attrs,id]of renderAdminPage().matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)){const node=new Element(id,tag);node.hidden=/\bhidden\b/.test(attrs);node.disabled=/\bdisabled\b/.test(attrs);nodes.set(id,node);}
  class BrowserEvent{constructor(type,properties={}){this.type=type;Object.assign(this,properties);}}
  const window={addEventListener(type,fn){const list=events.get(type)||[];list.push(fn);events.set(type,list);},dispatchEvent(event){for(const listener of [...(events.get(event.type)||[])])listener(event);return true;}};
  const context={window,document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element("",tag)},Event:BrowserEvent,Intl,Date,URLSearchParams,AbortController,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,"0")}`},setTimeout:()=>1,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},fetch:async(url,options={})=>{
    const call={url,method:options.method||"GET",body:options.body?JSON.parse(options.body):undefined,rawBody:options.body,headers:options.headers,signal:options.signal};calls.push(call);
    let result;
    if(url==="/.netlify/functions/giveaways")result=await giveaways(call,calls.filter(item=>item.url===url).length);
    else if(url==="/.netlify/functions/admin-data")result=await directory(call);
    else if(url.includes("partner-stats"))result={ok:true,partner:{code:"t1"},range:{key:"month"},metrics:{visits:2,registrations:1,ftd:0,ngr:5}};
    else if(url.includes("partner-payments"))result={ok:true,partner:{code:"t1"},canManage:true,payments:[{amountPaid:"12.50",currency:"USD",paidAt:"2026-11-18",reportingMonth:"2026-11",reference:"Private payment"}]};
    else throw new Error("Unexpected request "+url);
    if(result instanceof Error)throw result;
    const value=clone(result);return{ok:!value.status||value.status<400,status:value.status||200,json:async()=>value};
  }};
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
  if(both)vm.runInNewContext(adminSource,context);
  if(delayGiveawayStartup)await settle();
  vm.runInNewContext(giveawaySource,context);await settle();
  return{nodes,calls,window,events,settle,reads:()=>calls.filter(call=>call.url==="/.netlify/functions/giveaways"&&call.method==="GET"),writes:()=>calls.filter(call=>call.url==="/.netlify/functions/giveaways"&&call.method!=="GET"),setGiveaways:fn=>{giveaways=fn;},setDirectory:fn=>{directory=fn;},fire:async(id,type="click")=>{await nodes.get(id).fire(type);await settle();},record:async value=>{nodes.get("giveaway-amount").value=value;await nodes.get("giveaway-form").fire("submit");await settle();},dispatch:async(type,properties={})=>{window.dispatchEvent(new BrowserEvent(type,properties));await settle();}};
}

test("unavailable or invalid initial giveaway data never becomes a zero total",async()=>{
  for(const result of [{status:503},{...ledger(),totalMinor:-1}]){
    const app=await start({giveaways:()=>result});assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-count").textContent,"—");assert.equal(app.nodes.get("giveaway-submit").disabled,true);assert.equal(app.nodes.get("giveaway-empty").hidden,true);assert.equal(app.nodes.get("giveaway-retry").hidden,false);assert.match(app.nodes.get("giveaway-status").textContent,/unavailable/i);assert.equal(app.writes().length,0);
  }
});

test("recording uses the confirmed total and clears the amount only after acknowledgement",async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let captured;
  const app=await start({giveaways:async call=>{if(call.method==="GET")return ledger();captured=call;await gate;return ledger([entry(call.body.requestId,10050)],1);}});
  await app.record("100.50");assert.equal(app.nodes.get("giveaway-total").textContent,"$0.00");assert.equal(app.nodes.get("giveaway-amount").value,"100.50");assert.equal(app.nodes.get("giveaway-submit").disabled,true);assert.deepEqual(captured.body,{requestId:"00000000-0000-4000-8000-000000000001",amount:"100.50"});assert.equal(captured.headers["X-Thorshall-Request"],"giveaways");
  release();await app.settle();assert.equal(app.nodes.get("giveaway-total").textContent,"$100.50");assert.equal(app.nodes.get("giveaway-amount").value,"");assert.equal(app.nodes.get("giveaway-submit").disabled,false);assert.equal(app.nodes.get("giveaway-history").children.length,1);assert.equal(app.nodes.get("giveaway-retry").hidden,true);
});

test("ambiguous record retries retain the same UUID and exact payload",async()=>{
  let attempts=0;
  const app=await start({giveaways:call=>call.method==="GET"?ledger():++attempts===1?new Error("Connection lost"):ledger([entry(call.body.requestId,2500)],1)});
  await app.record("25");assert.equal(app.nodes.get("giveaway-amount").value,"25");assert.equal(app.nodes.get("giveaway-amount").disabled,true);assert.equal(app.nodes.get("giveaway-retry").hidden,false);await app.record("999");assert.equal(app.writes().length,1);
  let prevented=false;await app.dispatch("beforeunload",{preventDefault(){prevented=true;}});assert.equal(prevented,true);
  await app.fire("giveaway-retry");assert.equal(app.writes().length,2);assert.equal(app.writes()[0].rawBody,app.writes()[1].rawBody);assert.equal(app.nodes.get("giveaway-total").textContent,"$25.00");assert.equal(app.nodes.get("giveaway-history").children.length,1);assert.equal(app.nodes.get("giveaway-amount").value,"");
});

test("Undo retries the same correction and keeps the undone record without subtracting twice",async()=>{
  const original=[entry("first",10000),entry("second",5000)];let patches=0;
  const app=await start({giveaways:call=>call.method==="GET"?ledger(original,2):++patches===1?new Error("Response lost"):ledger([entry("first",10000,"void"),entry("second",5000)],3)});
  const undo=app.nodes.get("giveaway-history").children[0].find("quiet-button");await undo.fire("click");await app.settle();assert.equal(app.nodes.get("giveaway-total").textContent,"$150.00");assert.equal(app.nodes.get("giveaway-retry").hidden,false);
  await app.fire("giveaway-retry");assert.equal(app.writes()[0].method,"PATCH");assert.deepEqual(app.writes()[0].body,{requestId:"00000000-0000-4000-8000-000000000001",entryId:"first",expectedRevision:2});assert.equal(app.writes()[0].rawBody,app.writes()[1].rawBody);assert.equal(app.nodes.get("giveaway-total").textContent,"$50.00");assert.match(app.nodes.get("giveaway-history").children[0].textContent,/Undone/);assert.equal(app.nodes.get("giveaway-history").children[0].find("quiet-button"),undefined);assert.equal(app.nodes.get("giveaway-history").children.length,2);
});

test("a conflict requires a fresh owner GET before another write and never shows an empty-history claim",async()=>{
  let reads=0;
  const app=await start({giveaways:call=>call.method==="GET"?(++reads===1?ledger():ledger([entry("new",3000)],1)):{status:409,error:"Revision changed"}});
  assert.equal(app.nodes.get("giveaway-empty").hidden,false);await app.record("10");assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-empty").hidden,true);assert.equal(app.nodes.get("giveaway-amount").disabled,true);await app.record("20");assert.equal(app.writes().length,1);await app.fire("giveaway-retry");assert.equal(app.reads().length,2);assert.equal(app.nodes.get("giveaway-total").textContent,"$30.00");assert.equal(app.nodes.get("giveaway-amount").disabled,false);
});

test("refresh failure clears an earlier confirmed empty state instead of claiming no records",async()=>{
  const app=await start();assert.equal(app.nodes.get("giveaway-empty").hidden,false);app.setGiveaways(()=>({status:503}));await app.fire("refresh-all");assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-empty").hidden,true);assert.equal(app.nodes.get("giveaway-history").children.length,0);assert.equal(app.nodes.get("giveaway-submit").disabled,true);
});

test("giveaway session expiry clears its ledger and the existing private partner workspace",async()=>{
  const app=await start({both:true,giveaways:call=>call.method==="GET"?ledger([entry("private",5000)],1):{status:401}});assert.equal(app.nodes.get("partner-list").children.length,1);assert.equal(app.nodes.get("giveaway-total").textContent,"$50.00");await app.record("20");assert.equal(app.nodes.get("session-error").hidden,false);assert.equal(app.nodes.get("partner-list").children.length,0);assert.equal(app.nodes.get("recent-payments").children.length,0);assert.equal(app.nodes.get("giveaway-history").children.length,0);assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-amount").value,"");assert.equal(app.nodes.get("giveaway-submit").disabled,true);assert.equal(app.window.__thorshallAdminExpired,true);
});

test("partner expiry reciprocally clears giveaway data, including late script startup",async()=>{
  const app=await start({both:true,giveaways:()=>ledger([entry("private",5000)],1)});app.setDirectory(()=>({status:403}));await app.fire("refresh-all");assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-history").children.length,0);assert.equal(app.nodes.get("giveaway-submit").disabled,true);assert.equal(app.nodes.get("partner-list").children.length,0);
  const late=await start({both:true,delayGiveawayStartup:true,directory:()=>({status:401}),giveaways:()=>ledger([entry("must-not-load")],1)});assert.equal(late.reads().length,0);assert.equal(late.nodes.get("giveaway-total").textContent,"—");assert.equal(late.nodes.get("giveaway-submit").disabled,true);
});

test("pagehide clears private state and a late write cannot replace the fresh bfcache GET",async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);let reads=0,postedId;
  const app=await start({both:true,giveaways:async call=>{if(call.method==="GET")return ++reads===1?ledger():ledger([entry(postedId,2000),entry("another-session",1000)],2);postedId=call.body.requestId;await gate;return ledger([entry(postedId,2000)],1);}});
  await app.record("20");await app.dispatch("pagehide");assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-history").children.length,0);assert.equal(app.nodes.get("giveaway-amount").value,"");assert.equal(app.nodes.get("partner-list").children.length,0);assert.equal(app.writes()[0].signal.aborted,true);
  await app.dispatch("pageshow",{persisted:true});assert.equal(app.reads().length,2);assert.equal(app.writes().length,1);assert.equal(app.nodes.get("giveaway-total").textContent,"$30.00");release();await app.settle();assert.equal(app.nodes.get("giveaway-total").textContent,"$30.00");assert.equal(app.nodes.get("giveaway-history").children.length,2);assert.equal(app.nodes.get("partner-list").children.length,1);
});

test("bfcache restore reauthorizes and a 401 cannot restore either private panel",async()=>{
  let reads=0;const app=await start({both:true,giveaways:()=>++reads===1?ledger([entry("private")],1):{status:401}});await app.dispatch("pagehide");await app.dispatch("pageshow",{persisted:true});assert.equal(app.reads().length,2);assert.equal(app.nodes.get("giveaway-total").textContent,"—");assert.equal(app.nodes.get("giveaway-history").children.length,0);assert.equal(app.nodes.get("partner-list").children.length,0);assert.equal(app.nodes.get("session-error").hidden,false);assert.equal(app.writes().length,0);
});
