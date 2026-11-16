(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HuntCore=api;})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function amount(value){var n=Number(value);return Number.isFinite(n)?Math.max(0,n):0;}
  function id(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);}
  function createHunt(){return{id:id(),title:'Untitled hunt',date:new Date().toISOString().slice(0,10),currency:'USD',start:0,balance:0,status:'collecting',rows:[]};}
  function money(value,currency){var n=Number(value);try{return new Intl.NumberFormat('en-US',{style:'currency',currency:currency||'USD',maximumFractionDigits:2}).format(Number.isFinite(n)?n:0);}catch(e){return '$'+(Number.isFinite(n)?n:0).toFixed(2);}}
  function x(value){return value!==null&&Number.isFinite(value)?value.toFixed(2)+'x':'—';}
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function calculate(hunt){
    hunt=hunt||{};var rows=Array.isArray(hunt.rows)?hunt.rows:[],opened=rows.filter(function(r){return r.payout!==null&&r.payout!==undefined;}),remaining=rows.filter(function(r){return r.payout===null||r.payout===undefined;});
    var winnings=opened.reduce(function(a,r){return a+amount(r.payout);},0),totalBet=rows.reduce(function(a,r){return a+amount(r.bet);},0),remainingBet=remaining.reduce(function(a,r){return a+amount(r.bet);},0),endBalance=amount(hunt.balance)+winnings;
    var multipliers=opened.filter(function(r){return amount(r.bet)>0;}).map(function(r){return amount(r.payout)/amount(r.bet);}),need=Math.max(0,amount(hunt.start)-endBalance),best=null;
    opened.forEach(function(r){if(!best||amount(r.payout)>best.payout)best={slot:r.slot||'Unnamed slot',payout:amount(r.payout),x:amount(r.bet)>0?amount(r.payout)/amount(r.bet):null};});
    return{total:rows.length,opened:opened.length,remaining:remaining.length,totalBet:totalBet,remainingBet:remainingBet,winnings:winnings,endBalance:endBalance,profit:endBalance-amount(hunt.start),requiredX:need===0?0:remainingBet>0?need/remainingBet:null,averageX:multipliers.length?multipliers.reduce(function(a,n){return a+n;},0)/multipliers.length:null,best:best,highestX:multipliers.length?Math.max.apply(null,multipliers):null,next:remaining[0]||null,last:opened.length?opened[opened.length-1]:null};
  }
  return{calculate:calculate,money:money,x:x,escapeHtml:escapeHtml,createHunt:createHunt,id:id};
});

