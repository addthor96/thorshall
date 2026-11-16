'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Motion=require('../hunt-overlay-motion');

function fixture(count=12,options={}){
  let time=0,serial=0;
  const callbacks=new Map();
  const viewport={scrollTop:0,clientHeight:8*44,scrollHeight:count*44};
  const hunt={id:'hunt-a',status:'collecting',rows:Array.from({length:count},(_,i)=>({id:'slot-'+i,bet:1,payout:null}))};
  const motion=Motion.create({viewport,rowHeight:44,visibleRows:8,pixelsPerSecond:44,pauseMs:100,now:()=>time,
    requestFrame:cb=>{const id=++serial;callbacks.set(id,cb);return id;},cancelFrame:id=>callbacks.delete(id),...options});
  function advance(ms){for(let left=ms;left>0;){const step=Math.min(20,left);time+=step;left-=step;const queued=Array.from(callbacks.values());callbacks.clear();queued.forEach(cb=>cb(time));}}
  function update(){viewport.scrollHeight=hunt.rows.length*44;return motion.update(hunt);}
  return{viewport,hunt,motion,advance,update,callbacks};
}

test('eight or fewer slots stay at the top without scheduling animation',()=>{
  for(const count of [0,1,8]){const f=fixture(count);assert.equal(f.update().mode,'idle');f.advance(10000);assert.equal(f.viewport.scrollTop,0);assert.equal(f.callbacks.size,0);}
});
test('long collecting list pauses, travels down slowly, then returns toward top',()=>{
  const f=fixture();f.update();f.advance(80);assert.equal(f.viewport.scrollTop,0);
  f.advance(2000);assert.ok(f.viewport.scrollTop>80&&f.viewport.scrollTop<100);
  f.advance(2500);assert.equal(f.motion.getState().direction,-1);assert.ok(f.viewport.scrollTop<176);
  f.advance(5000);assert.equal(f.motion.getState().direction,1);assert.ok(f.viewport.scrollTop<60);
});
test('identical polling and added collecting rows preserve browsing progress',()=>{
  const f=fixture();f.update();f.advance(1800);const position=f.viewport.scrollTop;f.update();assert.equal(f.viewport.scrollTop,position);
  f.hunt.rows.push({id:'new-slot',bet:1,payout:null});f.update();assert.equal(f.viewport.scrollTop,position);f.advance(1000);assert.ok(f.viewport.scrollTop>position);
});
test('slow collection scrolling accumulates fractions when the browser rounds scrollTop',()=>{
  const f=fixture(12,{pixelsPerSecond:12});let roundedPosition=0;
  Object.defineProperty(f.viewport,'scrollTop',{get:()=>roundedPosition,set:value=>{roundedPosition=Math.round(value);}});
  f.update();f.advance(2000);assert.ok(f.viewport.scrollTop>=22&&f.viewport.scrollTop<=24);
  const before=f.viewport.scrollTop;f.update();f.advance(1000);assert.ok(f.viewport.scrollTop>=before+11);
  f.advance(13000);assert.equal(f.motion.getState().direction,-1);assert.ok(f.viewport.scrollTop<176);
});
test('following converges fully and stops frames when scrollTop rounds each write',()=>{
  const f=fixture(20);let roundedPosition=0;
  Object.defineProperty(f.viewport,'scrollTop',{get:()=>roundedPosition,set:value=>{roundedPosition=Math.round(value);}});
  f.hunt.status='opening';f.update();f.hunt.rows[12].payout=0;f.update();f.advance(3000);
  assert.equal(f.viewport.scrollTop,11*44);assert.equal(f.callbacks.size,0);
});
test('the first zero payout stops browsing and resets the list to top',()=>{
  const f=fixture();f.update();f.advance(2000);assert.ok(f.viewport.scrollTop>0);f.hunt.rows[0].payout=0;
  const state=f.update();assert.equal(state.mode,'following');assert.equal(state.focusIndex,0);assert.equal(f.viewport.scrollTop,0);f.advance(5000);assert.equal(f.viewport.scrollTop,0);assert.equal(f.callbacks.size,0);
});
test('opening stage starts from top before any payout is entered',()=>{
  const f=fixture();f.update();f.advance(2000);f.hunt.status='opening';const state=f.update();assert.equal(state.mode,'following');assert.equal(f.viewport.scrollTop,0);assert.equal(state.focusIndex,0);
});
test('payouts advance focus beyond eight rows and corrections follow the exact edited slot',()=>{
  const f=fixture(20);f.hunt.status='opening';f.update();
  f.hunt.rows[10].payout=25;let state=f.update();assert.equal(state.focusIndex,10);assert.equal(state.target,9*44);f.advance(2500);assert.equal(f.viewport.scrollTop,9*44);
  const unchanged=f.viewport.scrollTop;f.update();assert.equal(f.viewport.scrollTop,unchanged);
  f.hunt.rows[2].payout=0;state=f.update();assert.equal(state.focusIndex,2);assert.equal(state.target,44);f.advance(2500);assert.equal(f.viewport.scrollTop,44);
  f.hunt.rows[10].payout=50;state=f.update();assert.equal(state.focusIndex,10);f.advance(2500);assert.equal(f.viewport.scrollTop,9*44);
});
test('a corrected zero or removed payout changes focus without relying on the count',()=>{
  const f=fixture(20);f.hunt.rows[0].payout=1;f.hunt.rows[10].payout=10;f.update();f.advance(2500);
  f.hunt.rows[0].payout=0;assert.equal(f.update().focusIndex,0);f.advance(2500);assert.equal(f.viewport.scrollTop,0);
  f.hunt.rows[10].payout=null;assert.equal(f.update().focusIndex,10);
});
test('switching hunts resets previous focus and browse direction',()=>{
  const f=fixture();f.update();f.advance(2200);f.hunt.id='hunt-b';f.hunt.rows=f.hunt.rows.map((r,i)=>({...r,id:'b-'+i}));
  const state=f.update();assert.equal(state.position,0);assert.equal(state.direction,1);assert.equal(state.focusIndex,-1);f.advance(80);assert.equal(f.viewport.scrollTop,0);
});
test('reduced motion disables collection scrolling and directly follows entered results',()=>{
  const f=fixture(20,{reducedMotion:true});f.update();f.advance(5000);assert.equal(f.viewport.scrollTop,0);assert.equal(f.callbacks.size,0);
  f.hunt.rows[12].payout=0;const state=f.update();assert.equal(state.mode,'following');assert.equal(f.viewport.scrollTop,11*44);assert.equal(f.callbacks.size,0);
});
test('destroy cancels pending frames and later updates do not resume animation',()=>{
  const f=fixture();f.update();assert.equal(f.callbacks.size,1);f.motion.destroy();assert.equal(f.callbacks.size,0);f.update();f.advance(5000);assert.equal(f.viewport.scrollTop,0);
});
