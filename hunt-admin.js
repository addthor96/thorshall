(function () {
  'use strict';
  const Core = window.HuntCore;
  const API = '/.netlify/functions/bonus-hunts-api';
  const DRAFT_KEY = 'thorshall_hunt_admin_draft_v2';
  const $ = id => document.getElementById(id);
  let state, revision, streamToken = '', dirty = false, saving = false, blocked = false, timer, editVersion = 0, toastTimer;
  let recoveredDraft = null;
  const copy = value => JSON.parse(JSON.stringify(value));
  const current = () => state.hunts.find(h => h.id === state.activeId) || state.hunts[0];
  const value = input => Math.max(0, Math.min(100000000, Number(input.value) || 0));
  const esc = value => Core.escapeHtml(String(value == null ? '' : value));

  function status(text, type) { $('saveStatus').textContent = text; $('saveStatus').dataset.state = type; }
  function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.remove('hidden'); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3500); }
  function preserveDraft() { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({state,revision})); } catch (_) {} }
  function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {} }
  function hideError() { $('errorNotice').classList.add('hidden'); ['retrySave','reloadRemote','loginAgain'].forEach(id => $(id).classList.add('hidden')); }
  function error(message, type) {
    $('errorText').textContent = message; $('errorNotice').classList.remove('hidden');
    $('exportDraft').disabled=!state;
    ['retrySave','reloadRemote','loginAgain'].forEach(id => $(id).classList.add('hidden'));
    if (type === 'session') $('loginAgain').classList.remove('hidden');
    else if (type === 'conflict') $('reloadRemote').classList.remove('hidden');
    else $('retrySave').classList.remove('hidden');
    status(type === 'conflict' ? 'Another saved version exists' : 'Changes not saved', 'error');
  }
  async function request(method, body) {
    const response = await fetch(API + (method === 'GET' ? '?mode=admin' : ''), {
      method, credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(20000),
      headers: method === 'GET' ? {} : {'Content-Type':'application/json','X-Thorshall-Request':'bonus-hunts'},
      body: body ? JSON.stringify(body) : undefined
    });
    let data; try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok || !data.ok) { const err = new Error(data.error || 'Could not connect. Your draft is kept in this browser tab.'); err.status=response.status; throw err; }
    return data;
  }
  function change() {
    dirty=true; editVersion++; preserveDraft();
    status('Unsaved changes','dirty'); $('saveNow').disabled=false;
    clearTimeout(timer); if (!blocked) timer=setTimeout(save,900);
    renderMetrics();
  }
  async function save() {
    clearTimeout(timer);
    if (!state || !dirty || blocked) return false;
    if (saving) return false;
    const version=editVersion, submitted=copy(state); saving=true; status('Saving…','saving'); $('saveNow').disabled=true;
    try {
      const data=await request('PUT',{state:submitted,revision}); revision=data.revision;
      if (version===editVersion) { state=data.state || submitted; dirty=false; clearDraft(); status('All changes saved','saved'); }
      else { preserveDraft(); status('Saving latest changes…','saving'); }
      hideError();
    } catch(err) {
      preserveDraft();
      if (err.status===401 || err.status===403) { blocked=true; error('Your owner session has expired. Sign in again; your unsaved draft is kept in this tab.','session'); }
      else if(err.status===409 || err.status===412) { blocked=true; error('The hunt was changed in another tab. Download your draft before loading the latest saved version.','conflict'); }
      else error(err.message,'network');
    } finally { saving=false; $('saveNow').disabled=!dirty || blocked; }
    if (dirty && !blocked && version!==editVersion) timer=setTimeout(save,500);
    return !dirty;
  }
  function fillDetails() {
    const h=current(); if(!h)return;
    $('huntTitle').value=h.title; $('huntDate').value=h.date; $('huntStatus').value=h.status; $('huntStart').value=h.start || ''; $('huntBalance').value=h.balance || ''; $('huntCurrency').value=h.currency;
    $('activeBadge').textContent={collecting:'Collecting',opening:'Opening',complete:'Complete'}[h.status] || 'Collecting';
  }
  function renderLibrary() {
    $('huntSelect').innerHTML=state.hunts.map(h=>'<option value="'+esc(h.id)+'">'+esc(h.title || 'Untitled hunt')+' · '+esc(h.date)+'</option>').join('');
    $('huntSelect').value=state.activeId; $('huntCount').textContent=state.hunts.length+' / 50';
    $('newHunt').disabled=state.hunts.length>=50; $('duplicateHunt').disabled=state.hunts.length>=50;
  }
  function renderMetrics() {
    if(!state)return; const h=current(),m=Core.calculate(h),currency=h.currency;
    $('liveMetrics').innerHTML=[
      ['End balance',Core.money(m.endBalance,currency),''],
      ['Profit / loss',(m.profit>0?'+':'')+Core.money(m.profit,currency),m.profit>=0?'positive':'negative'],
      ['Required X',Core.x(m.requiredX),''],
      ['Average X',Core.x(m.averageX),'']
    ].map(item=>'<div class="metric"><span class="metric-label">'+item[0]+'</span><strong class="metric-value '+item[2]+'">'+item[1]+'</strong></div>').join('');
    $('bonusCount').textContent=m.total+' bonuses · '+m.opened+' opened · '+m.remaining+' remaining';
  }
  function rowHtml(row,index) {
    const opened=row.payout!==null, multiplier=opened && row.bet>0 ? +(row.payout/row.bet).toFixed(4) : '';
    return '<tr data-row="'+esc(row.id)+'"><td class="row-number">'+(index+1)+'</td><td class="slot-fields"><label class="sr-only" for="slot-'+esc(row.id)+'">Slot '+(index+1)+'</label><input id="slot-'+esc(row.id)+'" data-field="slot" maxlength="80" value="'+esc(row.slot)+'" placeholder="Slot name" autocomplete="off"></td><td><label class="sr-only" for="bet-'+esc(row.id)+'">Bet for bonus '+(index+1)+'</label><input id="bet-'+esc(row.id)+'" data-field="bet" type="number" min="0" max="100000000" step="0.01" inputmode="decimal" value="'+(row.bet || '')+'" placeholder="0.00"></td><td><label class="sr-only" for="payout-'+esc(row.id)+'">Payout for bonus '+(index+1)+'</label><input id="payout-'+esc(row.id)+'" data-field="payout" type="number" min="0" max="100000000" step="0.01" inputmode="decimal" value="'+(opened?row.payout:'')+'" placeholder="Unopened"></td><td><label class="sr-only" for="x-'+esc(row.id)+'">Multiplier for bonus '+(index+1)+'</label><input id="x-'+esc(row.id)+'" data-field="multiplier" type="number" min="0" step="0.01" inputmode="decimal" value="'+multiplier+'" placeholder="—" '+(row.bet>0?'':'disabled')+'></td><td><div class="row-tools"><button class="button icon subtle" type="button" data-action="up" aria-label="Move bonus '+(index+1)+' up" '+(index===0?'disabled':'')+'>↑</button><button class="button icon subtle" type="button" data-action="down" aria-label="Move bonus '+(index+1)+' down" '+(index===current().rows.length-1?'disabled':'')+'>↓</button><button class="button icon danger" type="button" data-action="remove" aria-label="Delete bonus '+(index+1)+'">×</button></div></td></tr>';
  }
  function renderRows() { const rows=current().rows; $('bonusRows').innerHTML=rows.map(rowHtml).join(''); $('emptyRows').hidden=rows.length>0; }
  function renderVisibility() { const visible=state.settings.public; $('visibilityBadge').textContent=visible?'Public':'Private'; $('visibilityText').textContent=visible?'Anyone can view /bonus-hunt.':'Only you can preview the hunt page.'; $('togglePublic').textContent=visible?'Make hunt page private':'Make hunt page public'; }
  function renderOverlay() { const url=location.origin+'/bonus-hunt-overlay#token='+encodeURIComponent(streamToken); $('overlayUrl').value=url; $('overlayPreview').src=url; }
  function renderAll() { fillDetails(); renderLibrary(); renderMetrics(); renderRows(); renderVisibility(); }
  function newRow() { return {id:Core.id(),slot:'',provider:'',bet:0,payout:null}; }
  function addRows(count) { const h=current(); for(let i=0;i<count && h.rows.length<150;i++)h.rows.push(newRow()); renderRows(); change(); }
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
  async function load() {
    try {
      const data=await request('GET'); state=data.state; revision=data.revision; streamToken=data.streamToken || ''; blocked=false; dirty=false;
      $('manager').hidden=false; $('loadingState').hidden=true; $('saveNow').disabled=true; status('All changes saved','saved'); renderAll(); renderOverlay();
      try { const draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null'); if(draft && draft.state && JSON.stringify(draft.state)!==JSON.stringify(state)){ recoveredDraft=draft; $('recoveryNotice').classList.remove('hidden'); } } catch(_) {}
      try { if(localStorage.getItem('thorshall_bonus_hunts_v1'))$('importLegacy').classList.remove('hidden'); } catch(_) {}
    } catch(err) { $('loadingState').hidden=true; error(err.status===401?'Sign in with your owner password to open Hunt Manager.':err.message,err.status===401?'session':'network'); }
  }
  [['huntTitle','title'],['huntDate','date'],['huntStatus','status'],['huntCurrency','currency'],['huntStart','start'],['huntBalance','balance']].forEach(([id,field])=>$(id).addEventListener('input',()=>{
    if(!state)return; current()[field]=['start','balance'].includes(field)?value($(id)):$(id).value;
    if(['title','date'].includes(field))renderLibrary(); if(field==='status')$('activeBadge').textContent=$('huntStatus').selectedOptions[0].textContent;
    if(field==='currency')renderRows(); change();
  }));
  $('bonusRows').addEventListener('input',event=>{
    const input=event.target,tr=input.closest('[data-row]'); if(!tr || !input.dataset.field)return;
    const row=current().rows.find(r=>r.id===tr.dataset.row),field=input.dataset.field;if(!row)return;
    if(['slot','provider'].includes(field))row[field]=input.value;
    if(field==='bet') { row.bet=value(input); const xInput=tr.querySelector('[data-field="multiplier"]'); xInput.disabled=row.bet<=0; xInput.value=row.payout!==null && row.bet>0?+(row.payout/row.bet).toFixed(4):''; }
    if(field==='payout') { row.payout=input.value===''?null:value(input); tr.querySelector('[data-field="multiplier"]').value=row.payout!==null && row.bet>0?+(row.payout/row.bet).toFixed(4):''; }
    if(field==='multiplier') { row.payout=input.value===''?null:Math.min(100000000,Math.round(row.bet*value(input)*100)/100); tr.querySelector('[data-field="payout"]').value=row.payout===null?'':row.payout; }
    change();
  });
  $('bonusRows').addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const tr=button.closest('[data-row]'),rows=current().rows,index=rows.findIndex(r=>r.id===tr.dataset.row);if(index<0)return;
    if(button.dataset.action==='remove')rows.splice(index,1);
    if(button.dataset.action==='up' && index>0)[rows[index-1],rows[index]]=[rows[index],rows[index-1]];
    if(button.dataset.action==='down' && index<rows.length-1)[rows[index+1],rows[index]]=[rows[index],rows[index+1]];
    renderRows();change();
  });
  ['addBonus','addFirst','addBottom'].forEach(id=>$(id).addEventListener('click',()=>addRows(1)));$('addFive').addEventListener('click',()=>addRows(5));
  $('huntSelect').addEventListener('change',()=>{state.activeId=$('huntSelect').value;renderAll();change();});
  $('newHunt').addEventListener('click',()=>{if(state.hunts.length>=50)return;const h=Core.createHunt();h.title='Hunt #'+(state.hunts.length+1);state.hunts.unshift(h);state.activeId=h.id;renderAll();change();$('huntTitle').focus();});
  $('duplicateHunt').addEventListener('click',()=>{if(state.hunts.length>=50)return;const h=copy(current());h.id=Core.id();h.title=(h.title+' copy').slice(0,80);h.rows.forEach(r=>r.id=Core.id());state.hunts.unshift(h);state.activeId=h.id;renderAll();change();});
  $('deleteHunt').addEventListener('click',()=>{if(!confirm('Delete “'+current().title+'” and its bonus list?'))return;state.hunts=state.hunts.filter(h=>h.id!==state.activeId);if(!state.hunts.length)state.hunts.push(Core.createHunt());state.activeId=state.hunts[0].id;renderAll();change();});
  $('togglePublic').addEventListener('click',async()=>{state.settings.public=!state.settings.public;renderVisibility();change();await save();});
  $('saveNow').addEventListener('click',save);$('retrySave').addEventListener('click',()=>{if(!state){load();return}blocked=false;save();});
  $('reloadRemote').addEventListener('click',async()=>{if(!confirm('Replace this unsaved draft with the latest saved version? Download your draft first if you need to keep it.'))return;clearDraft();hideError();await load();});
  $('restoreDraft').addEventListener('click',()=>{try{state=validateImport(recoveredDraft.state);renderAll();$('recoveryNotice').classList.add('hidden');change();toast('Draft restored. It will save to your account.');}catch(err){error(err.message,'network');}});
  $('discardDraft').addEventListener('click',()=>{clearDraft();$('recoveryNotice').classList.add('hidden');recoveredDraft=null;});
  $('copyOverlay').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('overlayUrl').value);toast('Overlay URL copied. Paste it into your Browser Source.');}catch(_){$('overlayUrl').type='text';$('overlayUrl').select();toast('Copy the selected overlay URL.');}});
  $('showOverlayUrl').addEventListener('click',()=>{const show=$('overlayUrl').type==='password';$('overlayUrl').type=show?'text':'password';$('showOverlayUrl').textContent=show?'Hide':'Show';$('showOverlayUrl').setAttribute('aria-pressed',String(show));});
  $('rotateToken').addEventListener('click',async()=>{
    if(!confirm('Replace the overlay link? Your current OBS source will stop updating until you paste the new URL.'))return;
    if(saving){toast('Wait for your current changes to finish saving, then replace the link.');return;}
    if(dirty && !(await save())){toast('Save your hunt changes before replacing the overlay link.');return;}
    $('rotateToken').disabled=true;clearTimeout(timer);saving=true;status('Replacing overlay link…','saving');
    try{const data=await request('POST',{action:'rotate-token',revision});streamToken=data.streamToken;if(data.revision!==undefined)revision=data.revision;renderOverlay();toast('New overlay link created. Update your OBS Browser Source.');}
    catch(err){if(err.status===409||err.status===412){blocked=true;error('The hunt was changed in another tab. Load the latest saved version before replacing the overlay link.','conflict');}else if(err.status===401){blocked=true;error(err.message,'session');}else toast(err.message);}
    finally{$('rotateToken').disabled=false;saving=false;if(!blocked){status(dirty?'Unsaved changes':'All changes saved',dirty?'dirty':'saved');if(dirty)timer=setTimeout(save,500);}$('saveNow').disabled=!dirty||blocked;}
  });
  $('exportData').addEventListener('click',exportDraft);$('exportDraft').addEventListener('click',exportDraft);$('importData').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',async()=>{const file=$('importFile').files[0];if(!file)return;try{if(file.size>3000000)throw new Error('Choose a backup smaller than 3 MB.');const imported=validateImport(JSON.parse(await file.text()));if(!confirm('Replace the current hunt library with '+imported.hunts.length+' imported hunts? The website page will be private.'))return;state=imported;renderAll();change();toast('Backup imported. Saving your hunts…');}catch(err){toast(err.message || 'Could not import this backup.');}finally{$('importFile').value='';}});
  $('importLegacy').addEventListener('click',()=>{
    try{const legacy=JSON.parse(localStorage.getItem('thorshall_bonus_hunts_v1')||'null');if(!legacy || !Array.isArray(legacy.rows))throw new Error('No earlier tracker data was found.');if(!confirm('Add your earlier tracker as a new hunt?'))return;if(state.hunts.length>=50)throw new Error('The library is full.');const h=Core.createHunt();h.title=String(legacy.name||'Imported hunt').slice(0,80);h.start=Math.max(0,Number(legacy.start)||0);h.rows=legacy.rows.slice(0,150).map(r=>({id:Core.id(),slot:String(r.slot||'').slice(0,80),provider:String(r.provider||'').slice(0,60),bet:Math.max(0,Number(r.bet)||0),payout:r.multiplier===''||r.multiplier==null?null:Math.round(Math.max(0,Number(r.bet)||0)*Math.max(0,Number(r.multiplier)||0)*100)/100}));state.hunts.unshift(h);state.activeId=h.id;renderAll();change();toast('Earlier tracker imported.');}catch(err){toast(err.message);}
  });
  window.addEventListener('beforeunload',event=>{if(dirty){preserveDraft();event.preventDefault();event.returnValue='';}});
  if(!Core){status('Could not load calculator','error');return;}
  load();
})();

