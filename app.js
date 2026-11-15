const LENGTHS = [['Any',0,1e9],['< 30m',0,30],['30–60m',30,60],['1–2h',60,120],['2h +',120,1e9]];
const HALF_HOUR = 30*60*1000;
const PLANE_SVG = '<svg viewBox="0 0 64 64"><path fill="#fff" stroke="#0b1f3a" stroke-width="1.5" d="M32 2c2.2 0 3.6 2.4 3.6 5.6V24l22 12.6v5.2L35.6 35v13.4l6.6 5.2V58L32 55l-10.2 3v-4.4l6.6-5.2V35L6.4 41.8v-5.2l22-12.6V7.6C28.4 4.4 29.8 2 32 2z"/></svg>';

/* ================= STORAGE ================= */
const load = (k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}};
const save = (k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch{}};
const saved = load('cf_settings',{});
const settings = {purposes:saved.purposes||['Study','Reading','Writing','Coding','Revision'], purpose:'', origin:null,
  len:saved.len||0, attendant:saved.attendant??true, chime:saved.chime??true};
let logbook = load('cf_logbook',[]);
let active = load('cf_active',null);
const saveSettings = ()=>save('cf_settings',{purposes:settings.purposes,len:settings.len,attendant:settings.attendant,chime:settings.chime});

/* ================= GEO ================= */
const rad = d=>d*Math.PI/180, deg = r=>r*180/Math.PI;
function distKm(a,b){
  const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(h));
}
// real-world block time: cruise ~830 km/h plus ~30 min taxi/climb/descent
const flightHours = km => km/830 + 0.5;
const focusMins = km => Math.max(5, Math.round(flightHours(km)*10));

function greatCircle(a,b,n=200){
  const p1=[rad(a.lat),rad(a.lon)], p2=[rad(b.lat),rad(b.lon)];
  const d=distKm(a,b)/6371, pts=[];
  for(let i=0;i<=n;i++){
    const f=i/n, A=Math.sin((1-f)*d)/Math.sin(d), B=Math.sin(f*d)/Math.sin(d);
    const x=A*Math.cos(p1[0])*Math.cos(p1[1])+B*Math.cos(p2[0])*Math.cos(p2[1]);
    const y=A*Math.cos(p1[0])*Math.sin(p1[1])+B*Math.cos(p2[0])*Math.sin(p2[1]);
    const z=A*Math.sin(p1[0])+B*Math.sin(p2[0]);
    let lon=deg(Math.atan2(y,x));
    if(pts.length){const prev=pts[pts.length-1][1]; while(lon-prev>180)lon-=360; while(lon-prev<-180)lon+=360;}
    pts.push([deg(Math.atan2(z,Math.hypot(x,y))),lon]);
  }
  return pts;
}

/* ================= FORMAT ================= */
const pad = n=>String(n).padStart(2,'0');
function clock(ms){const s=Math.max(0,Math.round(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return (h?h+':'+pad(m):pad(m))+':'+pad(s%60)}
const hm = h=>`${Math.floor(h)}h ${pad(Math.round(h%1*60))}m`;
const minsTxt = m=>m>=60?`${Math.floor(m/60)}h ${pad(m%60)}m`:`${m} min`;
const hhmm = t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes())};
const dateTxt = t=>new Date(t).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
const esc = s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pick = arr=>arr[Math.floor(Math.random()*arr.length)];
const $ = id=>document.getElementById(id);

/* ================= MAP ================= */
const map = L.map('map',{zoomControl:false,worldCopyJump:false,minZoom:2,scrollWheelZoom:'center',attributionControl:true}).setView([15,100],3);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:18,opacity:.75}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let route = null; // {pts, ahead, flown, plane}

const dotIcon = L.divIcon({className:'ap-dot',html:'<div></div>',iconSize:[12,12],iconAnchor:[6,6]});
function drawRoute(from,to,withPlane){
  routeLayer.clearLayers();
  const pts = greatCircle(from,to);
  const ahead = L.polyline(pts,{color:'#e6cd94',weight:2.5,dashArray:'6 9',opacity:.95}).addTo(routeLayer);
  const flown = L.polyline([],{color:'#ffffff',weight:3.5,opacity:.95}).addTo(routeLayer);
  if(withPlane) [[pts[0],from],[pts[pts.length-1],to]].forEach(([p,a])=>
    L.marker(p,{icon:dotIcon,interactive:false}).addTo(routeLayer)
      .bindTooltip(a.code,{permanent:true,direction:'top',offset:[0,-8],className:'ap-tag'}));
  let plane=null;
  if(withPlane){
    plane=L.marker(pts[0],{icon:L.divIcon({className:'plane-icon',html:`<div class="plane">${PLANE_SVG}</div>`,iconSize:[44,44],iconAnchor:[22,22]}),interactive:false,zIndexOffset:1000}).addTo(routeLayer);
  }
  route={pts,ahead,flown,plane};
  return route;
}
// clickable airport boxes, shown while choosing a flight
const airportLayer = L.layerGroup().addTo(map);
const boxes = AIRPORTS.map(a=>L.marker([a.lat,a.lon],{
  icon:L.divIcon({className:'ap-box-wrap',html:`<div class="ap-box" title="${a.city}, ${a.country}">${a.code}</div>`,iconSize:[46,26],iconAnchor:[23,13]})
}).on('click',()=>pickAirport(a.code)).addTo(airportLayer));
// bigger airports first; smaller ones appear as you zoom in and there's room
const RANKED = AIRPORTS.map((a,i)=>i).sort((x,y)=>AIRPORTS[x].tier-AIRPORTS[y].tier);
const boxScale = ()=>Math.min(3.5,Math.max(.75,1.22**(map.getZoom()-3)));
function refreshBoxes(){
  const c=map.getCenter().lng, bs=boxScale(), shown=[];
  const isPicked=a=>a.code===settings.origin||(!!selected&&a.code===selected.a.code);
  [...RANKED.filter(i=>isPicked(AIRPORTS[i])),...RANKED.filter(i=>!isPicked(AIRPORTS[i]))].forEach(i=>{
    const a=AIRPORTS[i], m=boxes[i];
    m.setLatLng([a.lat,a.lon+360*Math.round((c-a.lon)/360)]); // keep boxes on the world copy in view
    const el=m.getElement(); if(!el)return;
    el.firstElementChild.classList.toggle('o',a.code===settings.origin);
    el.firstElementChild.classList.toggle('d',!!selected&&a.code===selected.a.code);
    const p=map.latLngToContainerPoint(m.getLatLng());
    const show=isPicked(a)||!shown.some(q=>Math.abs(q.x-p.x)<62*bs&&Math.abs(q.y-p.y)<38*bs);
    el.style.display=show?'':'none';
    if(show) shown.push(p);
  });
}
map.on('moveend',refreshBoxes);
// boxes grow as you zoom in
const scaleBoxes=()=>map.getContainer().style.setProperty('--bs',boxScale());
map.on('zoom',scaleBoxes); scaleBoxes();
function pickAirport(code){
  if(!settings.origin) setOrigin(code,false);
  else if(code===settings.origin) setOrigin(null,false);
  else selectDest(code);
}
function fitRoute(){
  const wide = innerWidth>760;
  map.fitBounds(route.ahead.getBounds(),{paddingTopLeft:wide?[450,60]:[30,60],paddingBottomRight:wide?[40,40]:[30,innerHeight*.66],maxZoom:6});
}
function pointAt(f){
  const pts=route.pts, idx=Math.min(f,1)*(pts.length-1), i=Math.min(Math.floor(idx),pts.length-2), t=idx-i;
  const a=pts[i], b=pts[i+1];
  return {pos:[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t], i, a, b};
}

/* ================= SETUP UI ================= */
let selected = null;
function renderSetup(){
  $('pPurpose').value = settings.purpose;
  $('origin').innerHTML = `<option value="" disabled ${settings.origin?'':'selected'}>Select departure airport</option>` +
    [...AIRPORTS].sort((a,b)=>a.city.localeCompare(b.city))
    .map(a=>`<option value="${a.code}" ${a.code===settings.origin?'selected':''}>${a.city} (${a.code}) · ${a.country}</option>`).join('');
  renderPurposes();
  $('lenChips').innerHTML = LENGTHS.map((l,i)=>`<button class="chip ${i===settings.len?'on':''}" data-l="${i}">${l[0]}</button>`).join('');
  $('faSwitch').classList.toggle('on',settings.attendant);
  $('chimeSwitch').classList.toggle('on',settings.chime);
  renderDestinations();
}
function renderPurposes(){
  $('purposeChips').innerHTML = settings.purposes.map(p=>`<span class="chip ${p===settings.purpose?'on':''}" data-p="${esc(p)}" role="button">${esc(p)}<button class="x" data-x="${esc(p)}" aria-label="Remove">×</button></span>`).join('');
}
function renderDestinations(){
  if(!settings.origin){$('destList').innerHTML='<div class="empty">Choose a departure airport first</div>';return}
  const o=AP[settings.origin], [,lo,hi]=LENGTHS[settings.len];
  const list = AIRPORTS.filter(a=>a.code!==o.code).map(a=>{const km=distKm(o,a);return {a,km,mins:focusMins(km),hrs:flightHours(km)}})
    .filter(d=>d.mins>=lo&&d.mins<hi).sort((x,y)=>x.mins-y.mins);
  $('destList').innerHTML = list.length ? list.map(d=>`
    <button class="dest ${selected&&selected.a.code===d.a.code?'on':''}" data-c="${d.a.code}">
      <span class="code">${d.a.code}</span>
      <span class="place">${d.a.city}<small>${d.a.country}</small></span>
      <span class="mins">${minsTxt(d.mins)}<small>${hm(d.hrs)}</small></span>
    </button>`).join('') : '<div class="empty">No routes of this length from here</div>';
  $('destList').querySelectorAll('.dest').forEach(b=>b.onclick=()=>selectDest(b.dataset.c));
}
function selectDest(code){
  const o=AP[settings.origin], a=AP[code], km=distKm(o,a);
  selected={a,km,mins:focusMins(km),hrs:flightHours(km)};
  renderDestinations(); updateSummary();
  drawRoute(o,a,false); fitRoute(); refreshBoxes();
}
function setOrigin(code,fly){
  settings.origin=code; selected=null; routeLayer.clearLayers();
  renderSetup(); updateSummary(); refreshBoxes();
  if(code&&fly) map.flyTo([AP[code].lat,AP[code].lon],4,{duration:1.2});
}
function updateSummary(){
  if(!selected){$('summary').textContent='Choose a destination';$('getTicket').disabled=true;return}
  $('summary').innerHTML=`<b>${settings.origin} → ${selected.a.code}</b> · ${hm(selected.hrs)} · <b>${minsTxt(selected.mins)}</b> focus`;
  $('getTicket').disabled=false;
}
function addPurpose(){
  const p=$('pPurpose').value.trim();
  if(p&&!settings.purposes.includes(p)){settings.purposes.push(p);saveSettings();renderPurposes()}
}
$('pPurpose').oninput=e=>{settings.purpose=e.target.value;renderPurposes();updateSummary()};
$('pPurpose').onkeydown=e=>{if(e.key==='Enter')addPurpose()};
$('addPurpose').onclick=addPurpose;
$('purposeChips').onclick=e=>{
  const x=e.target.dataset.x;
  if(x!=null){settings.purposes=settings.purposes.filter(p=>p!==x);saveSettings();renderPurposes();return}
  const chip=e.target.closest('.chip');if(!chip)return;
  settings.purpose=chip.dataset.p;$('pPurpose').value=settings.purpose;renderPurposes();updateSummary();
};
$('lenChips').onclick=e=>{const l=e.target.dataset.l;if(l==null)return;settings.len=+l;saveSettings();renderSetup()};
$('origin').onchange=e=>setOrigin(e.target.value,true);
$('faSwitch').onclick=()=>{settings.attendant=!settings.attendant;saveSettings();$('faSwitch').classList.toggle('on',settings.attendant)};
$('chimeSwitch').onclick=()=>{settings.chime=!settings.chime;saveSettings();$('chimeSwitch').classList.toggle('on',settings.chime)};

/* ================= TICKET ================= */
function barcode(seed,n=46){
  let s=0;for(const c of seed)s=(s*31+c.charCodeAt(0))>>>0;
  let out='';for(let i=0;i<n;i++){s=(s*1103515245+12345)>>>0;const w=1+(s>>>16)%3, g=1+(s>>>20)%3;out+=`<i style="width:${w}px;margin-right:${g}px"></i>`}
  return `<div class="barcode">${out}</div>`;
}
function ticketHTML(t,{mini=false}={}){
  const from=AP[t.from], to=AP[t.to];
  const stamp = t.status ? `<div class="stamp ${t.status.toLowerCase()}">${t.status}<small>${dateTxt(t.endedAt)}</small></div>` : '';
  return `
  <div class="ticket ${mini?'mini':''}">
    <div class="t-main">
      <div class="t-head"><span class="air">Cabin <i>Focus</i></span><span class="kind">Boarding Pass · Focus Class</span></div>
      <div class="t-body">
        <div class="t-route">
          <div class="ap"><div class="c">${from.code}</div><div class="n">${from.city}</div></div>
          <div class="mid">${PLANE_SVG.replace('fill="#fff" stroke="#0b1f3a" stroke-width="1.5"','fill="currentColor"')}</div>
          <div class="ap r"><div class="c">${to.code}</div><div class="n">${to.city}</div></div>
        </div>
        <div class="t-grid">
          <div class="wide"><div class="k">Purpose of travel</div><div class="v">${esc(t.purpose)}</div></div>
          <div><div class="k">Flight</div><div class="v">${t.flightNo}</div></div>
          <div><div class="k">Date</div><div class="v">${dateTxt(t.boardedAt||Date.now())}</div></div>
          ${mini?'':`<div><div class="k">Boarding</div><div class="v">${hhmm(t.boardedAt||Date.now())}</div></div>
          <div><div class="k">Gate</div><div class="v">${t.gate}</div></div>
          <div><div class="k">Seat</div><div class="v">${t.seat}</div></div>`}
          <div><div class="k">${t.status?'Focused':'Duration'}</div><div class="v">${minsTxt(t.status?t.focusedMins:t.mins)}</div></div>
          ${t.focusPct!=null?`<div><div class="k">Focus</div><div class="v">${t.focusPct}%</div></div>`:''}        </div>
        ${mini ? (t.fact?`<div class="lb-fact">${esc(t.fact)}</div>`:'') :
          `<div class="t-bar">${barcode(t.flightNo+t.to)}<span class="fact-hint">${Math.round(t.km).toLocaleString()} km · ${hm(flightHours(t.km))}</span></div>`}
        ${stamp}
      </div>
      <span class="t-cut"></span>
    </div>
    <div class="t-stub"><div class="in">
      <div><div class="k">Flight</div><div class="v big">${t.flightNo}</div></div>
      <div><div class="k">Route</div><div class="v" style="font-family:var(--ocr)">${from.code} → ${to.code}</div></div>
      <div><div class="k">Seat</div><div class="v">${t.seat}</div></div>
      ${mini?'':`<div><div class="k">Gate</div><div class="v">${t.gate}</div></div>`}
      ${barcode(t.seat+t.flightNo,mini?20:30)}
    </div><span class="t-cut"></span></div>
  </div>`;
}

function openModal(html){ $('modalRoot').innerHTML=`<div class="overlay">${html}</div>`; return $('modalRoot').firstElementChild; }
const closeModal = ()=>{$('modalRoot').innerHTML=''};

$('getTicket').onclick=()=>{
  if(!selected)return;
  const t={
    id:Date.now().toString(36), from:settings.origin, to:selected.a.code, km:selected.km, mins:selected.mins,
    purpose:settings.purpose.trim(),
    flightNo:'CF '+(100+Math.floor(Math.random()*900)), gate:pick('ABCDEF')+(1+Math.floor(Math.random()*30)),
    seat:(10+Math.floor(Math.random()*50))+pick(['A','K'])
  };
  const ov=openModal(`<div style="display:flex;flex-direction:column;align-items:center;width:100%">
    ${ticketHTML(t)}
    <div class="modal-actions"><button class="btn-ghost" id="mCancel">Back to departures</button><button class="btn-gold" id="mBoard">Tear &amp; board</button></div></div>`);
  $('mCancel').onclick=closeModal;
  $('mBoard').onclick=()=>{
    ov.querySelector('.ticket').classList.add('torn');
    $('mBoard').disabled=true;
    unlockAudio();
    setTimeout(()=>{closeModal();startFlight(t)},800);
  };
};

/* ================= FLIGHT ================= */
let tick=null;
function startFlight(t){
  t.boardedAt=Date.now();
  active={ticket:t,start:Date.now(),duration:t.mins*60000,paused:0,pausedAt:null,fa:0,exits:0,away:0,leftAt:null};
  save('cf_active',active);
  enterFlight();
  toast(`Welcome aboard ${t.flightNo} to ${AP[t.to].city}. Seatbelts fastened, focus on.`);
}
function enterFlight(){
  const t=active.ticket, from=AP[t.from], to=AP[t.to];
  $('setup').classList.add('hidden'); $('flight').classList.remove('hidden'); $('logbook').classList.remove('open');
  $('fPurpose').textContent=t.purpose;
  $('fPurposeBar').classList.toggle('hidden',!t.purpose);
  $('hFrom').textContent=from.code; $('hFromN').textContent=from.city;
  $('hTo').textContent=to.code; $('hToN').textContent=to.city;
  drawRoute(from,to,true);
  map.removeLayer(airportLayer);
  map.dragging.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); map.keyboard.disable();
  map.setView(pointAt(progress()).pos,5,{animate:false});
  updateFlight(); clearInterval(tick); tick=setInterval(updateFlight,1000);
}
const elapsed = ()=>((active.pausedAt||Date.now())-active.start-active.paused);
const progress = ()=>Math.min(1,Math.max(0,elapsed()/active.duration));

function updateFlight(){
  if(!active)return;
  const f=progress(), el=elapsed(), left=active.duration-el, t=active.ticket;
  const {pos,i,a,b}=pointAt(f);
  route.plane.setLatLng(pos);
  route.flown.setLatLngs(route.pts.slice(0,i+1).concat([pos]));
  route.ahead.setLatLngs([pos].concat(route.pts.slice(i+1)));
  const pa=map.latLngToLayerPoint(a), pb=map.latLngToLayerPoint(b);
  const ang=deg(Math.atan2(pb.x-pa.x,-(pb.y-pa.y)));
  const el2=route.plane.getElement(); if(el2)el2.querySelector('.plane').style.transform=`rotate(${ang}deg)`;
  if(!active.pausedAt) map.panTo(pos,{animate:true,duration:1,easeLinearity:1});

  const phase=Math.min(1,f/0.08,(1-f)/0.08);
  $('hTime').textContent=clock(left);
  $('hEta').textContent=active.pausedAt?'Holding pattern':`Arriving ${hhmm(Date.now()+left)} · ${AP[t.to].country}`;
  $('hFill').style.width=(f*100)+'%'; $('hPl').style.left=(f*100)+'%';
  $('sEl').textContent=clock(el);
  $('sDist').textContent=Math.round(t.km*(1-f)).toLocaleString()+' km';
  $('sAlt').textContent=(Math.round(11600*phase/100)*100).toLocaleString()+' m';
  $('sSpd').textContent=active.pausedAt?'—':Math.round(260+640*phase)+' km/h';
  $('hud').classList.toggle('paused',!!active.pausedAt);
  $('pauseBtn').textContent=active.pausedAt?'Resume':'Hold';

  // Flight Attendant: every 30 focused minutes
  const due=Math.floor(el/HALF_HOUR);
  if(due>active.fa){ active.fa=due; save('cf_active',active); if(settings.attendant&&left>0) attendant(due); }

  if(f>=1) land();
}

$('pauseBtn').onclick=()=>{
  if(active.pausedAt){active.paused+=Date.now()-active.pausedAt;active.pausedAt=null}
  else active.pausedAt=Date.now();
  save('cf_active',active); updateFlight();
};
$('divertBtn').onclick=()=>{
  openModal(`<div class="small-modal"><h3>Divert this flight?</h3>
    <p>You'll land early and the flight will be logged as diverted with ${minsTxt(Math.floor(elapsed()/60000))} focused.</p>
    <div class="modal-actions"><button class="btn-ghost" id="dNo">Stay on course</button><button class="btn-gold" id="dYes">Divert</button></div></div>`);
  $('dNo').onclick=closeModal;
  $('dYes').onclick=()=>{closeModal();finish('DIVERTED')};
};
$('fsBtn').onclick=()=>{
  if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(()=>{});
};
document.addEventListener('fullscreenchange',()=>{$('fsBtn').textContent=document.fullscreenElement?'Exit full screen':'Full screen'});

// stay in the cabin: notice when the tab is left
document.addEventListener('visibilitychange',()=>{
  if(!active||active.pausedAt)return;
  if(document.hidden){active.leftAt=Date.now();save('cf_active',active);return}
  if(active.leftAt){
    const away=Date.now()-active.leftAt; active.leftAt=null; active.away=(active.away||0)+away;
    if(away>3000){active.exits++;toast(`Keep your seatbelt on! You were away for ${clock(away)}.`)}
    save('cf_active',active); updateFlight();
  }
});
addEventListener('beforeunload',e=>{if(active&&!active.pausedAt){e.preventDefault();e.returnValue=''}});

function land(){ finish('LANDED'); }
function nextFact(country){
  const all=FACTS[country]||[], seen=logbook.filter(e=>e.fact&&AP[e.to]?.country===country).map(e=>e.fact);
  const unseen=all.filter(f=>!seen.includes(f));
  return pick(unseen.length?unseen:all.filter(f=>f!==seen[0]).concat(all.length===1?all:[]));
}
function finish(status){
  clearInterval(tick);
  const t=active.ticket, to=AP[t.to];
  const flownMs=Math.min(elapsed(),active.duration);
  const awayMs=(active.away||0)+(active.leftAt?Date.now()-active.leftAt:0);
  const focusedMins=Math.round(flownMs/60000);
  const focusPct=flownMs?Math.max(0,Math.min(100,Math.round(100*(1-awayMs/flownMs)))):0;
  const entry={...t,status,endedAt:Date.now(),focusedMins,focusPct,kmFlown:t.km*progress(),exits:active.exits,
    fact:status==='LANDED'?nextFact(to.country):null};
  logbook.unshift(entry); save('cf_logbook',logbook);
  active=null; save('cf_active',null);
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  chime();

  const head = status==='LANDED'
    ? `<div class="welcome"><div class="lbl">Flight ${t.flightNo} has landed</div><h2>Welcome to <i>${to.city}</i></h2></div>`
    : `<div class="welcome"><div class="lbl">Flight ${t.flightNo}</div><h2>Diverted <i>early</i></h2></div>`;
  const fact = entry.fact ? `<div class="fact"><h4>Did you know?</h4><p>${esc(entry.fact)}</p></div>` : '';
  openModal(`<div class="arrival">${head}${ticketHTML(entry)}${fact}
    <div class="modal-actions"><button class="btn-ghost" id="aLog">Open logbook</button><button class="btn-gold" id="aNew">Book next flight</button></div></div>`);
  const back=()=>{closeModal();exitFlight(status==='LANDED'?t.to:t.from)};
  $('aNew').onclick=back;
  $('aLog').onclick=()=>{back();openLog()};
}
function exitFlight(newOrigin){
  $('flight').classList.add('hidden'); $('setup').classList.remove('hidden');
  map.dragging.enable(); map.doubleClickZoom.enable(); map.boxZoom.enable(); map.keyboard.enable();
  airportLayer.addTo(map);
  setOrigin(newOrigin,false);
  map.flyTo([AP[newOrigin].lat,AP[newOrigin].lon],4,{duration:1.5});
}

/* ================= FLIGHT ATTENDANT ================= */
const FA_MSGS=[
  ['💧','Time for some water.','Take a few sips — staying hydrated keeps your focus sharp.'],
  ['👀','Rest your eyes.','Look at something about 6 metres away for 20 seconds, then blink slowly a few times.']
];
let bannerTimer=null;
function attendant(n){
  const [ico,msg,sub]=FA_MSGS[(n-1)%2];
  $('bIco').textContent=ico; $('bMsg').innerHTML=`${msg}<small>${sub}</small>`;
  $('banner').classList.add('show'); chime();
  clearTimeout(bannerTimer); bannerTimer=setTimeout(()=>$('banner').classList.remove('show'),25000);
}
$('bOk').onclick=()=>{$('banner').classList.remove('show');clearTimeout(bannerTimer)};

let toastTimer=null;
function toast(msg){$('toast').textContent=msg;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000)}

/* ================= CHIME ================= */
let actx=null;
function unlockAudio(){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();actx.resume()}catch{}}
function chime(){
  if(!settings.chime||!actx)return;
  [[784,0],[587,0.55]].forEach(([fq,dt])=>{
      const o=actx.createOscillator(), g=actx.createGain(), t0=actx.currentTime+dt;
      o.type='sine'; o.frequency.value=fq; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(.18,t0+.02); g.gain.exponentialRampToValueAtTime(.001,t0+1.3);
      o.start(t0); o.stop(t0+1.35);
  });
}
document.addEventListener('pointerdown',unlockAudio,{once:true});

/* ================= LOGBOOK ================= */
function openLog(){
  const landed=logbook.filter(e=>e.status==='LANDED');
  const mins=logbook.reduce((s,e)=>s+e.focusedMins,0);
  const km=logbook.reduce((s,e)=>s+(e.kmFlown||0),0);
  const countries=new Set(landed.map(e=>AP[e.to].country)).size;
  $('lbStats').innerHTML=[['Flights',landed.length],['Focus time',minsTxt(mins)],['Distance',Math.round(km).toLocaleString()+' km'],['Countries',countries]]
    .map(([k,v])=>`<div><div class="lbl">${k}</div><div class="v">${v}</div></div>`).join('');
  $('lbList').innerHTML=logbook.length?logbook.map(e=>ticketHTML(e,{mini:true})).join(''):'<div class="empty">No flights yet.</div>';
  $('logbook').classList.add('open');
}
$('openLog').onclick=openLog;
$('closeLog').onclick=()=>$('logbook').classList.remove('open');
$('clearLog').onclick=()=>{
  if(!logbook.length)return;
  openModal(`<div class="small-modal"><h3>Clear logbook?</h3><p>All ${logbook.length} boarding passes will be removed.</p>
    <div class="modal-actions"><button class="btn-ghost" id="cNo">Keep them</button><button class="btn-gold" id="cYes">Clear</button></div></div>`);
  $('cNo').onclick=closeModal;
  $('cYes').onclick=()=>{logbook=[];save('cf_logbook',logbook);closeModal();openLog()};
};

/* ================= BOOT ================= */
renderSetup(); updateSummary();
if(active && AP[active.ticket.from]){
  enterFlight();
  if(active.leftAt){active.away=(active.away||0)+Date.now()-active.leftAt;active.leftAt=null;save('cf_active',active)}
  toast('Resuming your flight. Seatbelts on.');
} else {
  active=null;
  // default start: last airport landed at, else the city in the Mac's time zone
  const last=logbook.find(e=>e.status==='LANDED');
  const tzCity=(Intl.DateTimeFormat().resolvedOptions().timeZone||'').split('/').pop().replace(/_/g,' ');
  const guess=last?last.to:AIRPORTS.find(a=>a.city===tzCity)?.code;
  if(guess){map.setView([AP[guess].lat,AP[guess].lon],4);setOrigin(guess,false)}
  else map.setView([20,30],2);
}
