(function(){
  'use strict';
  var C=window.HuntCore,container=document.getElementById('hunt-view'),overlay=document.body.classList.contains('overlay-body'),params=new URLSearchParams(location.hash.slice(1)),token=params.get('token')||'',revision='',lastState=null,lastPredictionWindows={},timer,failures=0,inFlight=false,overlayMotion=null;
  if(overlay&&new URLSearchParams(location.search).get('layout')==='compact')document.body.classList.add('compact');
  function esc(v){return C.escapeHtml(v);}
  function signed(v,currency){return(v>0?'+':'')+C.money(v,currency);}
  function dateText(value){var d=new Date(value+'T12:00:00');return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
  function status(hunt){return hunt.status==='complete'?'Completed':hunt.status==='opening'?'Opening bonuses':'Collecting bonuses';}
  function stateBadge(hunt){return'<span class="status-pill '+(hunt.status==='complete'?'complete':'')+'">'+status(hunt)+'</span>';}
  function metric(label,value,note){return'<div class="metric"><div class="metric-label">'+label+'</div><div class="metric-value">'+esc(value)+'</div>'+(note?'<div class="metric-note">'+esc(note)+'</div>':'')+'</div>';}
  function activeHunt(state){return state.hunts.find(function(h){return h.id===state.activeId;})||state.hunts[0];}
  function viewerHunts(state){
    return state.hunts.filter(function(h){return h.id===state.activeId||h.status==='complete';}).map(function(h,i){return {hunt:h,index:i};}).sort(function(a,b){
      if(a.hunt.id===state.activeId)return -1;if(b.hunt.id===state.activeId)return 1;
      return b.hunt.date.localeCompare(a.hunt.date)||a.index-b.index;
    }).map(function(item){return item.hunt;});
  }
  function cardNavigation(){
    var track=document.getElementById('hunt-cards');if(!track)return;
    var back=document.getElementById('hunts-back'),next=document.getElementById('hunts-next');
    back.disabled=track.scrollLeft<=2;next.disabled=track.scrollLeft+track.clientWidth>=track.scrollWidth-2;
    document.getElementById('hunt-card-controls').hidden=track.scrollWidth<=track.clientWidth+2;
  }
  function predictionWindow(hunt){
    var value=Object.prototype.hasOwnProperty.call(lastPredictionWindows,hunt.id)?lastPredictionWindows[hunt.id]:null;
    if(!value||typeof value.accepting!=='boolean')return null;
    var result={closedAt:typeof value.closedAt==='string'?value.closedAt:null,accepting:value.accepting};
    if(typeof value.windowId==='string')result.windowId=value.windowId;
    return result;
  }
  function renderViewer(state){
    var hunts=viewerHunts(state),requested=new URLSearchParams(location.hash.slice(1)).get('hunt');
    var hunt=hunts.find(function(h){return h.id===requested;})||hunts.find(function(h){return h.id===state.activeId;})||hunts[0];
    if(!hunt){showError('No hunts yet','The next hunt will appear here when it is ready.');return;}
    var oldTrack=document.getElementById('hunt-cards'),oldScroll=oldTrack?oldTrack.scrollLeft:0;
    var focused=document.activeElement,focusId=focused&&focused.getAttribute?focused.getAttribute('data-view-hunt'):null;
    var m=C.calculate(hunt),c=hunt.currency,complete=hunt.status==='complete',progress=m.total?m.opened/m.total*100:0;
    var cards=hunts.map(function(h){
      var s=C.calculate(h),done=h.status==='complete',selected=h.id===hunt.id;
      var direction=s.profit>0?'profit':s.profit<0?'loss':'even',windowInfo=predictionWindow(h);
      return '<a class="hunt-card '+direction+(selected?' selected':'')+'" href="#hunt='+encodeURIComponent(h.id)+'" data-view-hunt="'+esc(h.id)+'"'+(selected?' aria-current="true"':'')+' aria-controls="hunt-predictions hunt-detail">'+
        '<div class="hunt-card-top"><h2>'+esc(h.title)+'</h2>'+(h.id===state.activeId?'<span class="current-hunt-tag">Current</span>':'')+'</div>'+
        '<div class="hunt-card-meta"><time datetime="'+esc(h.date)+'">'+esc(dateText(h.date))+'</time><span class="hunt-card-state '+(done?'is-complete':'')+'">'+(done?'Finished':h.status==='opening'?'Opening':'Collecting')+'</span></div>'+
        '<dl class="hunt-card-summary"><div><dt>Start</dt><dd>'+esc(C.money(h.start,h.currency))+'</dd></div><div><dt>'+(done?'End balance':'Balance so far')+'</dt><dd>'+esc(C.money(s.endBalance,h.currency))+'</dd></div><div><dt>Average X</dt><dd>'+esc(C.x(s.averageX))+'</dd></div><div class="hunt-card-profit"><dt>P/L</dt><dd>'+esc(signed(s.profit,h.currency))+'</dd></div></dl>'+
        '<div class="hunt-card-link"><span>'+(windowInfo?windowInfo.accepting?'Predictions open':'Predictions closed':s.opened+' / '+s.total+' opened')+'</span><span>'+(selected?'Selected':'View hunt')+'</span></div></a>';
    }).join('');
    var rows=hunt.rows.map(function(r,i){
      var opened=r.payout!==null&&r.payout!==undefined,mult=opened&&r.bet>0?r.payout/r.bet:null,next=m.next&&m.next.id===r.id;
      return '<tr class="'+(next?'next-row':'')+(opened&&r.payout===0?' zero-payout':'')+'"><td>'+String(i+1).padStart(2,'0')+'</td><td><span class="slot-name">'+esc(r.slot||'Unnamed slot')+'</span>'+(next?'<span class="next-label">Next to open</span>':'')+'</td><td>'+esc(C.money(r.bet,c))+'</td><td class="'+(opened?'':'unopened')+'">'+(opened?esc(C.x(mult)):'—')+'</td><td class="'+(opened?(r.payout>0?'positive':'zero-return'):'unopened')+'">'+(opened?esc(C.money(r.payout,c)):'Unopened')+'</td></tr>';
    }).join('');
    var highest=hunt.rows.filter(function(r){return r.payout!==null&&r.payout!==undefined&&r.bet>0;}).sort(function(a,b){return b.payout/b.bet-a.payout/a.bet;})[0];
    var percentReturn=hunt.start>0?(m.profit/hunt.start*100):null;
    var predictionPanel=document.getElementById('hunt-predictions');
    var predictionFocus=predictionPanel&&predictionPanel.contains&&predictionPanel.contains(focused)?focused:null;
    var predictionSelection=predictionFocus&&typeof predictionFocus.selectionStart==='number'?[predictionFocus.selectionStart,predictionFocus.selectionEnd]:null;
    if(predictionPanel&&predictionPanel.remove)predictionPanel.remove();
    container.innerHTML='<h1 class="sr-only">Hunt archive</h1>'+
      '<section class="hunt-picker" aria-label="Hunts"><div class="hunt-selector-row"><nav class="hunt-cards" id="hunt-cards" aria-label="Select a hunt">'+cards+'</nav><div class="hunt-card-controls" id="hunt-card-controls"><button type="button" id="hunts-back" aria-label="Previous hunts">‹</button><button type="button" id="hunts-next" aria-label="More hunts">›</button></div></div></section>'+
      '<section id="hunt-predictions" aria-label="End balance predictions"></section>'+
      '<p id="sync-label" class="viewer-sync" role="status"'+(failures>0?'>Reconnecting. Showing the last saved results.':' hidden>')+'</p>'+
      '<section class="hunt-detail" id="hunt-detail" aria-labelledby="hunt-detail-title"><div class="hunt-detail-heading"><div><div class="hunt-detail-kicker"><span class="eyebrow">HUNT BREAKDOWN</span><time datetime="'+esc(hunt.date)+'">'+esc(dateText(hunt.date))+'</time></div><h2 id="hunt-detail-title" tabindex="-1">'+esc(hunt.title)+'</h2></div>'+stateBadge(hunt)+'</div>'+
      '<div class="hunt-result-panel"><div class="hunt-balance-pair"><div><span>Starting balance</span><strong>'+esc(C.money(hunt.start,c))+'</strong></div><span class="balance-direction" aria-hidden="true">→</span><div><span>'+(complete?'End balance':'Balance so far')+'</span><strong>'+esc(C.money(m.endBalance,c))+'</strong></div></div><div class="hunt-result-total '+(m.profit<0?'is-loss':m.profit>0?'is-profit':'is-even')+'"><span>'+(complete?'Final profit / loss':'Profit / loss so far')+'</span><strong>'+esc(signed(m.profit,c))+'</strong><small>'+(percentReturn!==null?esc((percentReturn>0?'+':'')+percentReturn.toFixed(1)+'%')+' on starting balance':complete?'Hunt completed':'Hunt in progress')+'</small></div></div>'+
      '<div class="hunt-detail-metrics">'+metric('Bonuses opened',m.opened+' / '+m.total)+metric('Average X',C.x(m.averageX))+metric('Highest X',C.x(m.highestX))+metric('Required X',C.x(m.requiredX))+'</div>'+
      '<div class="hunt-breakdown-grid"><section class="bonus-ledger" aria-labelledby="bonus-list-title"><div class="bonus-ledger-heading"><div><span class="eyebrow">THE COLLECTED BONUSES</span><h3 id="bonus-list-title">The bonus list <span>'+m.total+'</span></h3></div><span class="opened-count">'+m.opened+' of '+m.total+' opened</span></div><div class="ledger-progress" role="progressbar" aria-label="Bonuses opened" aria-valuemin="0" aria-valuemax="'+Math.max(1,m.total)+'" aria-valuenow="'+m.opened+'"><div style="width:'+progress+'%"></div></div>'+
      (rows?'<div class="bonus-table-wrap"><table class="viewer-table"><caption class="sr-only">'+esc(hunt.title)+' bonus results</caption><thead><tr><th scope="col">#</th><th scope="col">Slot</th><th scope="col">Bet</th><th scope="col">X</th><th scope="col">Payout</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="hunt-empty"><span aria-hidden="true">◇</span><h3>The list is just getting started.</h3><p>Collected bonuses will appear here as they are added.</p></div>')+'</section>'+
      '<aside class="hunt-highlights" aria-label="Hunt highlights"><div class="hunt-highlight best-win"><div class="highlight-icon" aria-hidden="true">↗</div><span class="eyebrow">BIGGEST PAYOUT</span><strong class="highlight-amount">'+(m.best?esc(C.money(m.best.payout,c)):'—')+'</strong><h3>'+esc(m.best?m.best.slot:'No payouts yet')+'</h3><span class="highlight-note">'+(m.best?esc(C.x(m.best.x))+' multiplier':'The best win will appear here.')+'</span></div>'+
      (complete?'<div class="hunt-highlight"><span class="eyebrow">HIGHEST MULTIPLIER</span><strong class="highlight-amount">'+esc(C.x(m.highestX))+'</strong><h3>'+esc(highest?highest.slot||'Unnamed slot':'No opened bonuses')+'</h3><span class="highlight-note">'+(highest?'From a '+esc(C.money(highest.bet,c))+' bet':'No result recorded.')+'</span></div>':'<div class="hunt-highlight"><span class="eyebrow">'+(m.next?'NEXT TO OPEN':'ALL BONUSES OPENED')+'</span><h3 class="next-slot-name">'+esc(m.next?m.next.slot||'Unnamed slot':m.total?'Ready to finish':'Waiting for the first bonus')+'</h3><span class="highlight-note">'+(m.next?esc(C.money(m.next.bet,c))+' bet':m.total?'Every payout has been recorded.':'The next slot will appear here.')+'</span></div>')+'</aside></div></section>';
    var track=document.getElementById('hunt-cards');track.scrollLeft=oldScroll;track.addEventListener('scroll',cardNavigation,{passive:true});cardNavigation();
    if(focusId){var link=Array.from(track.querySelectorAll('[data-view-hunt]')).find(function(a){return a.getAttribute('data-view-hunt')===focusId;});if(link)link.focus({preventScroll:true});}
    var predictionSlot=document.getElementById('hunt-predictions');
    if(predictionPanel&&predictionSlot&&predictionSlot.replaceWith)predictionSlot.replaceWith(predictionPanel);
    if(predictionFocus){predictionFocus.focus({preventScroll:true});if(predictionSelection&&predictionFocus.setSelectionRange)predictionFocus.setSelectionRange(predictionSelection[0],predictionSelection[1]);}
    if(document.dispatchEvent&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('hunt:view',{detail:{hunt:{id:hunt.id,title:hunt.title,status:hunt.status,currency:hunt.currency},activeId:state.activeId,revision:revision,predictionWindow:predictionWindow(hunt)}}));
  }

  function renderOverlay(state){
    var h=activeHunt(state);
    if(!h){showError('Waiting for a hunt','Create your first hunt in the admin area.');return;}
    var m=C.calculate(h),c=h.currency,progress=m.total?m.opened/m.total*100:0;
    if(!container.querySelector('[data-overlay-panel]')){
      if(overlayMotion)overlayMotion.destroy();
      container.innerHTML='<section class="overlay-card" data-overlay-panel>'+
        '<header class="overlay-heading"><h1 class="overlay-wordmark">THOR’S HALL</h1>'+
        '<div class="overlay-bonus-progress"><div class="overlay-bonus-progress-labels"><span id="overlay-bonus-total"></span><strong id="overlay-bonus-opened"></strong></div>'+
        '<div class="overlay-bonus-progress-track" id="overlay-bonus-progress" role="progressbar" aria-label="Bonuses opened" aria-valuemin="0"><div class="overlay-bonus-progress-fill" id="overlay-progress-bar"></div></div></div></header>'+
        '<section class="overlay-balances" aria-label="Hunt balances"><div class="overlay-balance-panel"><div class="overlay-total-label">Starting balance</div><div class="overlay-balance-value" id="overlay-start"></div></div>'+
        '<div class="overlay-balance-panel is-end"><div class="overlay-total-label">End balance</div><div class="overlay-balance-value" id="overlay-balance"></div></div></section>'+
        '<div class="overlay-net"><strong id="overlay-profit"></strong><span>P/L</span></div>'+
        '<section class="overlay-stats" aria-label="Hunt totals">'+
        '<div class="overlay-stat"><span>Required X</span><strong id="overlay-required"></strong></div>'+
        '<div class="overlay-stat"><span>Average X</span><strong id="overlay-average"></strong></div></section>'+
        '<section class="overlay-slot-section" aria-label="Collected slots">'+
        '<div class="overlay-list-caption"><span>The bonus hunt</span><span class="overlay-list-mode" id="overlay-list-mode"></span></div>'+
        '<div class="overlay-slot-columns" aria-hidden="true"><span>#</span><span>Slot</span><span>Bet</span><span>Win</span><span>X</span></div>'+
        '<div class="overlay-slots-viewport" id="overlay-slots-viewport" role="list" aria-label="Collected bonuses"><div id="overlay-slot-rows"></div></div></section>'+
        '<footer class="overlay-foot">'+
        '<div class="overlay-footer-mark">The hall of legends</div></footer></section>';
      overlayMotion=window.HuntOverlayMotion.create({viewport:document.getElementById('overlay-slots-viewport'),rowHeight:44,visibleRows:8,pixelsPerSecond:12,pauseMs:2000});
    }
    function text(id,value){document.getElementById(id).textContent=value;}
    text('overlay-balance',C.money(m.endBalance,c));text('overlay-start',C.money(h.start,c));
    text('overlay-profit',signed(m.profit,c));document.getElementById('overlay-profit').classList.toggle('negative',m.profit<0);
    text('overlay-required',C.x(m.requiredX));text('overlay-average',C.x(m.averageX));
    text('overlay-bonus-total',m.total+' '+(m.total===1?'bonus':'bonuses'));text('overlay-bonus-opened',m.opened+' opened');
    var bonusProgress=document.getElementById('overlay-bonus-progress');
    bonusProgress.setAttribute('aria-valuemax',Math.max(1,m.total));bonusProgress.setAttribute('aria-valuenow',m.opened);
    bonusProgress.setAttribute('aria-valuetext',m.opened+' of '+m.total+' bonuses opened');
    document.getElementById('overlay-progress-bar').style.width=progress+'%';
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
    text('overlay-list-mode',h.status==='complete'?'Hunt complete':motion.mode==='following'?'Opening bonuses':'Collecting bonuses');
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
  function showError(title,message,login){if(!overlay&&document.dispatchEvent&&typeof CustomEvent==='function')document.dispatchEvent(new CustomEvent('hunt:unavailable'));if(overlayMotion){overlayMotion.destroy();overlayMotion=null;}container.innerHTML=overlay?'<div class="overlay-error">'+esc(title)+'<p>'+esc(message)+'</p></div>':'<div class="access-screen"><div><span class="eyebrow">Thor’s Hall · Bonus hunts</span><h1>'+esc(title)+'</h1><p>'+esc(message)+'</p>'+(login?'<a class="button primary" href="/.netlify/functions/stats-session?return=%2Fadmin%3Fview%3Dhunts">Open admin</a>':'')+'</div></div>';fitOverlay();}
  async function poll(){
    if(inFlight)return;clearTimeout(timer);var interval=overlay?3000:5000;
    if(overlay&&!token){showError('Connect your stream overlay','Copy the OBS link from the hunt manager in /admin.');return;}
    var controller=new AbortController(),abortTimer=setTimeout(function(){controller.abort();},15000);inFlight=true;
    try{
      var response=await fetch('/.netlify/functions/bonus-hunts-api?mode='+(overlay?'overlay':'viewer'),{signal:controller.signal,credentials:overlay?'omit':'same-origin',cache:'no-store',headers:overlay?{Authorization:'Bearer '+token}:{}});
      if(response.status===401||response.status===403){lastState=null;lastPredictionWindows={};revision='';showError(overlay?'Stream link unavailable':'This hunt is private',overlay?'Copy the current OBS link from your admin area.':'Sign in as the owner to preview the hunt.',!overlay);interval=15000;return;}
      var data=await response.json();if(!response.ok||!data.ok)throw new Error('Unable to load hunt');
      if(data.revision!==revision||!lastState){lastState=data.state;lastPredictionWindows=data.predictionWindows&&typeof data.predictionWindows==='object'?data.predictionWindows:{};revision=data.revision;if(overlay)renderOverlay(data.state);else renderViewer(data.state);}
      failures=0;var label=document.getElementById('sync-label');if(label){label.textContent='';label.hidden=true;}
    }catch(error){failures++;if(!lastState)showError('Connecting to the hunt…','The tracker will retry automatically.');else{var label=document.getElementById('sync-label');if(label){label.textContent='Reconnecting. Showing the last saved results.';label.hidden=false;}}interval=Math.min(30000,interval*Math.pow(2,Math.min(failures,3)));}
    finally{clearTimeout(abortTimer);inFlight=false;timer=setTimeout(poll,interval);}
  }
  if(!overlay){
    container.addEventListener('click',function(event){
      var button=event.target.closest('#hunts-back, #hunts-next');
      if(button){var track=document.getElementById('hunt-cards');track.scrollBy({left:track.clientWidth*(button.id==='hunts-back'?-1:1),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;}
    });
    window.addEventListener('hashchange',function(){if(lastState)renderViewer(lastState);});
  }
  window.addEventListener('resize',function(){fitOverlay();if(!overlay)cardNavigation();});window.addEventListener('online',poll);document.addEventListener('visibilitychange',function(){if(!document.hidden)poll();});poll();
})();

