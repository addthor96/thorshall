(function () {
  'use strict';
  const Core=window.HuntCore,API='/.netlify/functions/bonus-hunts-api',DRAFT_KEY='thorshall_hunt_admin_draft_v2';
  const $=id=>document.getElementById(id),copy=value=>JSON.parse(JSON.stringify(value)),esc=value=>Core.escapeHtml(String(value==null?'':value));
  let state,revision,streamToken='',dirty=false,saving=false,blocked=false,timer,editVersion=0,toastTimer,recoveredDraft=null;
  let activeSave=null,lastSaveFailed=false,pendingAction=null,actionBusy=false,rotationBusy=false,rotating=false,editingId=null,payoutRowId=null;
  const current=()=>state.hunts.find(h=>h.id===state.activeId)||state.hunts[0];
  const opened=row=>row.payout!==null&&row.payout!==undefined;
  const value=input=>Math.max(0,Math.min(100000000,Number(input.value)||0));
  function status(text,type){$('saveStatus').textContent=text;$('saveStatus').dataset.state=type;}
  function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),3500);}
  function preserveDraft(){try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify({state,revision}));}catch(_){}}
  function clearDraft(){try{sessionStorage.removeItem(DRAFT_KEY);}catch(_){}}
  function hideError(){$('errorNotice').classList.add('hidden');['retrySave','reloadRemote','loginAgain'].forEach(id=>$(id).classList.add('hidden'));}
  function error(message,type){
    $('errorText').textContent=message;$('errorNotice').classList.remove('hidden');$('exportDraft').disabled=!state;
    ['retrySave','reloadRemote','loginAgain'].forEach(id=>$(id).classList.add('hidden'));
    $(type==='session'?'loginAgain':type==='conflict'?'reloadRemote':'retrySave').classList.remove('hidden');
    status(type==='conflict'?'Another saved version exists':'Changes not saved','error');
  }
  async function request(method,body){
    const response=await fetch(API+(method==='GET'?'?mode=admin':''),{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers:method==='GET'?{}:{'Content-Type':'application/json','X-Thorshall-Request':'bonus-hunts'},body:body?JSON.stringify(body):undefined});
    let data;try{data=await response.json();}catch(_){data={};}
    if(!response.ok||!data.ok){const err=new Error(data.error||'Could not connect. Your draft is kept in this browser tab.');err.status=response.status;throw err;}return data;
  }
  function controls(){
    if(!state)return;
    const locked=blocked||actionBusy||rotationBusy||!!pendingAction,h=current(),all=h.rows.length>0&&h.rows.every(opened);
    ['newSlotName','newSlotBet','addBonus','cancelBonusEdit','payoutAmount','savePayout','previousBonus','nextBonus','startOpening','editCollection','reviewHunt','huntSelect','renameHunt','duplicateHunt','deleteHunt','huntStart','huntCurrency','huntTitle','huntDate','huntBalance','importData','importFile','importLegacy','restoreDraft','togglePublic','rotateToken'].forEach(id=>$(id).disabled=locked);
    $('startOpening').disabled=locked||h.rows.length===0;
    $('finishHunt').disabled=locked||!all;
    $('newHunt').disabled=locked||state.hunts.length>=50;$('newHuntAfterFinish').disabled=locked||state.hunts.length>=50;
    $('saveNow').disabled=!dirty||blocked||saving;
    const index=h.rows.findIndex(r=>r.id===payoutRowId);
    $('previousBonus').disabled=locked||index<=0;$('nextBonus').disabled=locked||index<0||index>=h.rows.length-1;
  }
  function change(){dirty=true;editVersion++;preserveDraft();status('Unsaved changes','dirty');clearTimeout(timer);if(!blocked)timer=setTimeout(save,900);renderMetrics();controls();}
  function save(){
    if(rotating)return Promise.resolve(false);
    if(activeSave)return activeSave;
    activeSave=saveInternal().finally(()=>{activeSave=null;});
    return activeSave;
  }
  async function saveInternal(){
    clearTimeout(timer);if(!state||!dirty||blocked)return !dirty&&!blocked;
    const version=editVersion,submitted=copy(state);saving=true;lastSaveFailed=false;status('Saving…','saving');controls();
    try{
      const data=await request('PUT',{state:submitted,revision});revision=data.revision;
      if(version===editVersion){state=data.state||submitted;dirty=false;clearDraft();status('All changes saved','saved');}
      else{preserveDraft();status('Unsaved changes','dirty');}
      hideError();
    }catch(err){
      lastSaveFailed=true;preserveDraft();
      if(err.status===401||err.status===403){blocked=true;error('Your owner session has expired. Sign in again; your draft is kept in this tab.','session');}
      else if(err.status===409||err.status===412){blocked=true;error('Another tab saved this hunt first. Download your draft before loading the latest saved version.','conflict');}
      else error(err.message,'network');
    }finally{saving=false;controls();}
    if(dirty&&!blocked&&version!==editVersion)timer=setTimeout(save,500);
    return !dirty&&!blocked;
  }
  async function flushSave(){
    clearTimeout(timer);if(blocked||rotating)return false;
    if(activeSave){await activeSave;if(lastSaveFailed)return false;}
    while(dirty&&!blocked){await save();if(lastSaveFailed)return false;}
    return !dirty&&!blocked;
  }
  function fillDetails(){
    const h=current();$('huntTitle').value=h.title;$('huntDate').value=h.date;$('huntStart').value=h.start||'';$('huntBalance').value=h.balance||'';$('huntCurrency').value=h.currency;
  }
  function renderLibrary(){
    $('huntSelect').innerHTML=state.hunts.map(h=>'<option value="'+esc(h.id)+'">'+esc(h.title||'Untitled hunt')+' · '+esc(h.date)+'</option>').join('');
    $('huntSelect').value=state.activeId;$('huntCount').textContent=state.hunts.length+' / 50';
  }
  function renderMetrics(){
    if(!state)return;const h=current(),m=Core.calculate(h),c=h.currency;
    $('liveMetrics').innerHTML=[['End balance',Core.money(m.endBalance,c),''],['Profit / loss',(m.profit>0?'+':'')+Core.money(m.profit,c),m.profit>=0?'positive':'negative'],['Required X',Core.x(m.requiredX),''],['Average X',Core.x(m.averageX),'']].map(a=>'<div class="metric"><span class="metric-label">'+a[0]+'</span><strong class="metric-value '+a[2]+'">'+a[1]+'</strong></div>').join('');
    $('bonusCount').textContent=m.total+' bonuses · '+m.opened+' opened';$('collectionCount').textContent=m.total+' collected';
  }
  function resetEntry(){editingId=null;$('newSlotName').value='';$('addBonus').textContent='+ Add bonus';$('cancelBonusEdit').hidden=true;$('entryError').hidden=true;}
  function renderCollected(){
    const h=current();$('collectedBonuses').innerHTML=h.rows.map((r,i)=>'<article class="collected-bonus"><span class="collected-number">'+String(i+1).padStart(2,'0')+'</span><div class="collected-name">'+esc(r.slot||'Unnamed slot')+(opened(r)?'<small>Opened · '+esc(Core.money(r.payout,h.currency))+'</small>':'')+'</div><strong class="collected-bet">'+esc(Core.money(r.bet,h.currency))+'</strong><div class="collected-actions"><button type="button" class="button subtle small" data-edit="'+esc(r.id)+'" aria-label="Edit bonus '+(i+1)+'">Edit</button><button type="button" class="button danger small" data-remove="'+esc(r.id)+'" aria-label="Remove bonus '+(i+1)+'">×</button></div></article>').join('');
    $('emptyRows').hidden=h.rows.length>0;$('startOpening').textContent=h.rows.some(opened)?'Continue opening bonuses →':'Start opening bonuses →';
  }
  function renderResults(){
    const h=current();$('openingResults').innerHTML=h.rows.map((r,i)=>'<button class="result-row'+(r.id===payoutRowId?' current':'')+'" type="button" data-open-row="'+esc(r.id)+'"><span class="result-number">'+String(i+1).padStart(2,'0')+'</span><span class="result-name">'+esc(r.slot||'Unnamed slot')+'</span><span class="result-payout'+(opened(r)?'':' unopened')+'">'+(opened(r)?esc(Core.money(r.payout,h.currency)):'Unopened')+'</span></button>').join('');
  }
  function renderOpening(){
    const h=current(),m=Core.calculate(h),remaining=h.rows.filter(r=>!opened(r));
    if(payoutRowId&&!h.rows.some(r=>r.id===payoutRowId))payoutRowId=null;
    if(!payoutRowId&&remaining.length)payoutRowId=remaining[0].id;
    const row=h.rows.find(r=>r.id===payoutRowId),index=row?h.rows.indexOf(row):-1,percent=m.total?m.opened/m.total*100:0;
    $('openingProgressText').textContent=m.opened+' of '+m.total+' opened';$('openingProgressPercent').textContent=Math.round(percent)+'%';$('openingProgressFill').style.width=percent+'%';
    $('payoutEditor').hidden=!row;$('allOpened').hidden=!!row||m.remaining>0;
    $('finishHint').textContent=m.remaining?m.remaining+' '+(m.remaining===1?'bonus left':'bonuses left')+' to open.':'All bonuses opened. Ready to finish.';
    if(row){$('payoutPosition').textContent='Bonus '+(index+1)+' of '+h.rows.length;$('payoutSlotName').textContent=row.slot||'Unnamed slot';$('payoutSlotBet').textContent='Bet '+Core.money(row.bet,h.currency);$('payoutAmount').value=opened(row)?row.payout:'';$('savePayout').textContent=opened(row)?'Save correction & next →':'Save payout & next →';}
    $('payoutError').hidden=true;renderResults();controls();
  }
  function renderPhase(){
    const h=current(),phase=h.status;
    $('collectionPhase').hidden=phase!=='collecting';$('openingPhase').hidden=phase!=='opening';$('completedPhase').hidden=phase!=='complete';$('huntSetup').hidden=phase!=='collecting';$('startOpening').hidden=phase!=='collecting';
    if(phase==='collecting')renderCollected();
    if(phase==='opening')renderOpening();
    if(phase==='complete'){const m=Core.calculate(h);$('completedSummary').textContent=h.rows.length+' bonuses · '+Core.money(m.endBalance,h.currency)+' end balance';$('completedProfit').textContent=(m.profit>0?'+':'')+Core.money(m.profit,h.currency)+' P/L';$('completedProfit').classList.toggle('positive',m.profit>=0);$('completedProfit').classList.toggle('negative',m.profit<0);}
    controls();
  }
  function renderVisibility(){const visible=state.settings.public;$('visibilityBadge').textContent=visible?'Public':'Private';$('visibilityText').textContent=visible?'Anyone can view /bonus-hunt.':'Only you can preview the hunt page.';$('togglePublic').textContent=visible?'Make hunt page private':'Make hunt page public';}
  function renderOverlay(){const url=location.origin+'/bonus-hunt-overlay#token='+encodeURIComponent(streamToken);$('overlayUrl').value=url;$('overlayPreview').src=url;}
  function renderAll(){fillDetails();renderLibrary();renderMetrics();renderPhase();renderVisibility();controls();}
  function completePending(){
    const action=pendingAction;if(!action)return;pendingAction=null;if(current().id!==action.huntId)return;
    if(action.kind==='payout'){const rows=current().rows,index=rows.findIndex(r=>r.id===action.rowId);const next=rows.slice(index+1).find(r=>!opened(r))||rows.find(r=>!opened(r));payoutRowId=next?next.id:null;renderMetrics();renderOpening();if(next)$('payoutAmount').focus();}
    else{payoutRowId=action.kind==='review'&&current().rows[0]?current().rows[0].id:null;fillDetails();renderPhase();if(current().status==='opening'&&payoutRowId)$('payoutAmount').focus();}
    toast(action.kind==='finish'?'Hunt finished and saved.':action.kind==='payout'?'Payout saved.':action.kind==='collection'?'Bonus list ready to edit.':'Opening mode ready.');
  }
  async function runPending(){
    if(actionBusy||blocked||!pendingAction)return false;actionBusy=true;controls();let completed=false;
    try{if(await flushSave()){completePending();completed=true;return true;}return false;}finally{actionBusy=false;controls();if(completed){if(current().status==='opening'&&payoutRowId)$('payoutAmount').focus();else if(current().status==='collecting')$('newSlotName').focus();else if(current().status==='complete')$('newHuntAfterFinish').focus();}}
  }
  function beginAction(action){if(actionBusy||pendingAction||blocked)return;pendingAction=action;change();runPending();}
  function newHunt(){
    if(!state||pendingAction||actionBusy||rotationBusy||blocked||state.hunts.length>=50)return;const h=Core.createHunt();h.title='Hunt #'+(state.hunts.length+1);state.hunts.unshift(h);state.activeId=h.id;payoutRowId=null;resetEntry();renderAll();change();$('newSlotName').focus();
  }
  function download(data,filename) { const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  function exportDraft() { download({schema:2,state,exportedAt:new Date().toISOString()},'thorshall-hunts-'+new Date().toISOString().slice(0,10)+'.json'); }
  function validateImport(data) {
    const s=data.state || data;
    if(s.schema!==2 || !Array.isArray(s.hunts) || !s.hunts.length || s.hunts.length>50)throw new Error('Choose a Thor’s Hall hunt backup.');
    for(const h of s.hunts) {
      if(!h || typeof h.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(h.id) || typeof h.title!=='string' || !h.title.trim() || h.title.length>80 || !/^\d{4}-\d{2}-\d{2}$/.test(h.date) || !['USD','EUR','GBP','CAD','AUD'].includes(h.currency) || !['collecting','opening','complete'].includes(h.status) || !Array.isArray(h.rows) || h.rows.length>150)throw new Error('This backup has invalid hunt details.');
      for(const n of [h.start,h.balance])if(!Number.isFinite(n)||n<0||n>100000000)throw new Error('This backup has an invalid balance.');
      for(const r of h.rows)if(!r || typeof r.id!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id) || typeof r.slot!=='string' || r.slot.length>80 || typeof r.provider!=='string' || r.provider.length>60 || !Number.isFinite(r.bet) || r.bet<0 || r.bet>100000000 || (r.payout!==null && (!Number.isFinite(r.payout)||r.payout<0||r.payout>100000000)))throw new Error('This backup has an invalid bonus.');
      if(new Set(h.rows.map(r=>r.id)).size!==h.rows.length)throw new Error('This backup contains duplicate bonus IDs.');
    }
    const ids=s.hunts.map(h=>h.id); if(new Set(ids).size!==ids.length)throw new Error('This backup contains duplicate hunts.');
    return {schema:2,activeId:ids.includes(s.activeId)?s.activeId:ids[0],hunts:copy(s.hunts),settings:{public:false}};
  }
  async function load(){
    try{
      const data=await request('GET');state=data.state;revision=data.revision;streamToken=data.streamToken||'';blocked=false;dirty=false;pendingAction=null;payoutRowId=null;editingId=null;
      $('manager').hidden=false;$('loadingState').hidden=true;status('All changes saved','saved');renderAll();renderOverlay();
      try{const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');if(draft&&draft.state&&JSON.stringify(draft.state)!==JSON.stringify(state)){recoveredDraft=draft;$('recoveryNotice').classList.remove('hidden');}}catch(_){}
      try{if(localStorage.getItem('thorshall_bonus_hunts_v1'))$('importLegacy').classList.remove('hidden');}catch(_){}
    }catch(err){$('loadingState').hidden=true;error(err.status===401?'Sign in with your owner password to open Hunt Manager.':err.message,err.status===401?'session':'network');}
  }
  [['huntTitle','title'],['huntDate','date'],['huntCurrency','currency'],['huntStart','start'],['huntBalance','balance']].forEach(([id,field])=>$(id).addEventListener('input',()=>{
    if(!state||pendingAction||rotationBusy)return;current()[field]=['start','balance'].includes(field)?value($(id)):$(id).value;if(['title','date'].includes(field))renderLibrary();if(field==='currency')renderCollected();change();
  }));
  $('slotEntryForm').addEventListener('submit',event=>{
    event.preventDefault();if(!state||pendingAction||rotationBusy||blocked||current().status!=='collecting')return;
    const slot=$('newSlotName').value.trim(),bet=Number($('newSlotBet').value);
    if(!slot||!Number.isFinite(bet)||bet<=0||bet>100000000){$('entryError').textContent='Enter a slot name and a bet greater than 0.';$('entryError').hidden=false;return;}
    if(editingId){const row=current().rows.find(r=>r.id===editingId);if(row){row.slot=slot;row.bet=Math.round(bet*100)/100;}}
    else{if(current().rows.length>=150){toast('This hunt already has 150 bonuses.');return;}current().rows.push({id:Core.id(),slot,provider:'',bet:Math.round(bet*100)/100,payout:null});}
    resetEntry();renderCollected();change();$('newSlotName').focus();
  });
  $('cancelBonusEdit').addEventListener('click',()=>{resetEntry();$('newSlotName').focus();});
  $('collectedBonuses').addEventListener('click',event=>{
    if(pendingAction||rotationBusy||blocked)return;const edit=event.target.closest('[data-edit]'),remove=event.target.closest('[data-remove]');
    if(edit){const row=current().rows.find(r=>r.id===edit.dataset.edit);if(!row)return;editingId=row.id;$('newSlotName').value=row.slot;$('newSlotBet').value=row.bet;$('addBonus').textContent='Save bonus';$('cancelBonusEdit').hidden=false;$('newSlotName').focus();}
    if(remove){const row=current().rows.find(r=>r.id===remove.dataset.remove);if(row&&opened(row)&&!confirm('Remove this bonus and its recorded payout?'))return;current().rows=current().rows.filter(r=>r.id!==remove.dataset.remove);if(editingId===remove.dataset.remove)resetEntry();renderCollected();change();}
  });
  $('startOpening').addEventListener('click',()=>{
    if(pendingAction||rotationBusy||blocked)return;const h=current();if(!h.rows.length||h.rows.some(r=>!r.slot.trim()||r.bet<=0)){ $('entryError').textContent='Add a valid slot name and bet to every bonus before opening.';$('entryError').hidden=false;return;}
    h.status='opening';beginAction({kind:'opening',huntId:h.id});
  });
  $('payoutForm').addEventListener('submit',event=>{
    event.preventDefault();if(pendingAction||rotationBusy||blocked||current().status!=='opening')return;
    const raw=$('payoutAmount').value.trim(),amount=Number(raw),row=current().rows.find(r=>r.id===payoutRowId);
    if(!row||raw===''||!Number.isFinite(amount)||amount<0||amount>100000000){$('payoutError').textContent='Enter the payout. Use 0 for a bonus that paid nothing.';$('payoutError').hidden=false;return;}
    row.payout=Math.round(amount*100)/100;$('payoutError').hidden=true;beginAction({kind:'payout',huntId:current().id,rowId:row.id});
  });
  $('openingResults').addEventListener('click',event=>{const button=event.target.closest('[data-open-row]');if(!button||pendingAction||rotationBusy||blocked)return;payoutRowId=button.dataset.openRow;renderOpening();$('payoutAmount').focus();});
  [['previousBonus',-1],['nextBonus',1]].forEach(([id,direction])=>$(id).addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked)return;const rows=current().rows,index=rows.findIndex(r=>r.id===payoutRowId),next=rows[index+direction];if(next){payoutRowId=next.id;renderOpening();$('payoutAmount').focus();}}));
  $('editCollection').addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked)return;const h=current();h.status='collecting';beginAction({kind:'collection',huntId:h.id});});
  $('finishHunt').addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked)return;const h=current();if(!h.rows.length||h.rows.some(r=>!opened(r)))return;h.status='complete';beginAction({kind:'finish',huntId:h.id});});
  $('reviewHunt').addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked)return;const h=current();h.status='opening';beginAction({kind:'review',huntId:h.id});});
  $('huntSelect').addEventListener('change',()=>{if(pendingAction||rotationBusy||blocked)return;state.activeId=$('huntSelect').value;payoutRowId=null;resetEntry();renderAll();change();});
  $('renameHunt').addEventListener('click',()=>{if(!state||pendingAction||actionBusy||rotationBusy||blocked)return;const input=$('huntTitle');input.scrollIntoView({block:'center'});input.focus({preventScroll:true});input.select();});
  $('newHunt').addEventListener('click',newHunt);$('newHuntAfterFinish').addEventListener('click',newHunt);
  $('duplicateHunt').addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked||state.hunts.length>=50)return;const h=copy(current());h.id=Core.id();h.title=(h.title+' copy').slice(0,80);h.rows.forEach(r=>r.id=Core.id());state.hunts.unshift(h);state.activeId=h.id;payoutRowId=null;resetEntry();renderAll();change();});
  $('deleteHunt').addEventListener('click',()=>{if(pendingAction||rotationBusy||blocked||!confirm('Delete “'+current().title+'” and its bonuses?'))return;state.hunts=state.hunts.filter(h=>h.id!==state.activeId);if(!state.hunts.length)state.hunts.push(Core.createHunt());state.activeId=state.hunts[0].id;payoutRowId=null;resetEntry();renderAll();change();});
  $('togglePublic').addEventListener('click',async()=>{if(pendingAction||rotationBusy||blocked)return;state.settings.public=!state.settings.public;renderVisibility();change();await save();});
  async function retryOrSave(){if(pendingAction)return runPending();return save();}
  $('saveNow').addEventListener('click',retryOrSave);
  $('retrySave').addEventListener('click',()=>{if(!state){load();return;}blocked=false;retryOrSave();});
  $('reloadRemote').addEventListener('click',async()=>{if(!confirm('Replace your unsaved draft with the saved version? Download your draft first if you need to keep it.'))return;clearDraft();hideError();pendingAction=null;await load();});
  $('restoreDraft').addEventListener('click',()=>{if(pendingAction||actionBusy||rotationBusy)return;try{state=validateImport(recoveredDraft.state);pendingAction=null;payoutRowId=null;renderAll();$('recoveryNotice').classList.add('hidden');change();toast('Draft restored. Saving your changes…');}catch(err){error(err.message,'network');}});
  $('discardDraft').addEventListener('click',()=>{clearDraft();$('recoveryNotice').classList.add('hidden');recoveredDraft=null;});
  $('copyOverlay').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('overlayUrl').value);toast('Overlay URL copied. Paste it into your Browser Source.');}catch(_){$('overlayUrl').type='text';$('overlayUrl').select();toast('Copy the selected overlay URL.');}});
  $('showOverlayUrl').addEventListener('click',()=>{const show=$('overlayUrl').type==='password';$('overlayUrl').type=show?'text':'password';$('showOverlayUrl').textContent=show?'Hide':'Show';$('showOverlayUrl').setAttribute('aria-pressed',String(show));});
  $('rotateToken').addEventListener('click',async()=>{
    if(pendingAction||actionBusy||rotationBusy||blocked)return;
    if(!confirm('Replace the overlay link? Your current OBS source will stop updating until you paste the new URL.'))return;
    rotationBusy=true;controls();
    try{
      if(!(await flushSave()))return;
      rotating=true;saving=true;clearTimeout(timer);status('Replacing overlay link…','saving');controls();
      const data=await request('POST',{action:'rotate-token',revision});streamToken=data.streamToken;if(data.revision!==undefined)revision=data.revision;renderOverlay();toast('New overlay link created. Update your OBS Browser Source.');
    }catch(err){
      if(err.status===409||err.status===412){blocked=true;error('Another tab changed this hunt. Load the latest saved version before replacing the overlay link.','conflict');}
      else if(err.status===401||err.status===403){blocked=true;error(err.message,'session');}
      else toast(err.message);
    }finally{rotating=false;saving=false;rotationBusy=false;if(!blocked){status(dirty?'Unsaved changes':'All changes saved',dirty?'dirty':'saved');if(dirty)timer=setTimeout(save,500);}controls();}
  });
  $('exportData').addEventListener('click',exportDraft);$('exportDraft').addEventListener('click',exportDraft);$('importData').addEventListener('click',()=>{if(!pendingAction&&!actionBusy&&!rotationBusy&&!blocked)$('importFile').click();});
  $('importFile').addEventListener('change',async()=>{if(pendingAction||actionBusy||rotationBusy||blocked)return;const file=$('importFile').files[0];if(!file)return;try{if(file.size>3000000)throw new Error('Choose a backup smaller than 3 MB.');const imported=validateImport(JSON.parse(await file.text()));if(pendingAction||actionBusy||rotationBusy||blocked)return;if(!confirm('Replace the current hunt library with '+imported.hunts.length+' imported hunts? The website page will be private.'))return;state=imported;renderAll();change();toast('Backup imported. Saving your hunts…');}catch(err){toast(err.message || 'Could not import this backup.');}finally{$('importFile').value='';}});
  $('importLegacy').addEventListener('click',()=>{
    if(pendingAction||actionBusy||rotationBusy||blocked)return;
    try{const legacy=JSON.parse(localStorage.getItem('thorshall_bonus_hunts_v1')||'null');if(!legacy || !Array.isArray(legacy.rows))throw new Error('No earlier tracker data was found.');if(!confirm('Add your earlier tracker as a new hunt?'))return;if(state.hunts.length>=50)throw new Error('The library is full.');const h=Core.createHunt();h.title=String(legacy.name||'Imported hunt').slice(0,80);h.start=Math.max(0,Number(legacy.start)||0);h.rows=legacy.rows.slice(0,150).map(r=>({id:Core.id(),slot:String(r.slot||'').slice(0,80),provider:String(r.provider||'').slice(0,60),bet:Math.max(0,Number(r.bet)||0),payout:r.multiplier===''||r.multiplier==null?null:Math.round(Math.max(0,Number(r.bet)||0)*Math.max(0,Number(r.multiplier)||0)*100)/100}));state.hunts.unshift(h);state.activeId=h.id;renderAll();change();toast('Earlier tracker imported.');}catch(err){toast(err.message);}
  });
  window.addEventListener('beforeunload',event=>{if(dirty){preserveDraft();event.preventDefault();event.returnValue='';}});
  if(!Core){status('Could not load calculator','error');return;}
  load();
})();

