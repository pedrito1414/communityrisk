import { loadData } from './data.js';
import { commonRanking, priorityCompare } from './ranking.js';
import { esc, rankDescription, trackEvent } from './shared.js';
import { findForumFeatures, drawFallbackMap } from './geometry.js';

const $ = id => document.getElementById(id);
let map, boundaryLayer, marker, riskList = [], sortKey = 'rank', sortDesc = true, busy = false;
function showError(message) { $('error').textContent = message; $('error').hidden = false; }
function render() {
  const query = $('riskSearch').value.trim().toLowerCase();
  const rows = riskList.filter(r => `${r.name} ${r.code || ''}`.toLowerCase().includes(query));
  rows.sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name) * (sortDesc ? -1 : 1);
    // Keep entries without ranks last in either direction.
    const aa = commonRanking(a), bb = commonRanking(b);
    if (aa === null && bb !== null) return 1;
    if (bb === null && aa !== null) return -1;
    return priorityCompare(a, b) * (sortDesc ? 1 : -1);
  });
  $('riskRows').innerHTML = rows.map(r => {
    const rank = commonRanking(r);
    return `<tr><td><strong>${esc(r.name)}</strong><details class="source-details" data-analytics-risk="${esc(r.id)}"><summary>Rating and source details</summary><p>${esc(rankDescription(r))}</p>${r.rating ? `<p>Original rating: ${esc(r.rating)}</p>` : ''}<p>Reference: ${esc(r.code || 'Published topic')}<br>Source: ${esc(r.source || 'See forum source below')}</p>${r.note ? `<p>${esc(r.note)}</p>` : ''}</details></td><td>${rank === null ? '<span class="muted">Unranked</span>' : `<span class="score ${rank === 5 ? 'top' : rank === 4 ? 'high' : ''}" aria-label="Navigation rank ${rank} of 5">${rank}</span>`}</td></tr>`;
  }).join('');
  $('count').textContent = `${rows.length} of ${riskList.length} recorded entries`;
  $('empty').hidden = rows.length > 0;
  $('empty').textContent = query ? 'No risks match your search.' : 'No risk records are currently available for this forum.';
  $('sortName').textContent = `Published risk ${sortKey === 'name' ? (sortDesc ? '↓' : '↑') : '↕'}`;
  $('sortRank').textContent = `Ranking (1–5) ${sortKey === 'rank' ? (sortDesc ? '↓' : '↑') : '↕'}`;
  $('sortName').closest('th').setAttribute('aria-sort', sortKey === 'name' ? (sortDesc ? 'descending' : 'ascending') : 'none');
  $('sortRank').closest('th').setAttribute('aria-sort', sortKey === 'rank' ? (sortDesc ? 'descending' : 'ascending') : 'none');
}
function drawBoundary(feature, location) {
  const container = $('map');
  if (!window.L) {
    drawFallbackMap(container, feature, [location.longitude, location.latitude]);
    $('mapStatus').textContent = 'Boundary: ONS, December 2024. Basemap unavailable; showing the shared boundary and postcode marker. Risks apply to the whole area.';
    return;
  }
  try {
    if (!map) {
      container.replaceChildren();
      map = L.map(container, {scrollWheelZoom: false}).setView([52.8, -1.6], 7);
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap contributors'}).addTo(map);
      tiles.on('tileerror', () => { $('mapStatus').textContent = 'Some background map tiles could not load. The ONS boundary and postcode marker remain visible.'; });
    }
    if (boundaryLayer) map.removeLayer(boundaryLayer);
    if (marker) map.removeLayer(marker);
    boundaryLayer = L.geoJSON(feature, {style: {color: '#ce6031', weight: 3, fillColor: '#ce6031', fillOpacity: .13}}).addTo(map);
    marker = L.circleMarker([location.latitude, location.longitude], {radius: 7, color: 'white', weight: 2, fillColor: '#103c48', fillOpacity: 1}).bindPopup('Postcode: ' + esc(location.postcode)).addTo(map);
    const fit = () => { map.invalidateSize({pan: false}); map.fitBounds(boundaryLayer.getBounds().extend(marker.getLatLng()).pad(.06), {maxZoom: 11, animate: false}); };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    setTimeout(fit, 250);
    $('mapStatus').textContent = 'Boundary: ONS, December 2024 · Basemap © OpenStreetMap contributors. The marker shows your postcode; risks apply to the whole forum area.';
  } catch (error) {
    if (map) { map.remove(); map = undefined; }
    drawFallbackMap(container, feature, [location.longitude, location.latitude]);
    $('mapStatus').textContent = 'Background map unavailable. Showing the shared ONS boundary and postcode marker.';
  }
}
async function lookupPostcode(postcode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(postcode), {signal: controller.signal});
    if (response.status === 404) throw new Error('Postcode not found. Please check it and try again.');
    if (!response.ok) throw new Error('The postcode service is unavailable. Please try again later.');
    const body = await response.json();
    if (body.status !== 200 || !body.result) throw new Error('Postcode not found.');
    return body.result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The postcode service took too long to respond. Please try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  $('error').hidden = true;
  const postcode = $('postcode').value.trim().toUpperCase();
  if (!/^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(postcode)) { trackEvent('postcode-invalid'); return showError('Please enter a valid UK postcode.'); }
  trackEvent('postcode-started');
  busy = true; $('submit').disabled = true; $('submit').textContent = 'Looking up…';
  // Hide previous results so a failed search cannot leave the previous area's risks on screen.
  $('results').hidden = true; $('welcome').hidden = false;
  history.replaceState(null, '', location.pathname);
  try {
    const [db, locationData] = await Promise.all([loadData(), lookupPostcode(postcode)]);
    if (!['England', 'Wales'].includes(locationData.country)) throw new Error('This prototype currently covers England and Wales.');
    const features = findForumFeatures(db.boundaries, locationData.longitude, locationData.latitude);
    if (features.length !== 1) throw new Error('This postcode could not be assigned unambiguously using the current boundary data. Please use the full risk register dashboard.');
    const feature = features[0], forum = db.forums.find(f => f.code === feature.properties.code);
    if (!forum) throw new Error('The forum is missing from the shared data. Please use the full dashboard.');
    trackEvent('postcode-succeeded', forum.code);
    $('forumWebsite').dataset.analyticsEvent = 'forum-website';
    $('forumWebsite').dataset.analyticsCode = forum.code;
    $('source').dataset.analyticsEvent = 'register-source';
    $('source').dataset.analyticsCode = forum.code;
    riskList = db.risks.filter(r => r.forum_code === forum.code);
    sortKey = 'rank'; sortDesc = true; $('riskSearch').value = '';
    $('forumName').textContent = `${locationData.postcode} is in the ${forum.name} resilience forum area`;
    $('forumWebsite').href = forum.website_url;
    $('forumWebsite').textContent = forum.website_kind === 'website' ? 'Visit resilience forum website ↗' : forum.website_kind === 'pdf' ? 'View resilience forum information (PDF) ↗' : 'View resilience forum information ↗';
    $('forumWebsite').setAttribute('aria-label', `${forum.name}: ${$('forumWebsite').textContent} (opens in a new tab)`);
    $('placeName').textContent = `${locationData.postcode} · ${locationData.admin_district || ''} · Official LRF boundary`;
    $('coverage').textContent = `Recorded publication: ${forum.year}. Coverage: ${forum.scope}. ${forum.note}`;
    $('source').innerHTML = `<a href="${esc(forum.source_url)}" target="_blank" rel="noopener noreferrer">View original risk register / risk information ↗</a>`;
    $('explorerLink').href = '../registers/?area=' + encodeURIComponent(forum.code);
    $('welcome').hidden = true; $('results').hidden = false;
    render(); drawBoundary(feature, locationData);
    history.replaceState(null, '', '?postcode=' + encodeURIComponent(locationData.postcode));
    $('forumName').tabIndex = -1; $('forumName').focus();
    $('results').scrollIntoView({behavior: 'smooth'});
  } catch (error) { trackEvent('postcode-failed'); showError(error.message); }
  finally { busy = false; $('submit').disabled = false; $('submit').textContent = 'Find my risks →'; }
});
$('riskSearch').addEventListener('input', render);
$('sortName').addEventListener('click', () => { sortDesc = sortKey === 'name' ? !sortDesc : false; sortKey = 'name'; render(); });
$('sortRank').addEventListener('click', () => { sortDesc = sortKey === 'rank' ? !sortDesc : true; sortKey = 'rank'; render(); });
$('change').addEventListener('click', () => { $('postcode').focus(); window.scrollTo({top: 0, behavior: 'smooth'}); });
const initial = new URLSearchParams(location.search).get('postcode');
if (initial) $('postcode').value = initial; // A shared link is prefilled; submit explicitly before sending it to Postcodes.io.
