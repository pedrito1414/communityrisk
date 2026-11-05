import { loadData } from './data.js';
import { riskDefinitionHTML } from './definitions.js';
import { commonRanking, priorityCompare } from './ranking.js';
import { esc, rankDescription, showLoadError, trackEvent } from './shared.js';
import { findForumFeatures } from './geometry.js';
import { lookupPostcode, validPostcode } from './postcode.js';
import { createExplorerMap } from './explorer-map.js';

const $ = id => document.getElementById(id);

async function initialise() {
  const db = await loadData();
  const forums = [...db.forums].sort((a,b)=>a.name.localeCompare(b.name));
  const forumByCode = new Map(forums.map(f=>[f.code,f]));
  const nationalById = new Map(db.nationalRisks.map(n=>[n.national_id,n]));
  const linksFor = id => db.matches.filter(m=>m.local_id===id);
  const isBroad = m => m.match_status==='Broad / multiple' && !!m.national_id && !!m.reviewed_at;
  const linkLabel = m => m.match_status==='Direct'?'Direct scenario match':'Broader topic coverage';
  const defaultRisk = nationalById.has('NRR26-076') ? 'NRR26-076' : db.nationalRisks[0].national_id;
  const state = {mode:'risk', national:defaultRisk, selectedCode:'', point:null, includeBroad:true};
  let localQuery = '', sortBy = 'rank', suggestions = [], suggestionIndex = -1;
  let lookupController = null;
  const national = () => nationalById.get(state.national);
  const matchingRecords = () => db.matches.filter(m=>m.national_id===state.national && (m.match_status==='Direct' || (state.includeBroad && isBroad(m))));
  const directCodes = () => new Set(matchingRecords().filter(m=>m.match_status==='Direct').map(m=>m.forum_code));
  const broadCodes = () => new Set(matchingRecords().filter(isBroad).map(m=>m.forum_code));
  const matchingCodes = () => new Set(matchingRecords().map(m=>m.forum_code));
  const selectedForum = () => forumByCode.get(state.selectedCode);
  const results = $('results');
  const map = createExplorerMap($('explorerMap'), db.boundaries, code=>selectArea(code), $('mapStatus'));

  function address(mode=state.mode) {
    const params = new URLSearchParams({view:mode});
    if(mode==='risk') params.set('risk',state.national);
    if(!state.includeBroad) params.set('matches','direct');
    if(state.selectedCode) params.set('area',state.selectedCode);
    return '?' + params;
  }
  function saveAddress() { history.pushState({national:state.national},'',address()); }
  function announce(message) { $('announcement').textContent=message; }
  function cancelLookup() {
    lookupController?.abort(); lookupController=null;
    $('postcodeSubmit').disabled=false; $('postcodeSubmit').textContent='Find area';
    $('postcodeError').hidden=true; results.setAttribute('aria-busy','false');
  }
  function selectArea(code, point=null) {
    if(!forumByCode.has(code)) return;
    cancelLookup(); state.selectedCode=code; state.point=point;
    localQuery=''; sortBy='rank';
    trackEvent('area-selected',code);
    render(); saveAddress();
    announce(selectedForum().name+' selected. Map zoomed to its boundary.');
  }
  function selectNational(id) {
    if(!nationalById.has(id)) return;
    cancelLookup(); state.national=id; state.mode='risk';
    state.selectedCode='';state.point=null;
    localQuery='';hideSuggestions();$('nationalBrowse').open=false;
    trackEvent('national-selected',id);
    render();saveAddress();
    announce(national().national_risk+': '+matchingCodes().size+' areas with linked published entries.');
  }
  function changeMode(mode) {
    cancelLookup();state.mode=mode;hideSuggestions();render();saveAddress();
    trackEvent('view-changed',mode);
    announce(mode==='risk'?'Exploring by risk.':'Exploring by area. Choose on the map, by name or by postcode.');
  }
  function resetArea() {
    cancelLookup();state.selectedCode='';state.point=null;localQuery='';
    render();saveAddress();announce('Showing all resilience partnership areas.');
  }
  function nationalDescription(n) {
    const text=db.definitions?.national?.[n.national_id]?.text||n.definition_excerpt;
    return `<p class="national-description">${esc(text||'A definition has not yet been transcribed. Please read the national source.')}</p><p class="small muted">National Risk Register 2026 · ${esc(n.category)} · PDF page ${esc(n.pdf_page)}. Local–national matches remain provisional.</p>`;
  }
  function originalLink(f) {
    return `<p class="source-link"><a href="${esc(f.source_url)}" data-analytics-event="register-source" data-analytics-code="${f.code}" target="_blank" rel="noopener noreferrer">View original register / risk information ↗</a></p>`;
  }
  function rankBadge(r) {
    const rank=commonRanking(r);
    return rank===null?'<span class="rank unranked">Unranked</span>':`<span class="rank" aria-label="CRUK navigation rank ${rank} of 5">${rank}</span>`;
  }
  function localRiskHTML(r, open=false) {
    const links=linksFor(r.id).filter(m=>m.national_id && (m.match_status==='Direct'||isBroad(m)));
    const current=links.find(m=>m.national_id===state.national);
    const matchDetails=links.length?`<section class="national-links"><h4>National risk links</h4>${links.map(m=>{
      const n=nationalById.get(m.national_id),source=db.definitions?.sources?.[m.local_source_id] || {url:forumByCode.get(r.forum_code).source_url};
      return `<div class="national-link-review"><p><strong>${linkLabel(m)}</strong> · ${esc(n.national_risk)}</p>${m.rationale?`<p>${esc(m.rationale)}</p><p class="small">Reviewed ${esc(m.reviewed_at)} · <a href="${esc(source.url)}#page=${esc(m.local_pdf_page)}" target="_blank" rel="noopener noreferrer">Local PDF page ${esc(m.local_pdf_page)}</a> · <a href="${esc(db.definitions?.sources?.['nrr-2026']?.url || 'https://assets.publishing.service.gov.uk/media/6a50d66b1228eb26a4cab76c/National_Risk_Register_2026.pdf')}#page=${esc(m.national_pdf_page)}" target="_blank" rel="noopener noreferrer">National PDF page ${esc(m.national_pdf_page)}</a></p>`:'<p class="small muted">Provisional existing classification.</p>'}${state.mode==='area'?`<button type="button" class="explore-national" data-national="${esc(m.national_id)}">Explore ${esc(n.national_risk)} across areas →</button>`:''}</div>`;
    }).join('')}</section>`:'<p class="small muted">No reviewed national scenario link recorded.</p>';
    return `<details class="local-risk" data-local-id="${esc(r.id)}" ${open?'open':''}><summary><span class="risk-name">${esc(r.name)}</span>${rankBadge(r)}</summary>
      ${riskDefinitionHTML(r,db)}
      <details class="rating-source"><summary>Rating and source details</summary><p>${esc(rankDescription(r))}</p><p>Reference: ${esc(r.code||'Published topic')}<br>Source: ${esc(r.source||'See original register')}${r.note?'<br>'+esc(r.note):''}</p></details>
      ${state.mode==='risk'&&current?`<p class="match-kind ${isBroad(current)?'broad':'direct'}">${linkLabel(current)}</p>`:''}
      ${matchDetails}
    </details>`;
  }
  function renderOverview() {
    if(state.mode==='area') {
      results.innerHTML=`<div class="eyebrow">Explore by area</div><h2 id="resultsTitle">Find your local risk register</h2><p class="muted">Select an area on the map, choose its name, or enter your postcode above.</p><p class="count-line">${forums.length} resilience partnership areas</p><ul class="area-list">${forums.map(f=>`<li><button type="button" data-area="${f.code}"><span>${esc(f.name)}<small>${esc(f.coverage==='detailed'?'Detailed records':'Summary or partial records')}</small></span><span aria-hidden="true">→</span></button></li>`).join('')}</ul>`;
      return;
    }
    const n=national(),codes=matchingCodes(),areas=forums.filter(f=>codes.has(f.code));
    results.innerHTML=`<div class="eyebrow">Explore by risk · National catalogue</div><h2 id="resultsTitle">${esc(n.national_risk)}</h2>${nationalDescription(n)}<p class="source-link"><a href="https://www.gov.uk/government/collections/national-risk-register" target="_blank" rel="noopener noreferrer">Read the national source ↗</a></p>
      <p class="count-line"><strong>${areas.length} ${areas.length===1?'area':'areas'}</strong> with linked published entries</p><p class="small muted">${directCodes().size} with direct scenario matches · ${broadCodes().size} with broader topic coverage. An area can have both.</p>
      <p class="small muted">Select a highlighted area on the map or choose below to read its local assessment.</p>
      ${areas.length?`<ul class="area-list">${areas.map(f=>{const count=matchingRecords().filter(m=>m.forum_code===f.code).length;return `<li><button type="button" data-area="${f.code}"><span>${esc(f.name)}<small>${matchingRecords().filter(m=>m.forum_code===f.code&&m.match_status==='Direct').length?'Direct scenario match':'Broader topic coverage'} · ${count} ${count===1?'link':'links'} · ${esc(f.coverage==='detailed'?'Detailed records':'Summary or partial records')}</small></span><span aria-hidden="true">→</span></button></li>`;}).join('')}</ul>`:'<p class="empty-state">No eligible local links have been recorded for this national risk yet. You can still select any area on the map to inspect its register.</p>'}
      <p class="coverage-note">No matched entry does not mean no risk. Local records and provisional national matches are incomplete. Only reviewed broader links are highlighted when enabled. Candidate and unreviewed broad matches are excluded.</p>`;
  }
  function renderSelected() {
    const f=selectedForum(),all=db.risks.filter(r=>r.forum_code===f.code);
    const localIds=new Set(matchingRecords().filter(m=>m.forum_code===f.code).map(m=>m.local_id));
    const matches=all.filter(r=>localIds.has(r.id)).sort(priorityCompare);
    results.innerHTML=`<button type="button" class="back-link" data-all-areas>← ${state.mode==='risk'?'All matching areas':'All areas'}</button><div class="eyebrow">${state.mode==='risk'?'Local assessment':'Explore by area'}</div><h2 id="resultsTitle">${esc(f.name)}</h2>
      <p class="forum-metadata">Recorded publication: ${esc(f.year)}</p><span class="tag">${esc(f.scope)}</span>
      ${state.point?`<p class="small" style="margin-top:12px">${esc(state.point.postcode)}${state.point.admin_district?' · '+esc(state.point.admin_district):''} · Approximate postcode location</p>`:''}
      ${originalLink(f)}
      ${state.mode==='risk'?`<div class="matching-callout"><h3>${esc(national().national_risk)}</h3><p class="small">${matches.length?`${matches.length} linked local ${matches.length===1?'entry':'entries'}. Each entry distinguishes a direct scenario match from broader topic coverage. Broader coverage does not confirm the national scenario was assessed locally.`:'No eligible local link in the current records for this area. This does not mean the area is unaffected.'}</p></div><button id="exploreArea" type="button" class="primary wide-action">Explore all risks in this area →</button><p class="small muted">CRUK navigation rank · 1–5 · Not an official partnership score</p><div id="localRisks">${matches.map(r=>localRiskHTML(r,matches.length===1)).join('')}</div>`:`<h3>Published risks</h3><div class="local-filters"><label for="localSearch">Search this area’s risks<input type="search" id="localSearch" placeholder="Risk name or reference…" value="${esc(localQuery)}"></label><button type="button" id="sortLocal">${sortBy==='rank'?'Rank ↓':'Name A–Z'}</button></div><p class="small muted" id="localCount"></p><div id="localRisks"></div>`}
      <p class="coverage-note">${esc(f.note||'Coverage and scoring detail vary. Read the original register for the full assessment.')}</p>
      <p class="small muted">These are regional assessments, not forecasts for your postcode or property.</p>
      <p class="source-link"><a href="legacy/?area=${encodeURIComponent(f.code)}">View detailed tables and likelihood × impact →</a></p>`;
    if(state.mode==='area') {
      renderLocalList();
      $('localSearch').addEventListener('input',()=>{localQuery=$('localSearch').value;renderLocalList();});
      $('sortLocal').onclick=()=>{sortBy=sortBy==='rank'?'name':'rank';$('sortLocal').textContent=sortBy==='rank'?'Rank ↓':'Name A–Z';renderLocalList();};
    } else $('exploreArea').onclick=()=>changeMode('area');
  }
  function renderLocalList() {
    const all=db.risks.filter(r=>r.forum_code===state.selectedCode);
    const rows=all.filter(r=>(r.name+' '+(r.code||'')).toLowerCase().includes(localQuery.trim().toLowerCase()));
    rows.sort(sortBy==='rank'?priorityCompare:(a,b)=>a.name.localeCompare(b.name));
    $('localRisks').innerHTML=rows.length?rows.map(r=>localRiskHTML(r)).join(''):'<p class="empty-state">No local entries match this search.</p>';
    $('localCount').textContent=`${rows.length} of ${all.length} transcribed entries · ${all.every(r=>commonRanking(r)===null)?'No published numerical ratings recorded':'CRUK navigation rank 1–5'}`;
  }
  function render() {
    for(const [id,mode] of [['riskRoute','risk'],['areaRoute','area'],['navRisk','risk'],['navArea','area']]) {
      $(id).href=address(mode);
      if(state.mode===mode) $(id).setAttribute('aria-current','page');
      else $(id).removeAttribute('aria-current');
    }
    $('nationalControls').hidden=state.mode!=='risk';$('areaControls').hidden=state.mode!=='area';
    $('region').value=state.selectedCode;$('nationalSearch').value=national().national_risk;
    $('selectionHint').textContent='Selected: '+national().national_risk+' · '+db.nationalRisks.length+' national risks available';
    document.querySelectorAll('[data-national]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.national===state.national)));
    $('mapTitle').textContent=selectedForum()?.name||'Great Britain · '+forums.length+' resilience areas';
    $('showAll').hidden=!state.selectedCode;
    $('mapLegend').innerHTML=state.selectedCode?'<span><i class="legend-chip selected"></i>Selected partnership boundary</span>'+(state.point?'<span><i class="legend-chip postcode"></i>Approximate postcode location</span>':''):
      state.mode==='risk'?'<span><i class="legend-chip matching"></i>Direct scenario match</span><span><i class="legend-chip broad"></i>Broader topic coverage</span><span><i class="legend-chip other"></i>No matched entry in current records</span>':'<span><i class="legend-chip matching"></i>resilience partnership areas</span>';
    if(state.selectedCode) renderSelected();else renderOverview();
    results.setAttribute('aria-busy','false');
    $('includeBroad').checked=state.includeBroad;
    map.update({...state,matchingCodes:directCodes(),broadCodes:broadCodes()});
  }
  function hideSuggestions() {
    $('nationalSuggestions').hidden=true;$('nationalSearch').setAttribute('aria-expanded','false');
    $('nationalSearch').removeAttribute('aria-activedescendant');suggestionIndex=-1;
  }
  function showSuggestions() {
    const query=$('nationalSearch').value.trim().toLowerCase();
    suggestions=query?db.nationalRisks.filter(n=>(n.national_risk+' '+n.category).toLowerCase().includes(query)).slice(0,12):[];
    suggestionIndex=-1;
    if(!query) {hideSuggestions();return;}
    $('nationalSuggestions').innerHTML=suggestions.length?suggestions.map((n,i)=>`<li role="option" id="nationalOption${i}" aria-selected="false" data-suggestion="${esc(n.national_id)}"><span>${esc(n.national_risk)}</span><small>${esc(n.category)}</small></li>`).join(''):'<li class="no-suggestions" role="presentation">No matching national risks. Try another name or browse the catalogue.</li>';
    $('nationalSuggestions').hidden=false;$('nationalSearch').setAttribute('aria-expanded','true');
  }
  $('includeBroad').addEventListener('change',()=>{state.includeBroad=$('includeBroad').checked;render();saveAddress();announce(state.includeBroad?'Showing direct matches and reviewed broader coverage.':'Showing direct scenario matches only.');});
  $('nationalSearch').addEventListener('input',showSuggestions);
  $('nationalSearch').addEventListener('keydown',event=>{
    if(event.key==='Escape') {hideSuggestions();return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      event.preventDefault();if($('nationalSuggestions').hidden)showSuggestions();
      if(!suggestions.length)return;
      suggestionIndex=(suggestionIndex+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length;
      const options=$('nationalSuggestions').querySelectorAll('[role=option]');
      options.forEach((option,i)=>option.setAttribute('aria-selected',String(i===suggestionIndex)));
      const active=options[suggestionIndex];$('nationalSearch').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});
    }
    if(event.key==='Enter'&&!$('nationalSuggestions').hidden&&suggestions.length) {event.preventDefault();selectNational(suggestions[Math.max(0,suggestionIndex)].national_id);}
  });
  // Options belong to the combobox: retain input focus through pointerdown so
  // its blur handler cannot remove the option before the subsequent click.
  $('nationalSuggestions').addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-suggestion]'))event.preventDefault();
  });
  $('nationalSuggestions').addEventListener('click',event=>{const option=event.target.closest('[data-suggestion]');if(option)selectNational(option.dataset.suggestion);});
  document.addEventListener('click',event=>{if(!event.target.closest('.national-search'))hideSuggestions();});
  $('nationalSearch').addEventListener('blur',()=>setTimeout(()=>{if(!document.activeElement?.closest('.national-search'))hideSuggestions();},0));
  for(const category of [...new Set(db.nationalRisks.map(n=>n.category))]) {
    const section=document.createElement('details');section.className='national-category';
    const items=db.nationalRisks.filter(n=>n.category===category);
    section.innerHTML=`<summary>${esc(category)} (${items.length})</summary><div class="category-risks">${items.map(n=>`<button type="button" data-national="${esc(n.national_id)}" aria-pressed="false">${esc(n.national_risk)}</button>`).join('')}</div>`;
    $('nationalTree').appendChild(section);
  }
  $('nationalTree').addEventListener('click',event=>{const button=event.target.closest('[data-national]');if(button)selectNational(button.dataset.national);});
  results.addEventListener('click',event=>{
    const area=event.target.closest('[data-area]'),n=event.target.closest('[data-national]');
    if(area) selectArea(area.dataset.area);
    else if(n) selectNational(n.dataset.national);
    else if(event.target.closest('[data-all-areas]')) resetArea();
  });
  results.addEventListener('toggle',event=>{if(event.target.matches('.local-risk[open]'))trackEvent('risk-opened',event.target.dataset.localId);},true);
  $('region').insertAdjacentHTML('beforeend',forums.map(f=>`<option value="${f.code}">${esc(f.name)}</option>`).join(''));
  $('region').onchange=()=>{if($('region').value)selectArea($('region').value);else resetArea();};
  $('showAll').onclick=resetArea;
  for(const [id,mode] of [['riskRoute','risk'],['areaRoute','area'],['navRisk','risk'],['navArea','area']]) $(id).addEventListener('click',event=>{if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();changeMode(mode);}});
  $('postcodeForm').addEventListener('submit',async event=>{
    event.preventDefault();if(lookupController)return;
    const postcode=$('postcode').value.trim().toUpperCase();
    $('postcodeError').hidden=true;
    if(!validPostcode(postcode)) {trackEvent('postcode-invalid');$('postcodeError').textContent='Please enter a valid UK postcode.';$('postcodeError').hidden=false;return;}
    cancelLookup();
    const controller=new AbortController();lookupController=controller;
    state.selectedCode='';state.point=null;localQuery='';render();
    history.replaceState(null,'',address());
    $('postcodeSubmit').disabled=true;$('postcodeSubmit').textContent='Looking up…';results.setAttribute('aria-busy','true');
    announce('Looking up your postcode.');trackEvent('postcode-started');
    try {
      const location=await lookupPostcode(postcode,controller.signal);
      if(lookupController!==controller)return;
      if(!['England','Wales','Scotland'].includes(location.country))throw new Error('This explorer currently covers England, Wales and Scotland. Please choose an area instead.');
      const found=findForumFeatures(db.boundaries,location.longitude,location.latitude);
      if(found.length!==1)throw new Error('This postcode could not be assigned unambiguously using the current boundaries. Please choose an area on the map or by name.');
      trackEvent('postcode-succeeded',found[0].properties.code);
      selectArea(found[0].properties.code,location);
    } catch(error) {
      if(lookupController!==controller)return;
      trackEvent('postcode-failed');$('postcodeError').textContent=error.message;$('postcodeError').hidden=false;
      announce('Postcode lookup failed. Choose an area or try again.');
    } finally {
      if(lookupController===controller) {lookupController=null;$('postcodeSubmit').disabled=false;$('postcodeSubmit').textContent='Find area';results.setAttribute('aria-busy','false');}
    }
  });
  function restoreAddress() {
    cancelLookup();const params=new URLSearchParams(location.search);
    state.selectedCode=forumByCode.has(params.get('area'))?params.get('area'):'';
    const requestedRisk=params.get('risk')||history.state?.national;
    state.national=nationalById.has(requestedRisk)?requestedRisk:defaultRisk;
    state.mode=['area','risk'].includes(params.get('view'))?params.get('view'):(state.selectedCode||params.has('postcode')?'area':'risk');
    state.includeBroad=params.get('matches')!=='direct';
    state.point=null;localQuery='';sortBy='rank';hideSuggestions();render();
    if(params.has('postcode')||location.hash==='#postcode') {
      if(params.has('postcode')) $('postcode').value=params.get('postcode').slice(0,9);
      // Old shared links prefill only; do not send the postcode without a submit.
      history.replaceState({national:state.national},'',address());
      if(state.mode==='area') $('postcode').focus();
    }
  }
  window.addEventListener('popstate',restoreAddress);
  for(const id of ['nationalSearch','region','postcode','postcodeSubmit']) $(id).disabled=false;
  restoreAddress();
}

initialise().catch(showLoadError);
