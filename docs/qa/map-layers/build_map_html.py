"""Builds the map prototype v3 page from build_map_data.py output. Usage: build_map_html.py data.json roads.geojson icons_svg.json maplibre.css geo.json out.html"""
import json, sys
data, roads, icons, css, geo, out = sys.argv[1:7]
g = json.load(open(geo))
logo = (f'<svg viewBox="0 0 73.08 23.46" height="26" role="img" aria-label="FARQ B2B"><path d="{g["FARQ"]}" fill="currentColor" fill-rule="evenodd"/>'
        f'<rect x="56.220" y="16.110" width="16.660" height="7.200" rx="3.600" fill="#008060"/>'
        f'<path transform="translate(59.020 21.710) scale(0.005714)" d="{g["B2B"]}" fill="#fff"/></svg>')
HTML = r'''<title>طبقات خريطة الفرص</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">
<style>__CSS__</style>
<style>
/* Layout: control panel on the right (RTL), map on the left with a live counter strip on top and a profile drawer; nothing on the map until a district is chosen. */
:root{
  --bg:#f1f1f1; --surface:#ffffff; --ink:#303030; --muted:#616161; --line:#e3e3e3; --soft:#f6f6f6;
  --l1:#303030; --l2:#008060; --l3:#2b4c7e; --sand:#c8a97e;
  --land:#eceeec; --road:#ffffff; --road-case:#d3d6d3; --major:#fafafa; --major-case:#bfc3bf;
  --hood:#303030; --hood-on:#008060;
  --shadow:0 8px 28px rgba(30,34,30,.14);
  --font:'IBM Plex Sans Arabic',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#181918; --surface:#232523; --ink:#ededed; --muted:#a3a7a3; --line:#353835; --soft:#2b2d2b;
  --l1:#f2f2f2; --l2:#2fb487; --l3:#7d9fd6; --sand:#c8a97e;
  --land:#1d1f1d; --road:#3a3d3a; --road-case:#2a2c2a; --major:#4a4e4a; --major-case:#2f322f; --hood:#ededed; --hood-on:#2fb487;
  --shadow:0 8px 28px rgba(0,0,0,.5); color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#181918; --surface:#232523; --ink:#ededed; --muted:#a3a7a3; --line:#353835; --soft:#2b2d2b;
  --l1:#f2f2f2; --l2:#2fb487; --l3:#7d9fd6; --sand:#c8a97e;
  --land:#1d1f1d; --road:#3a3d3a; --road-case:#2a2c2a; --major:#4a4e4a; --major-case:#2f322f; --hood:#ededed; --hood-on:#2fb487;
  --shadow:0 8px 28px rgba(0,0,0,.5); color-scheme:dark}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--font);margin:0}
.app{height:100%;display:grid;grid-template-columns:360px 1fr;direction:rtl}
.panel{background:var(--surface);border-inline-end:1px solid var(--line);display:flex;flex-direction:column;min-height:0;overflow:auto}
.mapwrap{position:relative;min-height:0}
#map{position:absolute;inset:0}
.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 6px}
.brand small{color:var(--muted);font-size:12px}
.sec{padding:10px 18px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.sec h2{margin:0;font-size:13px;font-weight:600;color:var(--muted);display:flex;justify-content:space-between;align-items:center}
.layers{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.layers button,.btn{font:inherit;font-size:12.5px;font-weight:600;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:9px 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px;line-height:1.25}
.layers button[aria-pressed="true"]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.layers .sw{height:24px;display:grid;place-items:center}
.row{display:flex;gap:6px;flex-wrap:wrap}
.btn{flex-direction:row;padding:6px 10px;border-radius:999px;font-weight:500}
.chip{font:inherit;font-size:12.5px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:5px 10px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.chip .n{color:var(--muted);font-variant-numeric:tabular-nums;font-size:11.5px}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)} .chip[aria-pressed="true"] .n{color:inherit;opacity:.8}
button:focus-visible{outline:2px solid var(--l2);outline-offset:2px}
.search input{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.list{padding:2px 10px 16px}
.item{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:10px;width:100%;text-align:start;font:inherit;font-size:13.5px;color:var(--ink);background:none;border:0;border-radius:10px;padding:6px 8px;cursor:pointer}
.item:hover{background:var(--soft)} .item[aria-pressed="true"]{background:var(--soft);box-shadow:inset 0 0 0 1px var(--line)}
.item .n{color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px}
.item img{width:28px;height:28px;object-fit:contain}
details>summary{list-style:none;cursor:pointer;position:relative} details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";position:absolute;inset-inline-end:6px;top:50%;width:7px;height:7px;border-inline-start:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);transform:translateY(-70%) rotate(-45deg);transition:transform .15s}
details[open]>summary::before{transform:translateY(-40%) rotate(-135deg)} details>summary.leaf::before{display:none}
details>summary .item{padding-inline-end:24px} details.sub{margin-inline-start:18px;border-inline-start:1px solid var(--line);padding-inline-start:4px}
.item.lvl3{margin-inline-start:22px;width:calc(100% - 22px);grid-template-columns:26px 1fr auto;font-size:13px} .item.lvl1{font-weight:600}
.empty{color:var(--muted);font-size:13px;padding:8px 8px 16px;line-height:1.7}
/* live counters */
.counters{position:absolute;top:12px;inset-inline:12px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-start;pointer-events:none;z-index:2}
.ctr{pointer-events:auto;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:12px;padding:7px 12px;min-width:84px;display:flex;flex-direction:column;gap:1px}
.ctr b{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.3px;transition:color .3s}
.ctr span{font-size:11.5px;color:var(--muted)}
.ctr.up b{color:var(--l2)} .ctr.down b{color:#b42318}
.ctr.lead{background:var(--ink);color:var(--surface);border-color:var(--ink)} .ctr.lead span{color:inherit;opacity:.75} .ctr.lead.up b,.ctr.lead.down b{color:inherit}
.hint{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:999px;padding:8px 16px;font-size:13px;z-index:2;white-space:nowrap}
/* district labels */
.hl{font-family:var(--font);font-size:12px;font-weight:600;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:3px 9px;box-shadow:0 2px 8px rgba(0,0,0,.08);cursor:pointer;white-space:nowrap}
.hl.on{background:var(--hood-on);color:#fff;border-color:var(--hood-on)}
/* profile drawer */
.drawer{position:absolute;top:0;bottom:0;inset-inline-end:0;width:min(380px,92%);background:var(--surface);box-shadow:var(--shadow);z-index:3;transform:translateX(-105%);transition:transform .25s ease;display:flex;flex-direction:column;overflow:auto}
.drawer.open{transform:none}
.dh{padding:18px 18px 10px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border-bottom:1px solid var(--line)}
.dh h3{margin:0;font-size:18px;line-height:1.4;text-wrap:balance}
.dh .x{font:inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;width:34px;height:34px;cursor:pointer;flex:none}
.db{padding:14px 18px;display:flex;flex-direction:column;gap:14px}
.path{font-size:13px;color:var(--muted);line-height:1.8}
.path b{color:var(--ink);font-weight:600}
.badges{display:flex;gap:6px;flex-wrap:wrap}
.bdg{font-size:12px;padding:4px 9px;border-radius:999px;border:1px solid var(--line);display:inline-flex;gap:5px;align-items:center}
.bdg.role{background:var(--soft)} .bdg.ws{background:#c8a97e26;border-color:var(--sand)} .bdg.ok{background:#00806014;border-color:#00806066}
.bdg.spec{background:#2b4c7e14;border-color:#2b4c7e55}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
.kv dt{color:var(--muted)} .kv dd{margin:0}
.meter{height:6px;border-radius:99px;background:var(--soft);overflow:hidden} .meter i{display:block;height:100%;background:var(--l2)}
.note{font-size:12px;color:var(--muted);background:var(--soft);border-radius:10px;padding:10px 12px;line-height:1.7}
.foot{padding:10px 18px;color:var(--muted);font-size:11.5px;line-height:1.6;margin-top:auto}
@media (max-width:760px){
  .app{grid-template-columns:1fr;grid-template-rows:58% 1fr}
  .mapwrap{grid-row:1} .panel{grid-row:2;border:0;border-top:1px solid var(--line)}
  .brand,.sec,.foot{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
  .ctr{min-width:70px;padding:5px 9px} .ctr b{font-size:16px}
  .counters{top:8px;inset-inline:8px}
}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}
</style>
<div class="app">
  <aside class="panel" aria-label="لوحة التحكم">
    <div class="brand">__LOGO__<small>وسط الرياض · بيانات حقيقية</small></div>
    <div class="sec"><h2>الطبقة</h2>
      <div class="layers" role="group" aria-label="اختر الطبقة">
        <button id="b1" type="button" aria-pressed="true"><span class="sw" id="sw1"></span>الأنشطة الرئيسية</button>
        <button id="b2" type="button" aria-pressed="false"><span class="sw" id="sw2"></span>الأنشطة الفرعية</button>
        <button id="b3" type="button" aria-pressed="false"><span class="sw" id="sw3"></span>التخصصات</button>
      </div></div>
    <div class="sec"><h2>الأحياء <span class="row"><button class="btn" id="all" type="button">الكل</button><button class="btn" id="none" type="button">إزالة الكل</button></span></h2>
      <div class="row" id="hoods"></div></div>
    <div class="sec"><h2>الشارات</h2><div class="row" id="roles"></div></div>
    <div class="sec"><h2>الدليل</h2><div class="search"><input id="q" type="search" placeholder="ابحث: سباكة، كهرباء، عوازل…" autocomplete="off"></div></div>
    <div class="list" id="list" role="list"></div>
    <div class="foot">تظهر المحلات بعد اختيار حي من الخريطة أو من القائمة. استُبعدت المحلات ذات الموقع التقريبي. لا تظهر أي أرقام تواصل. الأيقونات: Tabler (MIT) · الشوارع: OpenStreetMap · الأحياء: الحدود الرسمية.</div>
  </aside>
  <div class="mapwrap">
    <div id="map" aria-label="الخريطة"></div>
    <div class="counters" id="counters" aria-live="polite"></div>
    <div class="hint" id="hint">اضغط على حي في الخريطة لعرض محلاته</div>
    <aside class="drawer" id="drawer" aria-label="ملف المنشأة" aria-hidden="true"></aside>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js"></script>
<script>
const D=__DATA__, ICONS=__ICONS__, ROADS=__ROADS__;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt=n=>Math.round(n).toLocaleString('ar-SA');
let layer=1, focus=null, sel=new Set(), roleMask=0, map, thumbs={};
// ---------- icons
const svgIcon=(name,color)=>'<g fill="none" stroke="'+color+'" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+(ICONS[name]||ICONS['map-pin'])+'</g>';
const pinSVG=name=>'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 47c-1.2 0-2-.9-2.6-1.8L11 35.6A17 17 0 1 1 29 35.6l-6.4 9.6c-.6.9-1.4 1.8-2.6 1.8z" fill="'+css('--l1')+'" stroke="'+css('--surface')+'" stroke-width="2"/><g transform="translate(9 7) scale(.92)">'+svgIcon(name,css('--surface'))+'</g></svg>';
const circSVG=name=>'<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="'+css('--l2')+'" stroke="'+css('--surface')+'" stroke-width="2.5"/><g transform="translate(8.2 8.2) scale(.9)">'+svgIcon(name,'#ffffff')+'</g></svg>';
const chipSVG=(w,h)=>'<svg width="'+w+'" height="'+h+'" viewBox="0 0 30 22" aria-hidden="true"><rect x="1" y="3" width="28" height="13" rx="4" fill="'+css('--l3')+'"/><path d="M12 16l3 4 3-4z" fill="'+css('--l3')+'"/></svg>';
const load=svg=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
function chip(text){const s=2,c=document.createElement('canvas'),x=c.getContext('2d'),font='600 '+(12*s)+'px '+css('--font');x.font=font;const t=text.length>26?text.slice(0,25)+'…':text;const w=Math.ceil(x.measureText(t).width)+22*s,h=32*s;c.width=w;c.height=h;x.font=font;x.fillStyle=css('--l3');x.beginPath();x.roundRect(0,0,w,26*s,8*s);x.fill();x.beginPath();x.moveTo(w/2-5*s,26*s);x.lineTo(w/2,32*s);x.lineTo(w/2+5*s,26*s);x.fill();x.fillStyle='#fff';x.direction='rtl';x.textAlign='center';x.textBaseline='middle';x.fillText(t,w/2,13*s+1);return {width:w,height:h,data:x.getImageData(0,0,w,h).data}}
async function images(){const jobs=[];
  D.mains.forEach((m,i)=>jobs.push(load(pinSVG(m.icon)).then(im=>{if(map.hasImage('m'+i))map.removeImage('m'+i);map.addImage('m'+i,im);thumbs['m'+i]=im.src})));
  D.subs.forEach((s,i)=>jobs.push(load(circSVG(s.icon)).then(im=>{if(map.hasImage('s'+i))map.removeImage('s'+i);map.addImage('s'+i,im);thumbs['s'+i]=im.src})));
  await Promise.all(jobs);
  D.specs.forEach((t,i)=>{if(map.hasImage('x'+i))map.removeImage('x'+i);map.addImage('x'+i,chip(t),{pixelRatio:2})})}
// ---------- data
const P=D.pts; // [lon,lat,hood,main,sub,[specs],name,roleBits,wholesale,wa,cr,complete,street,sources,hours,rating]
const ROLE_ICON={'يبيع':'↗','يشتري':'↙','جملة':'▦','تجزئة':'◫','مصنع':'⚙','خدمات وتنفيذ':'⚒'};
function visible(i){const p=P[i];if(!sel.has(p[2]))return false;if(roleMask&&!(p[7]&roleMask)&&!(roleMask&4&&p[8]))return false;
  if(focus==null)return layer!==3||p[5].length>0;return layer===1?p[3]===focus:layer===2?p[4]===focus:p[5].includes(focus)}
function geo(){return {type:'FeatureCollection',features:P.map((p,i)=>({type:'Feature',id:i,properties:{i,h:p[2],m:p[3],s:p[4],x:p[5].length?p[5][0]:-1},geometry:{type:'Point',coordinates:[p[0],p[1]]}}))}}
// ---------- live counters (count up / down with motion)
const CTR=[['n','منشأة',1],['hoods','حي مختار'],['subs','نشاط فرعي'],['specs','تخصص'],['ws','جملة'],['fac','مصنع'],['wa','قناة واتساب'],['cr','سجل تجاري'],['svc','خدمات وتنفيذ']];
const shown={};
function stats(){const s={n:0,hoods:sel.size,subs:new Set(),specs:new Set(),ws:0,fac:0,wa:0,cr:0,svc:0};
  for(let i=0;i<P.length;i++){if(!visible(i))continue;const p=P[i];s.n++;s.subs.add(p[4]);p[5].forEach(x=>s.specs.add(x));if(p[8]||p[7]&4)s.ws++;if(p[7]&16)s.fac++;if(p[9])s.wa++;if(p[10])s.cr++;if(p[7]&32)s.svc++}
  s.subs=s.subs.size;s.specs=s.specs.size;return s}
function renderCounters(){const s=stats(),box=document.getElementById('counters');
  if(!box.children.length)box.innerHTML=CTR.map(([k,l,lead])=>'<div class="ctr'+(lead?' lead':'')+'" id="c-'+k+'"><b>0</b><span>'+l+'</span></div>').join('');
  CTR.forEach(([k])=>{const el=document.getElementById('c-'+k),b=el.firstChild,from=shown[k]||0,to=s[k];if(from===to)return;shown[k]=to;
    el.classList.remove('up','down');void el.offsetWidth;el.classList.add(to>from?'up':'down');
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){b.textContent=fmt(to);return}
    const t0=performance.now(),dur=700;const step=t=>{const k2=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k2,3);b.textContent=fmt(from+(to-from)*e);if(k2<1)requestAnimationFrame(step);else setTimeout(()=>el.classList.remove('up','down'),900)};requestAnimationFrame(step)});
  document.getElementById('hint').hidden=sel.size>0}
// ---------- map filters
function applyFilter(){
  const base=['in',['get','h'],['literal',[...sel]]];
  const keep=[];for(let i=0;i<P.length;i++)if(visible(i))keep.push(i);
  const f=['in',['get','i'],['literal',keep]];
  ['L1','L2','L3','dots'].forEach(id=>map.setFilter(id,id==='L3'?['all',f,['>=',['get','x'],0]]:f));
  if(layer===3&&focus!=null){map.setLayoutProperty('L3','icon-image','x'+focus)}else{map.setLayoutProperty('L3','icon-image',['concat','x',['to-string',['get','x']]])}
  D.polys.features.forEach(ft=>map.setFeatureState({source:'hoods',id:ft.id},{on:sel.has(ft.id)}));
  document.querySelectorAll('.hl').forEach(el=>el.classList.toggle('on',sel.has(+el.dataset.h)));
  renderCounters();renderHoods();renderList()}
function setLayer(n,keep){layer=n;if(!keep)focus=null;[1,2,3].forEach(k=>{document.getElementById('b'+k).setAttribute('aria-pressed',String(k===n));map.setLayoutProperty('L'+k,'visibility',k===n?'visible':'none')});applyFilter()}
function toggleHood(h){sel.has(h)?sel.delete(h):sel.add(h);applyFilter();if(sel.size===1&&sel.has(h))fitHood(h)}
function fitHood(h){const ft=D.polys.features.find(f=>f.id===h);if(!ft)return;const b=new maplibregl.LngLatBounds();(ft.geometry.type==='Polygon'?[ft.geometry.coordinates]:ft.geometry.coordinates).forEach(poly=>poly[0].forEach(c=>b.extend(c)));map.fitBounds(b,{padding:80,maxZoom:16.2,duration:700})}
// ---------- panel
const cnt=(test)=>{let n=0;for(let i=0;i<P.length;i++){if(test(P[i]))n++}return n};
function renderHoods(){const box=document.getElementById('hoods');const counts=D.hoods.map((_,h)=>cnt(p=>p[2]===h));
  box.innerHTML='';D.hoods.map((n,h)=>({n,h,c:counts[h]})).sort((a,b)=>b.c-a.c).forEach(({n,h,c})=>{const b=document.createElement('button');b.type='button';b.className='chip';b.setAttribute('aria-pressed',String(sel.has(h)));b.innerHTML=n+' <span class="n">'+fmt(c)+'</span>';b.onclick=()=>toggleHood(h);box.appendChild(b)})}
function renderRoles(){const box=document.getElementById('roles');box.innerHTML='';D.roles.forEach((r,k)=>{const b=document.createElement('button');b.type='button';b.className='chip';b.setAttribute('aria-pressed',String(!!(roleMask&(1<<k))));b.textContent=r;b.onclick=()=>{roleMask^=(1<<k);renderRoles();applyFilter()};box.appendChild(b)})}
const icon=(lvl,i)=>lvl===3?chipSVG(26,20):'<img alt="" src="'+thumbs[(lvl===1?'m':'s')+i]+'">';
function row(lvl,i,t,n){const b=document.createElement('button');b.type='button';b.className='item lvl'+lvl;b.setAttribute('aria-pressed',String(layer===lvl&&focus===i));b.innerHTML=icon(lvl,i)+'<span>'+t+'</span><span class="n">'+fmt(n)+'</span>';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();const dd=b.closest('details');if(dd&&lvl<3)dd.open=true;const was=layer===lvl&&focus===i;if(layer!==lvl)setLayer(lvl,true);focus=was?null:i;applyFilter()};return b}
function renderList(){const L=document.getElementById('list');
  if(!sel.size){L.innerHTML='<p class="empty">اختر حياً أو أكثر لعرض أنشطته وتخصصاته هنا.</p>';return}
  const q=document.getElementById('q').value.trim(),hit=t=>!q||t.includes(q);
  const open=new Set([...L.querySelectorAll('details[open]')].map(d=>d.dataset.k));L.innerHTML='';
  const C1=new Map(),C2=new Map(),C3=new Map(),specSub=new Map();
  for(const p of P){if(!sel.has(p[2]))continue;if(roleMask&&!(p[7]&roleMask)&&!(roleMask&4&&p[8]))continue;C1.set(p[3],(C1.get(p[3])||0)+1);C2.set(p[4],(C2.get(p[4])||0)+1);p[5].forEach(x=>{C3.set(x,(C3.get(x)||0)+1);const m=specSub.get(x)||new Map();m.set(p[4],(m.get(p[4])||0)+1);specSub.set(x,m)})}
  const top=m=>[...m.entries()].sort((a,b)=>b[1]-a[1])[0][0];const specsOf=new Map();specSub.forEach((m,x)=>{const s=top(m);(specsOf.get(s)||specsOf.set(s,[]).get(s)).push(x)});
  const subsOf=new Map();C2.forEach((n,s)=>{const m=D.subs[s].main;(subsOf.get(m)||subsOf.set(m,[]).get(m)).push(s)});
  [...C1.keys()].sort((a,b)=>C1.get(b)-C1.get(a)).forEach(mi=>{
    const subs=(subsOf.get(mi)||[]).sort((a,b)=>C2.get(b)-C2.get(a));
    const subMatch=subs.filter(si=>hit(D.subs[si].ar)||(specsOf.get(si)||[]).some(x=>hit(D.specs[x])));
    if(q&&!hit(D.mains[mi].ar)&&!subMatch.length)return;
    const d=document.createElement('details');d.dataset.k='m'+mi;d.open=open.has('m'+mi)||!!q;
    const sm=document.createElement('summary');sm.appendChild(row(1,mi,D.mains[mi].ar,C1.get(mi)));d.appendChild(sm);
    (q&&!hit(D.mains[mi].ar)?subMatch:subs).forEach(si=>{const specs=(specsOf.get(si)||[]).sort((a,b)=>C3.get(b)-C3.get(a)).filter(x=>!q||hit(D.subs[si].ar)||hit(D.mains[mi].ar)||hit(D.specs[x]));
      const ds=document.createElement('details');ds.className='sub';ds.dataset.k='s'+si;ds.open=open.has('s'+si)||(!!q&&specs.length&&!hit(D.subs[si].ar));
      const ss=document.createElement('summary');ss.appendChild(row(2,si,D.subs[si].ar,C2.get(si)));if(!specs.length)ss.classList.add('leaf');ds.appendChild(ss);
      specs.forEach(x=>ds.appendChild(row(3,x,D.specs[x],C3.get(x))));d.appendChild(ds)});
    L.appendChild(d)})}
// ---------- profile drawer (no phone, no email, no contact of any kind)
function profile(i){const p=P[i],m=D.mains[p[3]],s=D.subs[p[4]],dr=document.getElementById('drawer');
  const roles=D.roles.filter((r,k)=>p[7]&(1<<k));if(p[8]&&!roles.includes('جملة'))roles.push('جملة');
  dr.innerHTML='<div class="dh"><h3>'+esc(p[6])+'</h3><button class="x" id="dx" type="button" aria-label="إغلاق">✕</button></div><div class="db">'+
   '<div class="path"><b>'+m.ar+'</b> ← '+s.ar+'</div>'+
   (roles.length?'<div><div class="path">الدور</div><div class="badges">'+roles.map(r=>'<span class="bdg '+(r==='جملة'?'ws':'role')+'">'+(ROLE_ICON[r]||'')+' '+r+'</span>').join('')+'</div></div>':'')+
   (p[5].length?'<div><div class="path">التخصصات</div><div class="badges">'+p[5].map(x=>'<span class="bdg spec">'+D.specs[x]+'</span>').join('')+'</div></div>':'<div class="note">لم يُحدَّد تخصص لهذه المنشأة بعد؛ تظهر ضمن نشاطها الفرعي «'+s.ar+'».</div>')+
   '<div class="badges">'+(p[9]?'<span class="bdg ok">قناة واتساب متاحة للإرسال عبر فرق</span>':'<span class="bdg">لا توجد قناة واتساب بعد</span>')+(p[10]?'<span class="bdg ok">موثّقة بسجل تجاري</span>':'')+'</div>'+
   '<dl class="kv"><dt>الحي</dt><dd>'+D.hoods[p[2]]+'</dd>'+(p[12]?'<dt>الشارع</dt><dd>'+esc(p[12])+'</dd>':'')+(p[15]?'<dt>التقييم</dt><dd>'+p[15].toLocaleString('ar-SA')+' من ٥</dd>':'')+(p[14]?'<dt>ساعات العمل</dt><dd>متوفرة</dd>':'')+'<dt>المصادر</dt><dd>'+fmt(p[13])+' مصدر</dd></dl>'+
   '<div><div class="path">اكتمال بيانات المنشأة: '+fmt(p[11])+'٪</div><div class="meter"><i style="width:'+Math.min(100,p[11])+'%"></i></div></div>'+
   '<div class="note">بيانات التواصل لا تظهر للمستخدم. التواصل يتم عبر فرق بالقوالب المعتمدة.</div></div>';
  dr.classList.add('open');dr.setAttribute('aria-hidden','false');document.getElementById('dx').onclick=()=>{dr.classList.remove('open');dr.setAttribute('aria-hidden','true')}}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// ---------- style
const MAJOR=['primary','secondary','trunk','motorway','primary_link','secondary_link','trunk_link','motorway_link'];
function style(){return {version:8,sources:{roads:{type:'geojson',data:ROADS},hoods:{type:'geojson',data:D.polys,promoteId:'i'},pts:{type:'geojson',data:geo()}},layers:[
  {id:'bg',type:'background',paint:{'background-color':css('--land')}},
  {id:'minor-case',type:'line',source:'roads',filter:['!',['in',['get','hw'],['literal',MAJOR]]],paint:{'line-color':css('--road-case'),'line-width':['interpolate',['linear'],['zoom'],12,.6,17,9]}},
  {id:'major-case',type:'line',source:'roads',filter:['in',['get','hw'],['literal',MAJOR]],paint:{'line-color':css('--major-case'),'line-width':['interpolate',['linear'],['zoom'],12,2,17,20]}},
  {id:'minor',type:'line',source:'roads',filter:['!',['in',['get','hw'],['literal',MAJOR]]],paint:{'line-color':css('--road'),'line-width':['interpolate',['linear'],['zoom'],12,.3,17,7]}},
  {id:'major',type:'line',source:'roads',filter:['in',['get','hw'],['literal',MAJOR]],paint:{'line-color':css('--major'),'line-width':['interpolate',['linear'],['zoom'],12,1.4,17,17]}},
  {id:'hood-fill',type:'fill',source:'hoods',paint:{'fill-color':['case',['boolean',['feature-state','on'],false],css('--hood-on'),css('--hood')],'fill-opacity':['case',['boolean',['feature-state','on'],false],.10,['boolean',['feature-state','hover'],false],.08,.02]}},
  {id:'hood-line',type:'line',source:'hoods',paint:{'line-color':['case',['boolean',['feature-state','on'],false],css('--hood-on'),css('--hood')],'line-opacity':['case',['boolean',['feature-state','on'],false],.9,.35],'line-width':['case',['boolean',['feature-state','on'],false],2.2,1],'line-dasharray':[3,2]}},
  {id:'dots',type:'circle',source:'pts',filter:['==',1,0],paint:{'circle-radius':2.2,'circle-color':css('--muted'),'circle-opacity':.4}},
  {id:'L1',type:'symbol',source:'pts',filter:['==',1,0],layout:{'icon-image':['concat','m',['to-string',['get','m']]],'icon-anchor':'bottom','icon-size':['interpolate',['linear'],['zoom'],13,.6,17,1],'icon-padding':1,visibility:'visible'}},
  {id:'L2',type:'symbol',source:'pts',filter:['==',1,0],layout:{'icon-image':['concat','s',['to-string',['get','s']]],'icon-size':['interpolate',['linear'],['zoom'],13,.6,17,1],'icon-padding':1,visibility:'none'}},
  {id:'L3',type:'symbol',source:'pts',filter:['==',1,0],layout:{'icon-image':['concat','x',['to-string',['get','x']]],'icon-anchor':'bottom','icon-padding':2,visibility:'none'}}]}}
function labels(){D.polys.features.forEach(ft=>{const b=new maplibregl.LngLatBounds();(ft.geometry.type==='Polygon'?[ft.geometry.coordinates]:ft.geometry.coordinates).forEach(poly=>poly[0].forEach(c=>b.extend(c)));
  const el=document.createElement('button');el.type='button';el.className='hl';el.dataset.h=ft.id;el.textContent=ft.properties.ar;el.onclick=e=>{e.stopPropagation();toggleHood(ft.id)};new maplibregl.Marker({element:el}).setLngLat(b.getCenter()).addTo(map)})}
function sw(){document.getElementById('sw1').innerHTML=pinSVG('building-store').replace('width="40" height="48"','width="20" height="24"');document.getElementById('sw2').innerHTML=circSVG('droplet').replace('width="38" height="38"','width="22" height="22"');document.getElementById('sw3').innerHTML=chipSVG(28,20)}
map=new maplibregl.Map({container:'map',style:style(),center:[46.7365,24.672],zoom:13.3,minZoom:12,maxZoom:18.5,attributionControl:false,maxBounds:[[46.66,24.61],[46.81,24.73]]});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-left');
let hovered=null;
map.on('mousemove','hood-fill',e=>{const id=e.features[0].id;if(hovered!==null&&hovered!==id)map.setFeatureState({source:'hoods',id:hovered},{hover:false});hovered=id;map.setFeatureState({source:'hoods',id},{hover:true});map.getCanvas().style.cursor='pointer'});
map.on('mouseleave','hood-fill',()=>{if(hovered!==null)map.setFeatureState({source:'hoods',id:hovered},{hover:false});hovered=null;map.getCanvas().style.cursor=''});
map.on('click',e=>{const f=map.queryRenderedFeatures(e.point,{layers:['L1','L2','L3']});if(f.length){profile(f[0].properties.i);return}const h=map.queryRenderedFeatures(e.point,{layers:['hood-fill']});if(h.length)toggleHood(h[0].id)});
['L1','L2','L3'].forEach(id=>{map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer')});
map.on('load',async()=>{sw();await images();labels();renderRoles();setLayer(1)});
[1,2,3].forEach(k=>document.getElementById('b'+k).onclick=()=>setLayer(k));
document.getElementById('all').onclick=()=>{D.hoods.forEach((_,h)=>sel.add(h));applyFilter()};
document.getElementById('none').onclick=()=>{sel.clear();focus=null;applyFilter()};
document.getElementById('q').oninput=renderList;
</script>'''
html = (HTML.replace('__CSS__', open(css).read()).replace('__LOGO__', logo).replace('__DATA__', open(data).read())
        .replace('__ICONS__', open(icons).read()).replace('__ROADS__', open(roads).read()))
open(out, 'w').write(html); print(len(html) // 1024, 'KB')
