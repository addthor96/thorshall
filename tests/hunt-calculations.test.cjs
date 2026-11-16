'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../hunt-shared');
test('remaining Required X includes unspent cash and counts a zero payout as opened',()=>{
  const h={start:5000,balance:250,rows:[{id:'a',slot:'A',bet:10,payout:1250},{id:'b',slot:'B',bet:20,payout:0},{id:'c',slot:'C',bet:25,payout:null}]};
  const m=core.calculate(h);assert.equal(m.endBalance,1500);assert.equal(m.profit,-3500);assert.equal(m.requiredX,140);assert.equal(m.averageX,62.5);assert.equal(m.opened,2);assert.equal(m.remaining,1);assert.equal(m.highestX,125);assert.equal(m.next.slot,'C');assert.equal(m.best.slot,'A');assert.equal(core.money(m.profit,'USD'),'-$3,500.00');
});
test('completed profitable and losing hunts handle no remaining bets without infinity',()=>{
  let h={start:1000,balance:0,rows:[{bet:2,payout:1200}]};assert.equal(core.calculate(h).requiredX,0);assert.equal(core.calculate(h).profit,200);
  h.rows[0].payout=100;assert.equal(core.calculate(h).requiredX,null);assert.equal(core.calculate(h).profit,-900);
  h.rows[0].bet=0;assert.equal(core.calculate(h).averageX,null);assert.equal(core.calculate(h).highestX,null);
});

