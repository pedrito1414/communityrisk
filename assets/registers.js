import { riskDefinitionHTML } from './definitions.js';
import { loadData } from './data.js';
import { ratingRank, calculatedPriority, commonRanking, priorityCompare } from './ranking.js';
import { showLoadError, trackEvent } from './shared.js';

async function initialise(){
const db=await loadData();
const FEATURES=db.boundaries.features.map(f=>({...f.properties,geometry:f.geometry}));
const DATA=Object.fromEntries(db.forums.map(f=>[f.code,{...f,risks:db.risks.filter(r=>r.forum_code===f.code)}]));
const NATIONAL_RISKS=db.nationalRisks,CROSSWALK=db.matches;
const REGISTER_URLS=Object.fromEntries(db.forums.map(f=>[f.code,f.source_url]));

let selectedNational='';
const nationalSearch=document.getElementById('nationalSearch');
const nationalSuggestions=document.getElementById('nationalSuggestions');
const nationalTree=document.getElementById('nationalTree');
const nationalSelected=document.getElementById('nationalSelected');
let suggestIndex=-1, suggestionItems=[];
const nationalCategories=[...new Set(NATIONAL_RISKS.map(n=>n.category))];
for(const category of nationalCategories){
 const risks=NATIONAL_RISKS.filter(n=>n.category===category);
 const section=document.createElement('details');section.className='national-category';
 const heading=document.createElement('summary');heading.textContent=category+' ('+risks.length+')';section.appendChild(heading);
 const list=document.createElement('div');list.className='national-category-items';
 for(const n of risks){const btn=document.createElement('button');btn.type='button';btn.className='national-risk-item';btn.dataset.nationalId=n.national_id;btn.textContent=n.national_risk;btn.title='Show national description and linked local records';btn.addEventListener('click',()=>selectNationalRisk(n.national_id));list.appendChild(btn)}
 section.appendChild(list);nationalTree.appendChild(section);
}
document.getElementById('expandNational').onclick=()=>nationalTree.querySelectorAll('details').forEach(d=>d.open=true);
document.getElementById('collapseNational').onclick=()=>nationalTree.querySelectorAll('details').forEach(d=>d.open=false);
function hideSuggestions(){nationalSuggestions.hidden=true;nationalSearch.setAttribute('aria-expanded','false');suggestIndex=-1}
function selectNationalRisk(id){if(id)trackEvent('national-selected',id);selectedNational=id;const n=NATIONAL_RISKS.find(x=>x.national_id===id);
 nationalSearch.value='';hideSuggestions();
 nationalSelected.hidden=!n;
 nationalSelected.innerHTML=n?`<span>Selected: <strong>${esc(n.national_risk)}</strong></span><button type="button" id="clearNational" aria-label="Clear national risk filter">× Clear</button>`:'';
 if(n)document.getElementById('clearNational').onclick=()=>selectNationalRisk('');
 nationalTree.querySelectorAll('.national-risk-item').forEach(b=>{const on=b.dataset.nationalId===id;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false')});
 updateNational();
}
function updateSuggestions(){const q=nationalSearch.value.trim().toLocaleLowerCase();suggestIndex=-1;
 suggestionItems=q?NATIONAL_RISKS.filter(n=>(n.national_risk+' '+n.category).toLocaleLowerCase().includes(q)).slice(0,12):[];
 nationalSuggestions.innerHTML='';
 if(!q){hideSuggestions();return}
 if(!suggestionItems.length){nationalSuggestions.innerHTML='<div class="national-no-results">No matching national risks</div>'}
 for(let i=0;i<suggestionItems.length;i++){const n=suggestionItems[i];const btn=document.createElement('button');btn.type='button';btn.className='national-suggestion';btn.setAttribute('role','option');btn.id='national-option-'+i;btn.innerHTML=`<span>${esc(n.national_risk)}</span><small>${esc(n.category)}</small>`;btn.addEventListener('click',()=>selectNationalRisk(n.national_id));nationalSuggestions.appendChild(btn)}
 nationalSuggestions.hidden=false;nationalSearch.setAttribute('aria-expanded','true');
}
nationalSearch.addEventListener('input',updateSuggestions);
nationalSearch.addEventListener('keydown',e=>{if(e.key==='Escape'){hideSuggestions();return}if(!suggestionItems.length)return;
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();suggestIndex=(suggestIndex+(e.key==='ArrowDown'?1:-1)+suggestionItems.length)%suggestionItems.length;nationalSuggestions.querySelectorAll('.national-suggestion').forEach((b,i)=>b.classList.toggle('highlighted',i===suggestIndex));}
 if(e.key==='Enter'){e.preventDefault();selectNationalRisk(suggestionItems[Math.max(0,suggestIndex)].national_id)}
});
document.addEventListener('click',e=>{if(!e.target.closest('.national-search-wrap'))hideSuggestions()});
function rowMatch(risk){return CROSSWALK.find(match=>match.local_id===risk.id)}
function updateNational(){
 const n=NATIONAL_RISKS.find(x=>x.national_id===selectedNational);const container=document.getElementById('nationalDetails');
 if(!n){container.innerHTML='<p class="note">Search above or expand a category to view national risk definitions and highlight associated local entries. Mappings are provisional, not complete register transcriptions.</p>';}
 else{const matches=CROSSWALK.filter(r=>r.national_id===n.national_id&&r.match_status==='Direct');const areas=[...new Set(matches.map(r=>r.lrf))];container.innerHTML=`<p><strong>${esc(n.national_risk)}</strong></p><p class="nmeta">${esc(n.category)} · National Risk Register 2026, PDF p. ${n.pdf_page}</p><p>${esc(db.definitions?.national?.[n.national_id]?.text || n.definition_excerpt)}</p><p class="nmeta">${areas.length} LRFs with directly linked records in this draft crosswalk. This does not indicate absence or presence in every full source register.</p><p><a class="national-link" href="https://www.gov.uk/government/collections/national-risk-register" target="_blank" rel="noopener">National Risk Register source</a></p>`;}
 document.querySelectorAll('.region').forEach(p=>{const f=FEATURES.find(f=>f.code===p.dataset.code); const linked=CROSSWALK.some(r=>r.forum_code===f?.code&&r.national_id===selectedNational&&r.match_status==='Direct');p.classList.toggle('national-highlit',!!selectedNational&&linked);p.classList.toggle('national-no-match',!!selectedNational&&!linked);});
 activeRiskIndex=-1;clusterPos=null;document.getElementById('detail').textContent='Select a risk to see its source information.';if(currentData){renderList();makePlot();}
}

const svg=document.getElementById('map'),sel=document.getElementById('region'),tip=document.getElementById('tip'); let active=null;
const P=([lon,lat])=>[(lon+9)*48+25,(61.2-lat)*72+20];
function outline(coords){return coords.map(ring=>ring.map((pt,i)=>(i?'L':'M')+P(pt).map(n=>n.toFixed(2)).join(',')).join(' ')+'Z').join(' ')}
function geoPath(g){if(g.type==='Polygon')return outline(g.coordinates);if(g.type==='MultiPolygon')return g.coordinates.map(outline).join(' ');return ''}
FEATURES.sort((a,b)=>a.name.localeCompare(b.name));sel.innerHTML=FEATURES.map(f=>`<option value="${f.code}">${f.name.replaceAll('&','&amp;')}</option>`).join('');
FEATURES.forEach(feature => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const record = getData(feature.code);
  const coverageClass = record ? (record.coverage === 'summary' ? ' summary-data' : ' has-data') : '';
  path.setAttribute('d', geoPath(feature.geometry));
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('class', 'region' + coverageClass);
  path.dataset.code = feature.code;
  path.setAttribute('tabindex', '0');
  path.setAttribute('role', 'button');
  path.setAttribute('aria-label', feature.name);
  path.addEventListener('click', () => selectRegion(feature.code,true));
  path.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectRegion(feature.code,true);
    }
  });
  path.addEventListener('mousemove', event => {
    tip.style.display = 'block';
    const rect = svg.getBoundingClientRect();
    tip.style.left = (event.clientX - rect.left + 10) + 'px';
    tip.style.top = (event.clientY - rect.top + 10) + 'px';
    tip.textContent = feature.name;
  });
  path.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  svg.appendChild(path);
});
function getData(code){return DATA[code]||null}

function selectRegion(code,userInitiated=false){if(userInitiated)trackEvent('area-selected',code);document.getElementById('registerLink').dataset.analyticsEvent='register-source';document.getElementById('registerLink').dataset.analyticsCode=code;active=FEATURES.find(f=>f.code===code);sel.value=code;document.querySelectorAll('.region').forEach(p=>p.classList.toggle('active',p.dataset.code===code));document.getElementById('name').textContent='2. '+active.name;document.getElementById('code').textContent='Official partnership code: '+code;const reg=REGISTER_URLS[active.code];document.getElementById('registerLink').innerHTML=reg?`<a href="${reg}" target="_blank" rel="noopener noreferrer">↗ View Community Risk Register / risk information</a><small>Recorded source link; may lead to a PDF or website. Availability not guaranteed.</small>`:'<small>Register link not located.</small>';let d=getData(active.code),a=document.getElementById('riskArea');a.style.display=d?'block':'none';document.getElementById('notice').className='notice '+(d?'good':'');document.getElementById('notice').textContent=d?`Register: ${d.year} · ${d.scope}. ${d.note}`:'Boundary available; risk register not yet entered.';document.getElementById('sources').innerHTML=d?`<div class="sourcebox"><strong>Source information:</strong> ${esc(d.year)}. <br><span class="smalllink">Access the original PDF from the <a href="https://www.gov.uk/guidance/local-resilience-forums-contact-details" target="_blank">official LRF directory</a>.</span></div>`:'<p>Find this region’s register in the <a target="_blank" href="https://www.gov.uk/guidance/local-resilience-forums-contact-details">official LRF directory</a>.</p>';if(d)renderMatrix(d)}
sel.addEventListener('change',()=>selectRegion(sel.value,true));

let activeRiskIndex=-1, currentData=null, view='list', sortBy='priority', sortDir=-1, clusterPos=null;
const searchInput=document.getElementById('riskSearch'),filterInput=document.getElementById('riskFilter');
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function filteredRisks(){if(!currentData)return [];const q=searchInput.value.trim().toLowerCase(),f=filterInput.value;return currentData.risks.map((r,i)=>({...r,idx:i})).filter(r=>((f==='all')||(f==='scored'&&commonRanking(r)!==null)||(f==='unscored'&&commonRanking(r)===null))&&(!q||(r.name+' '+r.code).toLowerCase().includes(q))&&(!selectedNational||(rowMatch(r)?.national_id===selectedNational&&rowMatch(r)?.match_status==='Direct')))}
// Priority sorting is a display convention, never an official combined risk rating.
function rankExplanation(r){
 const rating=ratingRank(r.rating),product=calculatedPriority(r),v=r.visualRating,n=commonRanking(r);
 if(rating!==null)return `<strong>Climate Resilient UK ranking: ${n}/5</strong><p>The register publishes <strong>${esc(r.rating)}</strong>. Climate Resilient UK harmonises the published categories as Very High = 5, High = 4, Medium = 3, Low = 2, Very Low = 1. Other source categories (for example Staffordshire Critical/Severe/Moderate) are calculated from published likelihood and impact, not assigned by name. We have not changed this source rating. Multiple risks can share a rank.</p>`;
 if(product!==null)return `<strong>Climate Resilient UK ranking: ${n}/5</strong><p>Published likelihood ${esc(r.likelihood)}/5 × published impact ${esc(r.impact)}/5 = <strong>${esc(product)}</strong>. For a consistent 1–5 index, products 1–5 map to rank 1, 6–10 to 2, 11–15 to 3, 16–20 to 4, and 21–25 to 5. Within a rank, higher products then higher likelihood appear first. These are ordinal categories, not comparable measured probabilities.</p>`;
 if(Number.isFinite(v))return `<strong>Climate Resilient UK ranking: ${n}/5</strong><p>The Sussex register places this risk at approximately <strong>${esc(v)}</strong> on a graphic scale from 1 to 5. Climate Resilient UK rounds the visually transcribed position to the nearest whole number for a common index. This is an <strong>approximate interpretation of the graphic</strong>, not a precise score published as a table.</p>`;
 return `<strong>Unranked</strong><p>No individual rating has been transcribed into this prototype for this entry. The source may contain more detail. A usable published rating, paired numerical likelihood and impact, or plotted position has not been recorded for this entry. Climate Resilient UK has not invented a score.</p>`;
}
function riskDetailHTML(r){const m=rowMatch(r);const n=NATIONAL_RISKS.find(x=>x.national_id===m?.national_id);return `<strong>${esc(r.name)}</strong>${riskDefinitionHTML(r,db)}<details class="rating-source"><summary>Rating and source details</summary>${m?`<div class="match-flag">National match: ${esc(m.match_status)}${n?` · ${esc(n.national_risk)}`:""}</div>`:""}<div class="meta">${esc(r.code||'Published risk topic')}</div><div class="method-expand">${rankExplanation(r)}</div><div class="meta"><strong>Published likelihood:</strong> ${Number.isFinite(r.likelihood)?esc(r.likelihood)+'/5':'Not provided'} · <strong>Published impact:</strong> ${Number.isFinite(r.impact)?esc(r.impact)+'/5':'Not provided'}${r.rating?' · <strong>Published rating:</strong> '+esc(r.rating):''}</div><div class="meta">Source: ${esc(r.source||'Register')}${r.note?' · '+esc(r.note):''}</div></details>`;}
function renderList(){const arr=filteredRisks(),tbody=document.getElementById('riskRows');tbody.innerHTML='';const ranked=arr.filter(r=>commonRanking(r)!==null).length;document.getElementById('summary').textContent=`${arr.length} shown · ${ranked} ranked on the Climate Resilient UK 1–5 scale`;
 if(sortBy==='priority')arr.sort((a,b)=>sortDir===-1?priorityCompare(a,b):-priorityCompare(a,b));
 else arr.sort((a,b)=>sortDir*a.name.localeCompare(b.name)||priorityCompare(a,b));
 for(const r of arr){const rank=commonRanking(r);let tr=document.createElement('tr');tr.className=activeRiskIndex===r.idx?'selected':'';tr.setAttribute('tabindex','0');tr.setAttribute('role','button');tr.setAttribute('aria-expanded',String(activeRiskIndex===r.idx));tr.innerHTML=`<td><span class="risk-row-name">${esc(r.name)}</span><span class="risk-chevron" aria-hidden="true">${activeRiskIndex===r.idx?'−':'+'}</span></td><td class="rank-only"><span class="rank-single ${rank===null?'is-unranked':''}" aria-label="Climate Resilient UK ranking ${rank??'unranked'}">${rank??'Unranked'}</span></td>`;tr.onclick=()=>toggleRisk(r.idx);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleRisk(r.idx)}};tbody.appendChild(tr);
 if(activeRiskIndex===r.idx){let details=document.createElement('tr');details.className='expanded-risk';details.innerHTML=`<td colspan="2"><div class="expanded-risk-content">${riskDetailHTML(r)}</div></td>`;tbody.appendChild(details)}
 }
 if(!arr.length)tbody.innerHTML='<tr><td colspan="2" class="emptyview">No matching risks.</td></tr>';
 document.querySelectorAll('[data-sort]').forEach(b=>b.querySelector('.sortarrow').textContent=sortBy===b.dataset.sort?(sortDir>0?'↑':'↓'):'↕');
}
function toggleRisk(idx){if(activeRiskIndex===idx){activeRiskIndex=-1;clusterPos=null;document.getElementById('detail').textContent='Select a risk to read its definition and view rating and source details.';renderList();makePlot()}else chooseRisk(idx)}
function makePlot(){const svg=document.getElementById('riskPlot');svg.innerHTML='';const ns='http://www.w3.org/2000/svg';const make=(tag,attrs,txt)=>{let el=document.createElementNS(ns,tag);Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,v));if(txt!==undefined)el.textContent=txt;svg.appendChild(el);return el};
 const arr=filteredRisks().filter(r=>Number.isFinite(r.likelihood)&&Number.isFinite(r.impact));const x=l=>58+(l-1)*92,y=i=>351-(i-1)*78;
 for(let v=1;v<=5;v++){make('line',{x1:58,x2:426,y1:y(v),y2:y(v),stroke:'#dbe6e9'});make('line',{x1:x(v),x2:x(v),y1:39,y2:351,stroke:'#dbe6e9'});make('text',{x:43,y:y(v)+4,'text-anchor':'end',fill:'#586f78','font-size':'13'},v);make('text',{x:x(v),y:374,'text-anchor':'middle',fill:'#586f78','font-size':'13'},v)}
 const groups=new Map();arr.forEach(r=>{const key=r.likelihood+'-'+r.impact;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)});
 for(const [key,items] of groups){let [l,i]=key.split('-').map(Number);const g=document.createElementNS(ns,'g');g.setAttribute('class','plot-marker'+(clusterPos===key?' selected':''));g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',`${items.length} risk${items.length===1?'':'s'}: likelihood ${l}, impact ${i}`);let circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',x(l));circle.setAttribute('cy',y(i));circle.setAttribute('r',items.length>1?16:10);g.appendChild(circle);if(items.length>1){let text=document.createElementNS(ns,'text');text.setAttribute('x',x(l));text.setAttribute('y',y(i));text.textContent=items.length;g.appendChild(text)}g.onclick=()=>chooseCluster(key);g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseCluster(key)}};let tip=document.createElementNS(ns,'title');tip.textContent=`Likelihood ${l}/5, impact ${i}/5: ${items.map(r=>r.name).join('; ')}`;g.appendChild(tip);svg.appendChild(g)}
 const note=document.getElementById('clusterHint'); if(!arr.length){note.textContent='No numeric scores published for these entries. Use the risk list instead.';document.getElementById('clusterRisks').innerHTML=''} else if(clusterPos&&!groups.has(clusterPos)){clusterPos=null;document.getElementById('clusterRisks').innerHTML='';note.textContent='Select a marker to explore the risks at that position.'}
 if(clusterPos&&groups.has(clusterPos))renderCluster(groups.get(clusterPos),clusterPos);}
function renderCluster(items,key){const [l,i]=key.split('-');document.getElementById('clusterTitle').textContent=`Likelihood ${l}/5 · Impact ${i}/5`;document.getElementById('clusterHint').textContent=`${items.length} ${items.length===1?'risk':'risks'} at these exact published scores`;let container=document.getElementById('clusterRisks');container.innerHTML='';items.forEach(r=>{let b=document.createElement('button');b.className='cluster-item'+(r.idx===activeRiskIndex?' selected':'');b.textContent=r.name;b.onclick=()=>chooseRisk(r.idx);container.appendChild(b)})}
function chooseCluster(key){clusterPos=key;activeRiskIndex=-1;makePlot();renderList();document.getElementById('detail').textContent='Select a risk name from the group to read its definition and view source information.'}
function chooseRisk(idx){trackEvent('risk-opened',currentData.risks[idx].id);activeRiskIndex=idx;const r=currentData.risks[idx];clusterPos=Number.isFinite(r.likelihood)&&Number.isFinite(r.impact)?r.likelihood+'-'+r.impact:null;renderList();makePlot();document.getElementById('detail').innerHTML=riskDetailHTML(r);}
function renderMatrix(d){currentData=d;activeRiskIndex=-1;clusterPos=null;sortBy='priority';sortDir=-1;searchInput.value='';filterInput.value='all';document.getElementById('detail').textContent='Select a risk to read its definition and view rating and source details.';renderList();makePlot();switchView('list')}
function switchView(which,userInitiated=false){if(userInitiated)trackEvent('view-changed',which);view=which;document.getElementById('listView').hidden=which!=='list';document.getElementById('plotView').hidden=which!=='plot';for(const [id,active] of [['listTab',which==='list'],['plotTab',which==='plot']]){let b=document.getElementById(id);b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active))}if(which==='plot')makePlot()}
document.getElementById('listTab').onclick=()=>switchView('list',true);document.getElementById('plotTab').onclick=()=>switchView('plot',true);
for(const b of document.querySelectorAll('[data-sort]'))b.onclick=()=>{if(sortBy===b.dataset.sort)sortDir*=-1;else{sortBy=b.dataset.sort;sortDir=sortBy==='name'?1:-1}renderList()};
searchInput.oninput=()=>{clusterPos=null;renderList();makePlot()};filterInput.onchange=()=>{clusterPos=null;renderList();makePlot()};
document.getElementById('count').textContent=FEATURES.length+' official LRF areas';const initial=FEATURES.find(f=>f.name.includes('Devon, Cornwall'));const requested=new URLSearchParams(location.search).get('area');selectRegion(FEATURES.some(f=>f.code===requested)?requested:initial.code);

}
initialise().catch(showLoadError);
