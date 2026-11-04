// One geographic view shared by the risk and area routes. The local SVG needs
// no CDN; Leaflet progressively adds the interactive OpenStreetMap basemap.
export function createExplorerMap(container, collection, onSelect, status) {
  let map, boundaries, tiles, marker, state, previousKey = '';
  let tileErrors = false;
  const features = collection.features;
  const featureByCode = new Map(features.map(f => [f.properties.code, f]));
  const ns = 'http://www.w3.org/2000/svg';
  const selectedFeature = () => featureByCode.get(state.selectedCode);
  const announceMap = () => {
    if (!map) {
      status.textContent = 'Basemap unavailable. Showing the stored ONS boundaries' + (state.point ? ' and postcode marker' : '') + '. Use the area list or dropdown to select an LRF.';
    } else if (tileErrors) {
      status.textContent = 'Some OpenStreetMap tiles could not load. The LRF boundaries remain visible; they do not show individual hazard locations.';
    } else if (!state.selectedCode) {
      status.textContent = 'ONS-based LRF boundaries, December 2024. Basemap © OpenStreetMap contributors. Select an area to zoom in.';
    } else {
      status.textContent = tileErrors
        ? 'Some OpenStreetMap tiles could not load. The LRF boundary remains visible; it does not show individual hazard locations.'
        : 'Basemap © OpenStreetMap contributors · ONS-based LRF boundary. ' + (state.point ? 'The marker is the approximate postcode location. ' : '') + 'The boundary does not show individual hazard locations.';
    }
  };
  function style(feature) {
    const code = feature.properties.code;
    if (state.selectedCode) return code === state.selectedCode
      ? {color:'#104f40', weight:3, fillColor:'#247b5d', fillOpacity:.12}
      : {color:'#627b72', weight:1, opacity:.5, fillColor:'#d3e0d8', fillOpacity:.03};
    const matching = state.mode === 'area' || state.matchingCodes.has(code);
    return {color:matching ? '#104f40' : '#627b72', weight:matching ? 1.5 : 1, opacity:.85, fillColor:matching ? (state.mode === 'area' ? '#9bc5b1' : '#17634f') : '#d4dfda', fillOpacity:matching ? .45 : .12};
  }
  function fit() {
    if (!map || !boundaries || !state) return;
    map.invalidateSize({pan:false});
    const selected = selectedFeature();
    const bounds = selected ? window.L.geoJSON(selected).getBounds() : boundaries.getBounds();
    if (state.point) bounds.extend([state.point.latitude, state.point.longitude]);
    map.fitBounds(bounds, {padding:[24,24], maxZoom:state.selectedCode ? 11 : 7, animate:false});
    container.dataset.zoom = String(map.getZoom());
  }
  function enableKeyboard(layer, feature) {
    const element = layer.getElement();
    if (!element) return;
    element.setAttribute('tabindex', state.selectedCode && state.selectedCode !== feature.properties.code ? '-1' : '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', feature.properties.name);
    element.setAttribute('aria-pressed', String(state.selectedCode === feature.properties.code));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onSelect(feature.properties.code);
      }
    });
  }
  function initialiseLeaflet() {
    if (!window.L) return false;
    try {
      container.replaceChildren();
      const L = window.L;
      map = L.map(container, {scrollWheelZoom:false, minZoom:5, maxZoom:19, zoomSnap:.25});
      // A script alone is insufficient: fail gracefully if the stylesheet failed.
      if (getComputedStyle(map.getPane('tilePane')).position !== 'absolute') throw new Error('Leaflet stylesheet unavailable');
      tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom:19, attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
      });
      tiles.on('tileerror', () => { tileErrors = true; if (state) announceMap(); });
      boundaries = L.geoJSON(collection, {
        style,
        onEachFeature(feature, layer) {
          const label = document.createElement('span');
          label.textContent = feature.properties.name;
          layer.bindTooltip(label, {sticky:true});
          layer.on('click', () => onSelect(feature.properties.code));
          layer.on('add', () => enableKeyboard(layer, feature));
        }
      }).addTo(map);
      map.on('moveend', () => { container.dataset.zoom = String(map.getZoom()); });
      container.dataset.renderer = 'leaflet';
      return true;
    } catch {
      if (map) map.remove();
      map = null;
      container.replaceChildren();
      return false;
    }
  }
  // Spherical Mercator, using the actual stored geometry rather than a schematic.
  const project = ([lon,lat]) => [lon * Math.PI / 180, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const polygons = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  function fallback() {
    const visible = selectedFeature() ? [selectedFeature()] : features;
    const points = visible.flatMap(f => polygons(f).flat(2)).map(project);
    if (state.point) points.push(project([state.point.longitude, state.point.latitude]));
    const left = Math.min(...points.map(p=>p[0])), right = Math.max(...points.map(p=>p[0]));
    const top = Math.min(...points.map(p=>p[1])), bottom = Math.max(...points.map(p=>p[1]));
    const width = container.clientWidth || 550, height = container.clientHeight || 550;
    const scale = Math.min((width-40)/(right-left), (height-40)/(bottom-top));
    const transform = point => { const p=project(point);return [(p[0]-(left+right)/2)*scale+width/2,(p[1]-(top+bottom)/2)*scale+height/2]; };
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'overview-map');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', state.selectedCode ? `${selectedFeature().properties.name} boundary` : 'England and Wales LRF boundaries');
    for (const feature of visible) {
      const path = document.createElementNS(ns, 'path'), code = feature.properties.code;
      path.setAttribute('d', polygons(feature).map(polygon => polygon.map(ring => ring.map((p,i) => (i?'L':'M')+transform(p).join(',')).join(' ')+'Z').join(' ')).join(' '));
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('class', 'forum-shape' + (state.mode==='area'?' area-mode':'') + (state.matchingCodes.has(code)?' matching':'') + (code===state.selectedCode?' chosen':''));
      path.dataset.code = code;
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', feature.properties.name);
      path.setAttribute('aria-pressed', String(code===state.selectedCode));
      const title = document.createElementNS(ns,'title');title.textContent=feature.properties.name;path.appendChild(title);
      path.addEventListener('click', () => onSelect(code));
      path.addEventListener('keydown', event => { if (event.key==='Enter'||event.key===' ') {event.preventDefault();onSelect(code);} });
      svg.appendChild(path);
    }
    if (state.point) {
      const point=transform([state.point.longitude,state.point.latitude]),dot=document.createElementNS(ns,'circle');
      dot.setAttribute('cx',point[0]);dot.setAttribute('cy',point[1]);dot.setAttribute('r',7);dot.setAttribute('class','map-postcode');
      const title=document.createElementNS(ns,'title');title.textContent='Approximate postcode location';dot.appendChild(title);svg.appendChild(dot);
    }
    container.replaceChildren(svg);
    container.dataset.renderer = 'svg';
    container.dataset.zoom = state.selectedCode ? 'local' : 'national';
  }
  function update(next) {
    state = next;
    const key = [state.mode,state.selectedCode,[...state.matchingCodes].join(','),state.point?.postcode].join('|');
    if (key===previousKey) return;
    previousKey=key;
    if (!map && container.dataset.renderer!=='svg') initialiseLeaflet();
    if (map) {
      boundaries.setStyle(style);
      boundaries.eachLayer(layer => {
        layer.getElement()?.setAttribute('aria-pressed',String(layer.feature.properties.code===state.selectedCode));
        layer.getElement()?.setAttribute('tabindex',state.selectedCode && layer.feature.properties.code!==state.selectedCode ? '-1' : '0');
        if (layer.feature.properties.code===state.selectedCode) layer.bringToFront();
      });
      if (!map.hasLayer(tiles)) tiles.addTo(map);
      if (marker) {map.removeLayer(marker);marker=null;}
      if (state.point) marker=window.L.circleMarker([state.point.latitude,state.point.longitude],{radius:7,color:'#fff',weight:2,fillColor:'#ad4933',fillOpacity:1}).addTo(map).bindTooltip('Approximate postcode location');
      fit();
    } else fallback();
    announceMap();
  }
  let frame;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(() => {if(state){if(map)fit();else fallback();}});
  });
  observer.observe(container);
  return {update};
}
