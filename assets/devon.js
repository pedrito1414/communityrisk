import {lookupPostcode, validPostcode} from './postcode.js';

const $ = id => document.getElementById(id);
const endpoint = 'https://services-eu1.arcgis.com/KB6uNVj5ZcJr7jUP/arcgis/rest/services/RiskOfFloodingFromRiversAndSea/FeatureServer/0/query';
const extent = [-4.7, 50.15, -2.85, 51.35];
const colours = {High:'#3d438d', Medium:'#5f9bd5', Low:'#a1d3d2', 'Very Low':'#c5e2e6'};
const places = {
  exeter: ['Exeter riverside', -3.536, 50.718], barnstaple: ['Barnstaple', -4.059, 51.078],
  plymouth: ['Plymouth', -4.142, 50.375], torquay: ['Torquay', -3.53, 50.462],
  dartmoor: ['Dartmoor · Princetown', -3.99, 50.543], tiverton: ['Tiverton', -3.488, 50.902]
};
let map, marker, floodLayer, heatLayer, fuelLayer, heatData, heatFailure = false;
let mode = 'flood', point, pointRun = 0, viewportRun = 0, postcodeRun = 0;
let pointController, viewportController, postcodeController, moveTimer;
const inside = (lon, lat) => lon >= extent[0] && lon <= extent[2] && lat >= extent[1] && lat <= extent[3];

async function getJSON(url, signal) {
  const response = await fetch(url, {signal, credentials:'omit', referrerPolicy:'no-referrer'});
  if (!response.ok) throw new Error('Source unavailable');
  const body = await response.json();
  if (body.error) throw new Error('Source query failed');
  return body;
}

function query(parameters, signal) {
  return getJSON(endpoint + '?' + new URLSearchParams({where:'1=1', inSR:'4326',
    spatialRel:'esriSpatialRelIntersects', ...parameters}), signal);
}

function updateHeat() {
  if (!point) return;
  if (!heatData) {
    $('heatValue').textContent = heatFailure ? 'Heat sample unavailable' : 'Loading heat sample…';
    $('heatDays').textContent = '';
    return;
  }
  const cell = heatData.cells.find(c => point.lon >= c.bounds[0] && point.lon < c.bounds[2]
    && point.lat >= c.bounds[1] && point.lat < c.bounds[3]);
  $('heatValue').textContent = cell ? `${cell.maximum_c.toFixed(1)}°C summer maximum` : 'Outside the heat sample';
  $('heatDays').textContent = cell
    ? `${cell.days_ge_25} of ${cell.valid_days} days reached 25°C. Same regional grid value across roughly 44 × 56 km; not a street-level estimate.`
    : 'No stored cell covers this point. This does not indicate low heat exposure.';
}

async function pointFlood(run) {
  pointController?.abort();
  const controller = pointController = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  $('floodValue').textContent = 'Checking the flood evidence…';
  $('floodDetail').textContent = 'Querying the older EA river and sea flood polygons for this exact point.';
  try {
    const body = await query({f:'json', geometry:`${point.lon},${point.lat}`, geometryType:'esriGeometryPoint',
      outFields:'prob_4band,pub_date,suitability', returnGeometry:'false'}, controller.signal);
    if (run !== pointRun) return;
    if (!Array.isArray(body.features) || body.exceededTransferLimit) throw new Error('Incomplete point response');
    const bands = [...new Set(body.features.map(f => f.attributes?.prob_4band).filter(Boolean))];
    if (body.features.length && !bands.length) throw new Error('Unrecognised flood response');
    $('floodValue').textContent = bands.length ? bands.join(' / ') + ' · source category' : 'No flood polygon returned';
    const suitability = [...new Set(body.features.map(f => f.attributes?.suitability).filter(Boolean))];
    $('floodDetail').textContent = (bands.length
      ? 'The approximate point intersects these river/sea flood categories in this older service. '
      : 'This older service returned no mapped polygon at the point. This does not establish that the location is safe from flooding. ')
      + 'Data service last edited June 2024; surface water is not assessed.'
      + (suitability.length ? ' Source suitability: ' + suitability.join('; ') + '.' : '');
  } catch {
    if (run !== pointRun) return;
    $('floodValue').textContent = 'Flood query unavailable';
    $('floodDetail').textContent = 'The source could not return a complete result. No risk category has been assigned. Try selecting the place again or use the official flood service below.';
  } finally { clearTimeout(timeout); }
}

function selectPlace(name, lon, lat) {
  if (!inside(lon, lat)) return;
  point = {lon, lat};
  const run = ++pointRun;
  $('placeTitle').textContent = name;
  $('coordinates').textContent = `${lat.toFixed(4)}°N, ${Math.abs(lon).toFixed(4)}°W · approximate point`;
  $('searchStatus').textContent = `Showing evidence for ${name}. No combined or property-level risk score is calculated.`;
  updateHeat();
  if (map) {
    if (marker) marker.remove();
    marker = window.L.marker([lat,lon]).addTo(map);
    marker.bindTooltip(document.createTextNode(name));
    map.setView([lat,lon], mode === 'flood' ? 14 : mode === 'heat' ? 9 : 11);
  }
  pointFlood(run);
}

async function updateFloodMap() {
  const run = ++viewportRun;
  viewportController?.abort();
  if (!map || mode !== 'flood') return;
  floodLayer.clearLayers();
  if (map.getZoom() < 13) {
    $('mapStatus').textContent = 'Choose a place or zoom in to level 13 or closer to load detailed flood polygons. An empty map is not evidence of no flooding.';
    return;
  }
  const b = map.getBounds();
  const bounds = [Math.max(b.getWest(),extent[0]), Math.max(b.getSouth(),extent[1]),
    Math.min(b.getEast(),extent[2]), Math.min(b.getNorth(),extent[3])];
  if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    $('mapStatus').textContent = 'Outside the pilot map window.'; return;
  }
  const controller = viewportController = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  $('mapStatus').textContent = 'Loading river and sea flood polygons for this view…';
  try {
    // Count first: never present an incomplete subset as a complete map.
    const count = await query({f:'json', geometry:bounds.join(','), geometryType:'esriGeometryEnvelope',
      returnCountOnly:'true'}, controller.signal);
    if (run !== viewportRun || mode !== 'flood') return;
    if (!Number.isInteger(count.count) || count.count < 0) throw new Error('Invalid count');
    if (count.count > 1500) {
      $('mapStatus').textContent = 'Too many flood polygons in this view. Zoom in further; no partial layer is shown.'; return;
    }
    const body = await query({f:'geojson', geometry:bounds.join(','), geometryType:'esriGeometryEnvelope',
      outSR:'4326', outFields:'prob_4band', returnGeometry:'true', geometryPrecision:'6',
      resultRecordCount:'1500'}, controller.signal);
    if (run !== viewportRun || mode !== 'flood') return;
    if (!Array.isArray(body.features) || body.exceededTransferLimit || body.properties?.exceededTransferLimit
      || body.features.length !== count.count) throw new Error('Incomplete map response');
    floodLayer.addData(body);
    $('mapStatus').textContent = `${body.features.length} river/sea flood polygons loaded. Older service: last data edit June 2024. No surface-water layer. Click the map to query a point.`;
  } catch {
    if (run !== viewportRun || mode !== 'flood') return;
    floodLayer.clearLayers();
    $('mapStatus').textContent = 'Flood map unavailable or incomplete. No polygons are shown; this does not indicate low risk. Point results are queried separately.';
  } finally { clearTimeout(timeout); }
}

function setMode(next) {
  mode = next;
  ++viewportRun;
  viewportController?.abort();
  if (map) for (const layer of [floodLayer,heatLayer,fuelLayer]) if (layer) map.removeLayer(layer);
  $('legend').replaceChildren();
  if (mode === 'flood') {
    for (const [band,colour] of Object.entries(colours)) {
      const label = document.createElement('span'), swatch = document.createElement('i');
      swatch.className = 'swatch'; swatch.style.backgroundColor = colour;
      label.append(swatch,document.createTextNode(band)); $('legend').append(label);
    }
    if (map) floodLayer.addTo(map);
    if (map) updateFloodMap();
  } else if (mode === 'heat') {
    $('legend').textContent = 'Summer 2022 maximum: pale orange <25°C · orange 25–30°C · red ≥30°C. Grid cells are approximately 44 × 56 km.';
    $('mapStatus').textContent = heatFailure ? 'Stored heat sample unavailable.' : 'Regional historical heat grid. Select a point for its cell value; zooming in does not increase data resolution.';
    if (map && heatLayer) heatLayer.addTo(map);
  } else {
    const image = document.createElement('img'); image.src = '../data/devon/wildfire-fuels-legend.png';
    image.alt = 'Original EFFIS fuel-map legend: short grass, grass and understory, tall grass, chaparral, brush, dormant brush, southern rough, closed timber litter, hardwood litter and timber.';
    $('legend').append(image);
    if (map && fuelLayer) fuelLayer.addTo(map);
    $('mapStatus').textContent = 'EFFIS fuel map, version 2017. Vegetation context, not fire probability. Blank areas are not a finding of no risk. Colours match the source legend.';
  }
  if (!map) $('mapStatus').textContent = 'Interactive map unavailable. Example and postcode point queries still work; map evidence cannot be displayed.';
}

function initialiseMap() {
  if (!window.L) { setMode(mode); return; }
  try {
    const L = window.L;
    map = L.map('map', {scrollWheelZoom:false, minZoom:8, maxZoom:18});
    if (getComputedStyle(map.getPane('tilePane')).position !== 'absolute') throw new Error('Missing map CSS');
    map.fitBounds([[extent[1],extent[0]],[extent[3],extent[2]]]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19,
      referrerPolicy:'strict-origin-when-cross-origin',
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'})
      .on('tileerror', () => { $('mapStatus').textContent = 'Some background map tiles are unavailable. Evidence overlays and point queries are independent of the basemap.'; }).addTo(map);
    floodLayer = L.geoJSON(null, {style:f => ({color:colours[f.properties.prob_4band] || '#888',
      weight:.5, fillOpacity:.65}), onEachFeature:(f,l) => {
        const text = document.createElement('span'); text.textContent = `${f.properties.prob_4band} · older EA river/sea dataset`;
        l.bindTooltip(text);
      }});
    fuelLayer = L.imageOverlay('../data/devon/wildfire-fuels.png', [[extent[1],extent[0]],[extent[3],extent[2]]],
      {opacity:.65, attribution:'European Commission / CEMS EFFIS · fuel map v2017 · CC BY 4.0'});
    fuelLayer.on('error', () => { if (mode === 'wildfire') $('mapStatus').textContent = 'Stored wildfire fuel image unavailable. No fuel or risk inference can be made.'; });
    map.on('click', e => {
      if (!inside(e.latlng.lng,e.latlng.lat)) { $('searchStatus').textContent = 'Please select a point inside the pilot window.'; return; }
      ++postcodeRun; postcodeController?.abort();
      selectPlace('Selected map point',e.latlng.lng,e.latlng.lat);
    });
    map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(updateFloodMap,250); });
    buildHeatLayer();
    setMode(mode);
  } catch {
    map?.remove(); map = null; setMode(mode);
  }
}

function buildHeatLayer() {
  if (!map || !heatData) return;
  const L = window.L;
  heatLayer = L.layerGroup(heatData.cells.map(c => {
    const [w,s,e,n] = c.bounds;
    const rectangle = L.rectangle([[s,w],[n,e]], {color:'#a35a2e', weight:1,
      fillColor:c.maximum_c >= 30 ? '#cb4838' : c.maximum_c >= 25 ? '#e59d4c' : '#f4d9ad', fillOpacity:.4});
    const label = document.createElement('span'); label.textContent = `${c.maximum_c.toFixed(1)}°C · summer 2022 regional maximum`;
    rectangle.bindTooltip(label); return rectangle;
  }));
  if (mode === 'heat') heatLayer.addTo(map);
}

$('postcodeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const run = ++postcodeRun;
  postcodeController?.abort();
  const postcode = $('postcode').value.trim().toUpperCase();
  // Clear the previous location immediately; errors must not leave stale results.
  ++pointRun; pointController?.abort(); point = null;
  marker?.remove(); marker = null;
  $('placeTitle').textContent = 'Your selected place'; $('coordinates').textContent = 'Results describe an approximate point, not a property.';
  $('floodValue').textContent = 'Select a place'; $('floodDetail').textContent = 'No current location result.';
  $('heatValue').textContent = 'Select a place'; $('heatDays').textContent = '';
  if (!validPostcode(postcode)) { $('searchStatus').textContent = 'Enter a full UK postcode, such as EX4 3NJ.'; return; }
  $('searchStatus').textContent = 'Looking up the postcode…';
  const controller = postcodeController = new AbortController();
  try {
    const result = await lookupPostcode(postcode, controller.signal);
    if (run !== postcodeRun) return;
    const codes = result.codes || {};
    if (!(codes.admin_county === 'E10000008' || ['E06000026','E06000027'].includes(codes.admin_district))
      || !inside(result.longitude,result.latitude)) {
      $('searchStatus').textContent = 'This pilot accepts postcodes in Devon, Plymouth and Torbay. Try one of the example places.'; return;
    }
    // Deliberately omit the full postcode from the displayed label and shared URL.
    selectPlace(result.admin_district || 'Devon postcode area',result.longitude,result.latitude);
  } catch (error) { if (run === postcodeRun) $('searchStatus').textContent = error.message; }
});
document.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => {
  ++postcodeRun; postcodeController?.abort(); selectPlace(...places[button.dataset.place]);
}));
document.querySelectorAll('input[name="layer"]').forEach(input => input.addEventListener('change', () => setMode(input.value)));

getJSON('../data/devon/heat.json').then(data => {
  if (!Array.isArray(data.cells) || data.cells.some(c => c.valid_days !== 92 || !Number.isFinite(c.maximum_c))) throw new Error('Invalid heat sample');
  heatData = data; updateHeat(); buildHeatLayer();
  $('retrieved').textContent = `Stored heat sample retrieved ${data.retrieved.slice(0,10)}. Flood queries run on demand; dataset age and query time are different.`;
}).catch(() => { heatFailure = true; updateHeat(); if (mode === 'heat') setMode(mode); });
if (document.readyState === 'complete') initialiseMap();
else window.addEventListener('load', initialiseMap, {once:true});
