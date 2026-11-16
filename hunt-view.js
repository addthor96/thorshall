(function(){
  'use strict';
  var C=window.HuntCore,container=document.getElementById('hunt-view'),overlay=document.body.classList.contains('overlay-body'),params=new URLSearchParams(location.hash.slice(1)),token=params.get('token')||'',revision='',lastState=null,timer,failures=0,inFlight=false,overlayMotion=null;
  if(overlay&&new URLSearchParams(location.search).get('layout')==='compact')document.body.classList.add('compact');
  function esc(v){return C.escapeHtml(v);}
  function signed(v,currency){return(v>0?'+':'')+C.money(v,currency);}
  function dateText(value){var d=new Date(value+'T12:00:00');return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
  function status(hunt){return hunt.status==='complete'?'Completed':hunt.status==='opening'?'Opening bonuses':'Collecting bonuses';}
  function stateBadge(hunt){return'<span class="status-pill '+(hunt.status==='complete'?'complete':'')+'">'+status(hunt)+'</span>';}
  function metric(label,value,note){return'<div class="metric"><div class="metric-label">'+label+'</div><div class="metric-value">'+esc(value)+'</div>'+(note?'<div class="metric-note">'+esc(note)+'</div>':'')+'</div>';}
  function activeHunt(state){return state.hunts.find(function(h){return h.id===state.activeId;})||state.hunts[0];}
  function renderViewer(state){
    var hunt=activeHunt(state);if(!hunt){showError('No hunt yet','The next hunt will appear here when it is ready.');return;}
    var m=C.calculate(hunt),currency=hunt.currency,percentage=m.total?Math.round(m.opened/m.total*100):0;
    var rows=hunt.rows.map(function(r,i){var opened=r.payout!==null,mult=opened&&r.bet>0?r.payout/r.bet:null,next=m.next&&m.next.id===r.id;return'<tr class="'+(next?'next-row':'')+'"><td>'+String(i+1).padStart(2,'0')+'</td><td><span class="slot-name">'+esc(r.slot||'Unnamed slot')+'</span>'+(next?'<span class="next-label">Up next</span>':'')+'</td><td>'+esc(C.money(r.bet,currency))+'</td><td class="'+(opened?'':'unopened')+'">'+(opened?esc(C.x(mult)):'—')+'</td><td class="'+(opened?'positive':'unopened')+'">'+(opened?esc(C.money(r.payout,currency)):'Waiting')+'</td></tr>';}).join('');
    var history=state.hunts.filter(function(h){return h.id!==hunt.id&&h.status==='complete';}).sort(function(a,b){return b.date.localeCompare(a.date);}).map(function(h){var s=C.calculate(h);return'<article class="history-card"><span class="eyebrow">'+esc(dateText(h.date))+'</span><h3>'+esc(h.title)+'</h3><span class="profit-badge '+(s.profit<0?'negative':'')+'">'+esc(signed(s.profit,h.currency))+'</span><div class="history-values"><div>Start<strong>'+esc(C.money(h.start,h.currency))+'</strong></div><div>End balance<strong>'+esc(C.money(s.endBalance,h.currency))+'</strong></div><div>Avg X<strong>'+esc(C.x(s.averageX))+'</strong></div></div></article>';}).join('');
    container.innerHTML='<div class="intro" style="margin-bottom:22px"><div><div class="kicker-row">'+stateBadge(hunt)+'<span class="muted" style="font-size:12px">'+esc(dateText(hunt.date))+'</span></div><h1>'+esc(hunt.title)+'</h1></div><span class="sync-status" id="sync-label">Live updates</span></div>'+
      '<section class="hunt-hero" aria-label="Hunt balance"><div><div class="metric-label">End balance</div><div class="hero-number">'+esc(C.money(m.endBalance,currency))+'</div><div class="hero-result"><span class="profit-badge '+(m.profit<0?'negative':'')+'">'+esc(signed(m.profit,currency))+'</span><span class="muted" style="font-size:12px">profit / loss</span></div></div><div class="hero-target"><div><div class="metric-label">Starting balance</div><strong>'+esc(C.money(hunt.start,currency))+'</strong></div><p>Unspent balance '+esc(C.money(hunt.balance,currency))+'</p></div></section>'+
      '<section class="metrics viewer-metrics" aria-label="Hunt statistics">'+metric('Required X',C.x(m.requiredX))+metric('Average X',C.x(m.averageX))+metric('Bonuses',m.opened+' / '+m.total)+metric('Highest X',C.x(m.highestX))+'</section>'+
      '<div class="viewer-content"><section class="panel"><div class="panel-head"><h2>The bonus list</h2><span class="muted" style="font-size:12px">'+m.remaining+' remaining</span></div><div class="progress-head"><span>'+m.opened+' bonuses opened</span><span>'+percentage+'%</span></div><div class="progress-track" role="progressbar" aria-label="Bonuses opened" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percentage+'"><div class="progress-fill" style="width:'+percentage+'%"></div></div>'+(rows?'<table class="viewer-table"><thead><tr><th>#</th><th>Slot</th><th>Bet</th><th>X</th><th>Payout</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="empty-state">Bonuses will appear as they are added to this hunt.</div>')+'</section><aside class="stack viewer-aside"><div class="spotlight"><span class="eyebrow">Up next</span><h3>'+esc(m.next?m.next.slot||'Unnamed slot':m.total?'All bonuses opened':'Waiting for bonuses')+'</h3>'+(m.next?'<div class="spot-value" style="margin-top:12px">'+esc(C.money(m.next.bet,currency))+' <small class="muted">bet</small></div>':'')+'</div><div class="spotlight"><span class="eyebrow">Best payout</span><h3>'+esc(m.best?m.best.slot:'—')+'</h3><div class="spot-value positive">'+(m.best?esc(C.money(m.best.payout,currency)):'—')+'</div><span class="muted" style="font-size:12px">'+(m.best?esc(C.x(m.best.x)):'No opened bonuses')+'</span></div></aside></div>'+
      (history?'<section class="history-section"><h2>Past hunts</h2><div class="history-list">'+history+'</div></section>':'');
  }
  function renderOverlay(state){
    var h=activeHunt(state);
    if(!h){showError('Waiting for a hunt','Create your first hunt in the admin area.');return;}
    var m=C.calculate(h),c=h.currency,progress=m.total?Math.round(m.opened/m.total*100):0;
    if(!container.querySelector('[data-overlay-panel]')){
      if(overlayMotion)overlayMotion.destroy();
      container.innerHTML='<section class="overlay-card" data-overlay-panel>'+
        '<div class="overlay-stage" id="overlay-stage"></div>'+
        '<header class="overlay-heading"><h1 class="overlay-wordmark">THOR’S HALL</h1><p class="overlay-hunt-name" id="overlay-title"></p></header>'+
        '<div class="overlay-total"><div class="overlay-total-label">End balance</div><div class="overlay-balance" id="overlay-balance"></div>'+
        '<div class="overlay-total-line"><strong id="overlay-profit"></strong><i class="overlay-divider"></i><span id="overlay-start"></span></div></div>'+
        '<section class="overlay-stats" aria-label="Hunt totals">'+
        '<div class="overlay-stat"><span>Required X</span><strong id="overlay-required"></strong></div>'+
        '<div class="overlay-stat"><span>Average X</span><strong id="overlay-average"></strong></div>'+
        '<div class="overlay-stat"><span>Bonuses</span><strong id="overlay-count"></strong></div></section>'+
        '<section class="overlay-slot-section" aria-label="Collected slots">'+
        '<div class="overlay-list-caption"><span>The bonus hunt</span><span class="overlay-list-mode" id="overlay-list-mode"></span></div>'+
        '<div class="overlay-slot-columns" aria-hidden="true"><span>#</span><span>Slot</span><span>Bet</span><span>Win</span><span>X</span></div>'+
        '<div class="overlay-slots-viewport" id="overlay-slots-viewport" role="list" aria-label="Collected bonuses"><div id="overlay-slot-rows"></div></div></section>'+
        '<footer class="overlay-foot"><div class="overlay-foot-line"><span class="sync-status" id="sync-label">Live updates</span><span id="overlay-progress"></span></div>'+
        '<div class="progress-track"><div class="progress-fill" id="overlay-progress-bar"></div></div><div class="overlay-footer-mark">The hall of legends</div></footer></section>';
      overlayMotion=window.HuntOverlayMotion.create({viewport:document.getElementById('overlay-slots-viewport'),rowHeight:44,visibleRows:8,pixelsPerSecond:12,pauseMs:2500});
    }
    function text(id,value){document.getElementById(id).textContent=value;}
    text('overlay-stage',status(h));text('overlay-title',h.title);text('overlay-balance',C.money(m.endBalance,c));text('overlay-start','Start '+C.money(h.start,c));
    text('overlay-profit',signed(m.profit,c)+' P/L');document.getElementById('overlay-profit').classList.toggle('negative',m.profit<0);
    text('overlay-required',C.x(m.requiredX));text('overlay-average',C.x(m.averageX));text('overlay-count',m.opened+' / '+m.total);
    text('overlay-progress',progress+'%');document.getElementById('overlay-progress-bar').style.width=progress+'%';
    var viewport=document.getElementById('overlay-slots-viewport'),priorScroll=viewport.scrollTop;
    viewport.style.setProperty('--slot-count',Math.max(2,Math.min(8,h.rows.length)));
    document.getElementById('overlay-slot-rows').innerHTML=h.rows.length?h.rows.map(function(row,i){
      var opened=row.payout!==null&&row.payout!==undefined,mult=opened&&row.bet>0?row.payout/row.bet:null,isNext=m.next&&m.next.id===row.id;
      return '<div role="listitem" class="overlay-slot-row'+(opened?' is-opened':'')+(opened&&row.payout===0?' is-bust':'')+(isNext?' is-next':'')+'" data-slot-id="'+esc(row.id)+'">'+
        '<span class="overlay-slot-number">'+String(i+1).padStart(2,'0')+'</span><span class="overlay-slot-name">'+esc(row.slot||'Unnamed slot')+'</span>'+
        '<span class="overlay-slot-bet">'+esc(C.money(row.bet,c))+'</span><span class="overlay-slot-payout">'+(opened?esc(C.money(row.payout,c)):'—')+'</span>'+
        '<span class="overlay-slot-x">'+(opened?esc(C.x(mult)):'—')+'</span></div>';
    }).join(''):'<div class="overlay-list-empty">Waiting for the first bonus…</div>';
    viewport.scrollTop=priorScroll;
    var motion=overlayMotion.update(h);viewport.dataset.motion=motion.mode;
    text('overlay-list-mode',motion.mode==='browsing'?'Collected slots':h.status==='complete'?'Hunt complete':motion.mode==='following'?'Opening bonuses':'Collecting bonuses');
    if(motion.focusId!==null){
      Array.from(document.querySelectorAll('[data-slot-id]')).forEach(function(row){row.classList.toggle('is-focused',row.dataset.slotId===motion.focusId);});
    }
    fitOverlay();
  }
  function fitOverlay(){
    if(!overlay)return;
    var naturalHeight=container.offsetHeight||960,scale=Math.min(1,window.innerWidth/520,window.innerHeight/naturalHeight);
    container.style.transform='scale('+scale+')';container.style.marginLeft=Math.max(0,(window.innerWidth-520*scale)/2)+'px';
  }
  function showError(title,message,login){if(overlayMotion){overlayMotion.destroy();overlayMotion=null;}container.innerHTML=overlay?'<div class="overlay-error">'+esc(title)+'<p>'+esc(message)+'</p></div>':'<div class="access-screen"><div><span class="eyebrow">Thor’s Hall · Bonus hunts</span><h1>'+esc(title)+'</h1><p>'+esc(message)+'</p>'+(login?'<a class="button primary" href="/.netlify/functions/stats-session?return=%2Fadmin%3Fview%3Dhunts">Open admin</a>':'')+'</div></div>';fitOverlay();}
  async function poll(){
    if(inFlight)return;clearTimeout(timer);var interval=overlay?3000:5000;
    if(overlay&&!token){showError('Connect your stream overlay','Copy the OBS link from the hunt manager in /admin.');return;}
    var controller=new AbortController(),abortTimer=setTimeout(function(){controller.abort();},15000);inFlight=true;
    try{
      var response=await fetch('/.netlify/functions/bonus-hunts-api?mode='+(overlay?'overlay':'viewer'),{signal:controller.signal,credentials:overlay?'omit':'same-origin',cache:'no-store',headers:overlay?{Authorization:'Bearer '+token}:{}});
      if(response.status===401||response.status===403){lastState=null;revision='';showError(overlay?'Stream link unavailable':'This hunt is private',overlay?'Copy the current OBS link from your admin area.':'Sign in as the owner to preview the hunt.',!overlay);interval=15000;return;}
      var data=await response.json();if(!response.ok||!data.ok)throw new Error('Unable to load hunt');
      if(data.revision!==revision||!lastState){lastState=data.state;revision=data.revision;if(overlay)renderOverlay(data.state);else renderViewer(data.state);}
      failures=0;var label=document.getElementById('sync-label');if(label){label.textContent='Live updates';label.classList.remove('offline');}
    }catch(error){failures++;if(!lastState)showError('Connecting to the hunt…','The tracker will retry automatically.');else{var label=document.getElementById('sync-label');if(label){label.textContent='Reconnecting…';label.classList.add('offline');}}interval=Math.min(30000,interval*Math.pow(2,Math.min(failures,3)));}
    finally{clearTimeout(abortTimer);inFlight=false;timer=setTimeout(poll,interval);}
  }
  window.addEventListener('resize',fitOverlay);window.addEventListener('online',poll);document.addEventListener('visibilitychange',function(){if(!document.hidden)poll();});poll();
})();

