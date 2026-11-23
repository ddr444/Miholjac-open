const $ = selector => document.querySelector(selector);
const currentPage = () => {
  const page=location.hash.slice(1).split('?')[0];
  return ['pocetna','termini','rang-lista','rezultati','administracija'].includes(page)?page:'pocetna';
};
document.body.dataset.page=currentPage();
const lanes = ['I.','II.','III.','IV.'];
const state = { config:null, slots:[], choice:null, category:'upper_m', rankings:[], results:[], bookings:[], resultId:null, authenticated:false, authMode:'password',role:null,email:null,googleReady:false };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hour = value => `${String(value).padStart(2,'0')}:00`;
const dateLabel = day => new Intl.DateTimeFormat('hr-HR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(`${day}T12:00:00`));
let toastTimer;
function toast(message,error=false) {
  clearTimeout(toastTimer); const el=$('#toast'); el.textContent=message; el.classList.toggle('error-toast',error); el.hidden=false;
  toastTimer=setTimeout(()=>el.hidden=true,6500);
}
async function api(path,data) {
  const response=await fetch(`/api/${path}`,{credentials:'same-origin',...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  let result; try { result=await response.json(); } catch { throw new Error('Poslužitelj nije dostupan. Pokušajte ponovno.'); }
  if(!response.ok) { if(response.status===401 && path.startsWith('admin/')) showAdmin(false); throw new Error(result.error||'Zahtjev nije uspio.'); }
  return result;
}
async function busy(form,fn,errorSelector) {
  const button=form.querySelector('button[type="submit"]');
  if(button.disabled)return;
  button.disabled=true;
  if(errorSelector) $(errorSelector).textContent='';
  try { await fn(); } catch(e) { if(errorSelector) $(errorSelector).textContent=e.message; else toast(e.message,true); }
  finally { button.disabled=false; }
}
function displayEmpty(el,title,description) { el.innerHTML=`<div class="empty"><strong>${escape(title)}</strong>${escape(description)}</div>`; }
let slotRequest=0;
async function loadSlots() {
  const day=$('#booking-date').value, request=++slotRequest;
  $('#selected-date').textContent=day ? dateLabel(day) : 'Odaberi datum';
  $('#previous-day').disabled=day<=state.config.start; $('#next-day').disabled=day>=state.config.end;
  $('#slots').innerHTML='<div class="empty">Učitavanje termina…</div>';
  try {
    const slots=await api(`slots?date=${encodeURIComponent(day)}`);
    if(request!==slotRequest)return;
    state.slots=slots;
    if(!slots.length){displayEmpty($('#slots'),'Za ovaj dan nema otvorenih termina.','Odaberi drugi datum ili provjeri raspored s organizatorom.');return;}
    $('#slots').innerHTML=`<table class="slot-table"><thead><tr><th scope="col">SAT</th>${lanes.map(l=>`<th scope="col">${l} STAZA</th>`).join('')}</tr></thead><tbody>${slots.map(s=>`<tr><td>${hour(s.hour)}</td>${lanes.map((l,i)=>{
      const taken=s.taken.includes(i+1), disabled=s.closed||s.past||taken;
      const label=taken?'Rezervirano':s.closed?'Zatvoreno':s.past?'Prošlo':'Slobodno';
      const reservation=s.reservations?.find(r=>r.lane===i+1);
      if(reservation) return `<td><div class="lane-reservation"><strong>${escape(reservation.name)}</strong><small>${escape(reservation.club||'Bez kluba')}</small><span>Rezervirano</span></div></td>`;
      return `<td><button class="lane-button" data-slot="${s.id}" data-lane="${i+1}" ${disabled?'disabled':''} aria-label="${escape(`${hour(s.hour)}, staza ${l}, ${label}`)}">${label}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  } catch(e) { if(request===slotRequest) displayEmpty($('#slots'),'Termini nisu učitani',e.message); }
}
function openBooking(slot,lane) {
  state.choice={slot,lane}; $('#booking-form').reset(); $('#booking-error').textContent='';
  $('#booking-summary').textContent=`${dateLabel(slot.day)} · ${hour(slot.hour)} · staza ${lanes[lane-1]}`;
  $('#booking-dialog').showModal();
}
async function loadRank() {
  $('#rank-body').innerHTML='<tr><td colspan="5" class="empty">Učitavanje…</td></tr>';
  try { state.rankings=await api('standings'); renderRank(); } catch(e) { $('#rank-body').innerHTML=`<tr><td colspan="5" class="empty">${escape(e.message)}</td></tr>`; }
}
function renderRank() {
  $('#rank-filters').innerHTML=Object.entries(state.config.categories).map(([key,label])=>`<button data-category="${key}" class="${state.category===key?'selected':''}" aria-pressed="${state.category===key}">${escape(key==='upper_m'?'Superliga · ukupna rang-lista (svi)':label)}</button>`).join('');
  const overall=state.category==='upper_m';
  const rows=overall?[...state.rankings].sort((a,b)=>(b.total??-1)-(a.total??-1)||a.name.localeCompare(b.name,'hr')):state.rankings.filter(r=>r.category===state.category);
  const performanceRow=(p,expanded=false)=>`<div class="performance-row ${p.counted?'counted':''}"><span>${p.number}.${expanded?` <small>${escape(dateLabel(p.day))} · ${hour(p.hour)} · staza ${lanes[p.lane-1]}</small>`:''}</span><strong>${p.total}</strong><span>${p.cleaning??'—'}</span><span>${p.misses??'—'}</span></div>`;
  const performanceHeader='<div class="performance-head"><span>Nastup</span><span>Ukupno</span><span>Čišćenje</span><span>Promašaji</span></div>';
  $('#rank-body').innerHTML=rows.length?rows.map(r=>{
    const best=[...r.performances].sort((a,b)=>b.total-a.total||a.number-b.number).slice(0,2);
    return `<tr class="rank-main"><td class="rank-number">${(overall?r.overallPosition:r.position)??'—'}</td><td><strong>${escape(r.name)}</strong><small>${escape(r.club||'Bez kluba')}</small>${overall?`<small>${escape(state.config.categories[r.category])}</small>`:''}</td><td><button class="rank-expand" data-expand-rank="${r.id}" aria-expanded="false" aria-controls="rank-history-${r.id}" aria-label="Prikaži sve nastupe: ${escape(r.name)}">${r.count} <span aria-hidden="true">⌄</span></button></td><td><div class="rank-performances">${performanceHeader}${best.map(p=>performanceRow(p)).join('')}</div></td><td><span class="score">${r.total??'—'}</span>${r.total===null?'<small>Potreban još 1 nastup</small>':`<small>Č: ${r.bestCleaning??'—'} · P: ${r.bestMisses??'—'}</small>`}</td></tr><tr id="rank-history-${r.id}" class="rank-history" hidden><td colspan="5"><div class="rank-history-title">Svi nastupi · ${escape(r.name)}</div><div class="rank-performances expanded-performances">${performanceHeader}${r.performances.map(p=>performanceRow(p,true)).join('')}</div></td></tr>`;
  }).join(''):'<tr><td colspan="5" class="empty">Još nema rezultata u ovoj kategoriji.</td></tr>';
}
async function loadResults() {
  $('#results-body').innerHTML='<tr><td colspan="4" class="empty">Učitavanje…</td></tr>';
  try { state.results=await api('results'); renderResults(); } catch(e) { $('#results-body').innerHTML=`<tr><td colspan="4" class="empty">${escape(e.message)}</td></tr>`; }
}
function renderResults() {
  const search=$('#result-search').value.toLocaleLowerCase('hr');
  const rows=state.results.filter(r=>`${r.name} ${r.club}`.toLocaleLowerCase('hr').includes(search));
  $('#results-body').innerHTML=rows.length?rows.map(r=>`<tr><td><strong>${escape(r.name)}</strong><small>${escape(r.club||'Bez kluba')} · ${escape(state.config.categories[r.category])}<br>${escape(dateLabel(r.day))} · ${hour(r.hour)} · staza ${lanes[r.lane-1]}</small></td><td class="score">${r.total}</td><td>${r.cleaning??'—'}</td><td>${r.misses??'—'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nema rezultata za prikaz.</td></tr>';
}
function showAdmin(loggedIn) {
  state.authenticated=loggedIn;
  $('#login-form').hidden=loggedIn||state.authMode==='google';
  $('#google-login').hidden=loggedIn||state.authMode!=='google';
  $('#google-login-link').hidden=!state.googleReady;
  $('#google-setup-note').hidden=state.googleReady;
  $('#admin-content').hidden=!loggedIn; $('#logout').hidden=!loggedIn;
  $('#admin-identity').hidden=!loggedIn;
  $('#admin-identity').textContent=loggedIn?`${state.email==='shared-password'?'Zajednička lokalna/početna prijava':state.email} · ${state.role==='owner'?'vlasnik':'administrator'}`:'';
  $('#owner-panel').hidden=!loggedIn||state.role!=='owner';
}
async function loadUsers() {
  const data=await api('admin/users');
  $('#admin-user-form').hidden=!data.configured;
  $('#owner-setup-note').hidden=data.configured;
  $('#owner-email').textContent=data.owner?`Vlasnik: ${data.owner}`:'';
  $('#admin-users').innerHTML=data.admins.map(user=>`<div class="admin-booking"><strong class="person">${escape(user.email)}</strong><button class="secondary" data-remove-admin="${escape(user.email)}">Ukloni pristup</button></div>`).join('')||(data.configured?'<p class="fine">Još nema dodatnih administratora.</p>':'');
}
async function loadAdmin() {
  const session=await api('session');
  Object.assign(state,{authMode:session.authMode,role:session.role,email:session.email,googleReady:session.googleReady});
  showAdmin(session.authenticated);
  if(session.authenticated){await loadAdminDay();if(session.role==='owner')await loadUsers();}
}
let adminRequest=0;
async function loadAdminDay() {
  const day=$('#admin-date').value, request=++adminRequest;
  const [slots,bookings]=await Promise.all([api(`slots?date=${encodeURIComponent(day)}`),api(`admin/bookings?date=${encodeURIComponent(day)}`),loadStatistics()]);
  if(request!==adminRequest)return;
  state.bookings=bookings;
  $('#admin-slots').innerHTML=slots.length?slots.map(s=>`<button class="secondary ${s.closed?'closed':''}" data-admin-slot="${s.id}" data-closed="${s.closed}">${hour(s.hour)} · ${s.closed?'Otvori':'Zatvori'}</button>`).join(''):'<p class="fine">Nema termina. Otvori ih u obrascu iznad.</p>';
  $('#admin-bookings').innerHTML=bookings.length?bookings.map(b=>`<div class="admin-booking"><div class="person"><strong>${hour(b.hour)} · ${lanes[b.lane-1]} · ${escape(b.name)}</strong><small>${escape(b.club||'Bez kluba')} · ${escape(state.config.categories[b.category])}<br>Telefon: ${escape(b.contact)}<br>${b.total===null?'Rezultat nije unesen':`Ukupno: ${b.total} · Čišćenje: ${b.cleaning??'—'} · Promašaji: ${b.misses??'—'} · ${b.ordinal}. nastup`}${b.free?' · BESPLATAN NASTUP':''}</small></div><div class="actions"><button class="secondary" data-edit-booking="${b.id}">Uredi prijavu</button><button class="secondary" data-category-person="${b.participant_id}">${b.division_review?'⚠ Provjeri kategoriju':'Kategorija'}</button><button class="secondary" data-result="${b.id}">${b.total===null?'Unesi':'Uredi'} rezultat</button><button class="secondary" data-payment="${b.id}" data-paid="${!!b.paid}">${b.paid?'✓ Plaćeno':'Označi uplatu'}</button>${b.total===null?`<button class="secondary" data-cancel="${b.id}">Otkaži</button>`:''}</div></div>`).join(''):'<div class="empty">Za ovaj dan nema prijava.</div>';
}
let statisticsRequest=0;
async function loadStatistics() {
  const request=++statisticsRequest;
  try{
    const data=await api('admin/statistics');
    if(request!==statisticsRequest||!state.authenticated)return;
    const t=data.totals,percent=n=>new Intl.NumberFormat('hr-HR',{maximumFractionDigits:1}).format(n)+' %';
    const cards=[['Popunjenost otvorenih termina',percent(t.occupancy),`${t.bookedOpen} od ${t.capacity} mjesta`],['Rezervirani nastupi',t.booked,`${t.awaitingResults} bez unesenog rezultata`],['Nastupi s rezultatom',t.completed,'Uključuju i besplatne nastupe'],['Besplatni nastupi',t.freeCompleted,'5., 10., 15. … završeni nastup'],['Nastupi za naplatu',t.chargeableCompleted,'S rezultatom, bez besplatnih'],['Nastupi žena',t.womenBookings,`${t.womenCompleted} s unesenim rezultatom · svaki nastup broji se zasebno`]];
    $('#statistics-summary').innerHTML=`<div class="statistics-cards">${cards.map(([label,value,note])=>`<div><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('')}</div>${t.bookedClosed?`<p class="fine">U zatvorenim terminima postoje ${t.bookedClosed} aktivne prijave. Uključene su u broj nastupa, ali nisu u postotku popunjenosti otvorenih termina.</p>`:''}`;
    $('#statistics-daily').innerHTML=data.daily.length?`<table><thead><tr><th>Datum</th><th>Otvoreni termini</th><th>Mjesta</th><th>Rezervirano / otvoreno</th><th>Popunjenost</th><th>Sve prijave</th><th>Nastupi žena</th><th>Žene s rezultatom</th><th>S rezultatom</th><th>Besplatni</th><th>Za naplatu</th></tr></thead><tbody>${data.daily.map(d=>`<tr><td>${escape(dateLabel(d.day))}</td><td>${d.openSlots}</td><td>${d.capacity}</td><td>${d.bookedOpen}</td><td>${percent(d.occupancy)}</td><td>${d.booked}</td><td>${d.womenBookings}</td><td>${d.womenCompleted}</td><td>${d.completed}</td><td>${d.freeCompleted}</td><td>${d.chargeableCompleted}</td></tr>`).join('')}</tbody></table>`:'<p class="fine">Još nema otvorenih termina.</p>';
    $('#statistics-free-title').textContent=`Besplatni nastupi — svaki peti (${t.freeCompleted})`;
    $('#statistics-free').innerHTML=data.freePerformances.length?`<table><thead><tr><th>Natjecatelj / klub</th><th>Termin</th><th>Staza</th><th>Redni nastup</th><th>Rezultat</th></tr></thead><tbody>${data.freePerformances.map(p=>`<tr><td><strong>${escape(p.name)}</strong><small>${escape(p.club||'Bez kluba')}</small></td><td>${escape(dateLabel(p.day))} · ${hour(p.hour)}</td><td>${lanes[p.lane-1]}</td><td>${p.ordinal}.</td><td>${p.total}</td></tr>`).join('')}</tbody></table>`:'<p class="fine">Još nema petih završenih nastupa s unesenim rezultatom.</p>';
  }catch(e){if(request===statisticsRequest)$('#statistics-summary').innerHTML=`<p class="error">Statistika nije učitana: ${escape(e.message)}</p>`;}
}
let editSlotRequest=0;
async function loadEditBookingSlots(preferredSlot,preferredLane) {
  const request=++editSlotRequest,day=$('#edit-booking-date').value;
  const select=$('#edit-booking-slot');select.innerHTML='<option value="">Učitavanje…</option>';select.disabled=true;
  $('#edit-booking-lane').disabled=true;
  try{
    const slots=await api(`slots?date=${encodeURIComponent(day)}`);
    if(request!==editSlotRequest)return;
    const original=state.editBooking;
    state.editSlots=slots.filter(slot=>!slot.closed||slot.id===original.slot_id);
    select.innerHTML=state.editSlots.map(slot=>`<option value="${slot.id}">${hour(slot.hour)}${slot.closed?' · zatvoren':''}</option>`).join('')||'<option value="">Nema otvorenih termina</option>';
    select.disabled=!state.editSlots.length;
    if(state.editSlots.some(slot=>slot.id===preferredSlot))select.value=String(preferredSlot);
    updateEditBookingLanes(preferredLane);
  }catch(e){if(request===editSlotRequest){select.innerHTML='<option value="">Termini nisu učitani</option>';$('#edit-booking-error').textContent=e.message;}}
}
function updateEditBookingLanes(preferredLane) {
  const slot=state.editSlots?.find(slot=>slot.id===Number($('#edit-booking-slot').value)),original=state.editBooking;
  const select=$('#edit-booking-lane');select.disabled=!slot;
  if(!slot)return;
  const available=[];
  for(const option of select.options){const lane=Number(option.value);option.disabled=slot.taken.includes(lane)&&!(slot.id===original.slot_id&&lane===original.lane);option.textContent=`${lanes[lane-1]}${option.disabled?' · zauzeta':''}`;if(!option.disabled)available.push(lane);}
  select.value=String(available.includes(preferredLane)?preferredLane:(available[0]??''));
}
async function route() {
  const page=currentPage();
  document.body.dataset.page=page;
  document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==`page-${page}`);
  document.querySelectorAll('nav [data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page));
  if(window.matchMedia('(max-width: 650px)').matches)window.scrollTo({top:0,left:0,behavior:'instant'});
  try {
    if(page==='termini')await loadSlots();
    if(page==='rang-lista')await loadRank();
    if(page==='rezultati')await loadResults();
    if(page==='administracija'){
      await loadAdmin();
      const message=new URLSearchParams(location.hash.split('?')[1]||'').get('greska');
      if(message){toast(message,true);history.replaceState(null,'',location.pathname+'#administracija');}
    }
  } catch(e) { toast(e.message,true); }
}
function onClick(id,fn) { $(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>toast(e.message,true))); }
async function init() {
  state.config=await api('config');
  $('#demo-banner').hidden=!state.config.demo; $('#demo-login').hidden=!state.config.demo;
  const today=state.config.now.slice(0,10), initial=today<state.config.start?state.config.start:today>state.config.end?state.config.end:today;
  $('#booking-date').value=initial; $('#admin-date').value=initial;
  $('#booking-category').innerHTML='<option value="" disabled selected>Odaberi kategoriju…</option>'+Object.entries(state.config.categories).map(([key,label])=>`<option value="${key}">${escape(label)}</option>`).join('');
  $('#weekdays').innerHTML=[[1,'Pon'],[2,'Uto'],[3,'Sri'],[4,'Čet'],[5,'Pet'],[6,'Sub'],[0,'Ned']].map(([value,name])=>`<label><input type="checkbox" name="weekday" value="${value}" checked>${name}</label>`).join('');
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  $('#booking-date').addEventListener('change',loadSlots); $('#admin-date').addEventListener('change',()=>loadAdminDay().catch(e=>toast(e.message,true)));
  for(const [id,delta] of [['#previous-day',-1],['#next-day',1]]) onClick(id,()=>{const d=new Date(`${$('#booking-date').value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);$('#booking-date').value=d.toISOString().slice(0,10);return loadSlots();});
  onClick('#refresh-statistics',loadStatistics);
  onClick('#refresh-slots',loadSlots);onClick('#refresh-rank',loadRank);onClick('#refresh-results',loadResults);onClick('#refresh-admin',loadAdminDay);
  $('#slots').addEventListener('click',event=>{const button=event.target.closest('[data-slot]');if(button)openBooking(state.slots.find(s=>s.id===Number(button.dataset.slot)),Number(button.dataset.lane));});
  $('#booking-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{
    const form=Object.fromEntries(new FormData(event.target)), choice=state.choice;
    const result=await api('book',{...form,slotId:choice.slot.id,lane:choice.lane});
    $('#booking-dialog').close(); $('#confirmation-summary').textContent=`${dateLabel(result.day)} · ${hour(result.hour)} · staza ${lanes[result.lane-1]}`;
    $('#cancel-link').value=`${location.origin}/#otkazivanje=${result.token}`;$('#cancel-code').value=result.token;$('#confirmation-dialog').showModal();await loadSlots();
  },'#booking-error');});
  onClick('#copy-link',async()=>{try{await navigator.clipboard.writeText($('#cancel-link').value);toast('Poveznica je kopirana.');}catch{$('#cancel-link').select();toast('Označena je poveznica. Kopiraj je pomoću Ctrl+C.');}});
  onClick('#open-cancel',()=>{$('#cancel-form').reset();$('#cancel-error').textContent='';$('#cancel-dialog').showModal();});
  $('#cancel-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{await api('cancel',{token:$('#cancel-token').value.trim()});$('#cancel-dialog').close();toast('Rezervacija je otkazana, staza je ponovno slobodna.');await loadSlots();},'#cancel-error');});
  $('#rank-filters').addEventListener('click',event=>{const button=event.target.closest('[data-category]');if(button){state.category=button.dataset.category;renderRank();}});
  $('#rank-body').addEventListener('click',event=>{
    const button=event.target.closest('[data-expand-rank]');
    if(!button)return;
    const expanded=button.getAttribute('aria-expanded')!=='true';
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',`${expanded?'Sakrij':'Prikaži'} sve nastupe`);
    document.getElementById(button.getAttribute('aria-controls')).hidden=!expanded;
  });
  $('#result-search').addEventListener('input',renderResults);
  $('#login-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{await api('login',{password:$('#password').value});$('#password').value='';await loadAdmin();});});
  $('#admin-user-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{await api('admin/users',{action:'add',email:event.target.elements.email.value});event.target.reset();await loadUsers();toast('Administrator je dodan. Može se prijaviti svojim Google računom.');});});
  $('#admin-users').addEventListener('click',async event=>{
    const button=event.target.closest('[data-remove-admin]');
    if(!button||!confirm(`Ukloniti administratorski pristup za ${button.dataset.removeAdmin}?`))return;
    button.disabled=true;
    try{await api('admin/users',{action:'remove',email:button.dataset.removeAdmin});await loadUsers();toast('Administratorski pristup je uklonjen.');}catch(e){button.disabled=false;toast(e.message,true);}
  });
  onClick('#logout',async()=>{await api('logout',{});showAdmin(false);toast('Odjavljeni ste.');});
  $('#schedule-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{
    const form=Object.fromEntries(new FormData(event.target)); const weekdays=[...$('#weekdays').querySelectorAll('input:checked')].map(i=>Number(i.value));
    const result=await api('admin/schedule',{from:form.from,to:form.to,firstHour:Number(form.firstHour),lastHour:Number(form.lastHour),weekdays});
    toast(`Dodano termina: ${result.added}. Postojeći termini nisu izmijenjeni.`);await loadAdminDay();
  });});
  $('#admin-slots').addEventListener('click',event=>{const button=event.target.closest('[data-admin-slot]');if(!button)return;button.disabled=true;api('admin/slot',{id:Number(button.dataset.adminSlot),closed:button.dataset.closed!=='true'}).then(loadAdminDay).catch(e=>{button.disabled=false;toast(e.message,true);});});
  $('#admin-bookings').addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    try {
      if(button.dataset.editBooking){
        const b=state.bookings.find(b=>b.id===Number(button.dataset.editBooking));state.editBooking=b;
        const form=$('#edit-booking-form');form.reset();for(const field of ['name','club','contact'])form.elements[field].value=b[field];
        $('#edit-booking-category').innerHTML=Object.entries(state.config.categories).map(([key,label])=>`<option value="${key}">${escape(label)}</option>`).join('');
        form.elements.category.value=b.category;form.elements.paid.checked=!!b.paid;$('#edit-booking-date').value=b.day;$('#edit-booking-error').textContent='';
        $('#edit-booking-dialog').showModal();await loadEditBookingSlots(b.slot_id,b.lane);
      }
      if(button.dataset.categoryPerson){const b=state.bookings.find(b=>b.participant_id===Number(button.dataset.categoryPerson));state.categoryPersonId=b.participant_id;$('#category-person-name').textContent=b.name;$('#admin-category').innerHTML=Object.entries(state.config.categories).map(([key,label])=>`<option value="${key}">${escape(label)}</option>`).join('');$('#admin-category').value=b.category;$('#category-error').textContent='';$('#category-dialog').showModal();}
      if(button.dataset.result){const b=state.bookings.find(b=>b.id===Number(button.dataset.result));state.resultId=b.id;$('#result-category').innerHTML=Object.entries(state.config.categories).map(([key,label])=>`<option value="${key}">${escape(label)}</option>`).join('');$('#result-category').value=b.category;$('#result-person').textContent=`${b.name} · ${hour(b.hour)} · staza ${lanes[b.lane-1]}`;for(const field of ['total','cleaning','misses'])$('#result-form').elements[field].value=b[field]??'';$('#result-error').textContent='';$('#result-dialog').showModal();}
      if(button.dataset.payment){button.disabled=true;await api('admin/payment',{id:Number(button.dataset.payment),paid:button.dataset.paid!=='true'});await loadAdminDay();}
      if(button.dataset.cancel && confirm('Otkazati ovu rezervaciju? Staza će se osloboditi.')){button.disabled=true;await api('admin/cancel',{id:Number(button.dataset.cancel)});await loadAdminDay();}
    }catch(e){button.disabled=false;toast(e.message,true);}
  });
  $('#edit-booking-date').addEventListener('change',()=>loadEditBookingSlots());
  $('#edit-booking-slot').addEventListener('change',()=>updateEditBookingLanes());
  $('#edit-booking-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{
    if($('#edit-booking-slot').disabled||$('#edit-booking-lane').disabled)throw new Error('Odaberite raspoloživ termin i stazu.');
    const form=Object.fromEntries(new FormData(event.target));
    const saved=await api('admin/booking',{id:state.editBooking.id,name:form.name,club:form.club,contact:form.contact,category:form.category,slotId:Number(form.slotId),lane:Number(form.lane),paid:event.target.elements.paid.checked});
    $('#edit-booking-dialog').close();$('#admin-date').value=saved.day;await loadAdminDay();toast('Prijava je ažurirana.');
  },'#edit-booking-error');});
  $('#category-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{await api('admin/category',{id:state.categoryPersonId,category:$('#admin-category').value});$('#category-dialog').close();toast('Kategorija je ažurirana za sve nastupe natjecatelja.');await loadAdminDay();},'#category-error');});
  $('#result-form').addEventListener('submit',event=>{event.preventDefault();busy(event.target,async()=>{const values=Object.fromEntries(['total','cleaning','misses'].map(field=>[field,Number(event.target.elements[field].value)]));await api('admin/result',{id:state.resultId,...values,category:$('#result-category').value});$('#result-dialog').close();toast('Rezultat je spremljen. Rang-lista je ažurirana.');await loadAdminDay();},'#result-error');});
  onClick('#export-data',async()=>{const data=await api('admin/export');const link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.href=url;link.download=`backup-miholjac-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Preuzeta kopija sadrži privatne kontakte. Spremite je na sigurno.');});
  window.addEventListener('hashchange',route);
  if(location.hash.startsWith('#otkazivanje=')) {const token=location.hash.slice('#otkazivanje='.length);history.replaceState(null,'',location.pathname+'#termini');$('#cancel-token').value=token;$('#cancel-dialog').showModal();}
  await route();
}
init().catch(e=>{displayEmpty($('#slots'),'Aplikacija se nije povezala s bazom.',e.message);toast(e.message,true);});
