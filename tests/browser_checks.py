#!/usr/bin/env python3
"""Integration checks using the standard ChromeDriver HTTP protocol.
Requires Chromium and ChromeDriver, but no Selenium/Python dependencies.
External postcode responses are mocked; the map uses its offline fallback.
"""
import functools
import base64
import sys
import http.server
import json
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]

class Site(http.server.SimpleHTTPRequestHandler):
    production_analytics = False
    def do_GET(self):
        # Test a Pages-style subdirectory, not just domain-root hosting.
        if not self.path.startswith('/communityrisk/'):
            self.send_error(404); return
        self.path = self.path[len('/communityrisk'):]
        if self.path == '/assets/analytics.js' and self.production_analytics:
            source = (ROOT / 'assets/analytics.js').read_text()
            original = "new Set(['communityrisk.climateresilient.org.uk', 'pedrito1414.github.io'])"
            assert original in source
            source = source.replace(original, "new Set(['127.0.0.1'])").encode()
            self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(source)
            return
        super().do_GET()
    def log_message(self, *args): pass

def main():
    driver_binary = shutil.which('chromedriver'); browser = shutil.which('chromium') or shutil.which('chromium-browser')
    if not driver_binary or not browser: raise SystemExit('Install Chromium and ChromeDriver to run browser checks.')
    port = free_port(); driver_port = free_port()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Site, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    driver = subprocess.Popen([driver_binary, f'--port={driver_port}'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prefix = f'http://127.0.0.1:{port}/communityrisk/'
    endpoint = f'http://127.0.0.1:{driver_port}'
    session = None
    def request(path, value=None, method=None):
        data = None if value is None else json.dumps(value).encode()
        req = urllib.request.Request(endpoint + path, data=data, headers={'Content-Type':'application/json'}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=40) as response: result = json.load(response)
        except urllib.error.HTTPError as error: raise AssertionError(error.read().decode()) from error
        value = result.get('value')
        if isinstance(value, dict) and value.get('error'): raise AssertionError(value)
        return value
    def execute(code, args=None): return request(f'/session/{session}/execute/sync', {'script':code,'args':args or []})
    def async_js(code, args=None): return request(f'/session/{session}/execute/async', {'script':code,'args':args or []})
    def visit(path): request(f'/session/{session}/url', {'url':prefix + path})
    def screenshot(name):
        if '--screenshots' not in sys.argv: return
        folder = Path(tempfile.gettempdir()) / 'communityrisk-qa'; folder.mkdir(exist_ok=True)
        image = request(f'/session/{session}/screenshot')
        (folder / (name + '.png')).write_bytes(base64.b64decode(image))
    def wait(expression):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if execute('return !!(' + expression + ')'): return
            time.sleep(.05)
        raise AssertionError('Timed out waiting for ' + expression + '\n' + str(execute("return document.getElementById('loadError')?.textContent")) + '\n' + str(request(f'/session/{session}/log', {'type':'browser'})))
    try:
        for _ in range(100):
            try: request('/status'); break
            except Exception:
                if driver.poll() is not None: raise RuntimeError('ChromeDriver could not start.')
                time.sleep(.05)
        with tempfile.TemporaryDirectory(prefix='communityrisk-browser-') as profile:
            result = request('/session', {'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'binary':browser,'args':['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server', *([] if '--live' in sys.argv else ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']), f'--user-data-dir={profile}']},'goog:loggingPrefs':{'browser':'ALL'}}}})
            session = result['sessionId']
            request(f'/session/{session}/timeouts', {'script':15000,'pageLoad':30000})
            request(f'/session/{session}/window/rect', {'width':1280,'height':1000})
            visit('')
            assert execute("return document.title.includes('Community risk') && [...document.querySelectorAll('.choice')].length===2")
            screenshot('home-desktop')
            print('PASS: home menu and Pages subdirectory hosting')
            visit('devon/')
            wait("document.getElementById('mapStatus').textContent !== 'Loading the optional interactive map…'")
            if '--live' in sys.argv:
                execute("document.querySelector('[data-place=exeter]').click()")
                wait("!['Select a place','Checking the flood evidence…'].includes(document.getElementById('floodValue').textContent)")
                assert execute("return document.getElementById('floodValue').textContent!=='Flood query unavailable'"), 'Live EA point query failed'
                wait("!document.getElementById('mapStatus').textContent.includes('Loading river')")
                execute("document.querySelector('.workspace').scrollIntoView()")
                screenshot('devon-live-map')
                print('PASS: live Devon EA flood point query')
            execute("""
              window.devonRequests=[];
              const originalFetch=window.fetch;
              window.fetch=async function(url, options){
                const address=String(url);
                if(address.includes('/FeatureServer/0/query')){
                  window.devonRequests.push(address);
                  const q=new URL(address).searchParams;
                  if(window.failDevonFlood)throw new TypeError('offline');
                  if(q.get('returnCountOnly')==='true')return new Response(JSON.stringify({count:0}));
                  if(q.get('f')==='geojson')return new Response(JSON.stringify({type:'FeatureCollection',features:[]}));
                  return new Response(JSON.stringify({features:[{attributes:{prob_4band:'High',suitability:'Test fixture'}}]}));
                }
                if(address.includes('api.postcodes.io'))return new Response(JSON.stringify({status:200,result:{longitude:-.1278,latitude:51.5074,admin_district:'Westminster',codes:{admin_county:null,admin_district:'E09000033'}}}));
                return originalFetch(url,options);
              };
              document.querySelector('[data-place="exeter"]').click();
            """)
            wait("document.getElementById('floodValue').textContent.includes('High')")
            wait("document.getElementById('heatValue').textContent.includes('°C')")
            assert execute("return document.getElementById('heatValue').textContent==='28.7°C summer maximum'")
            assert execute("return !location.search && !location.hash && !document.querySelector('script[src*=analytics]')")
            screenshot('devon-desktop')
            execute("window.failDevonFlood=true;document.querySelector('[data-place=plymouth]').click()")
            wait("document.getElementById('floodValue').textContent==='Flood query unavailable'")
            assert execute("return !document.getElementById('floodValue').textContent.includes('High')")
            count=execute('return window.devonRequests.length')
            execute("document.getElementById('postcode').value='SW1A 1AA';document.getElementById('postcodeForm').requestSubmit()")
            wait("document.getElementById('searchStatus').textContent.includes('accepts postcodes')")
            assert execute('return window.devonRequests.length') == count
            assert execute("return document.getElementById('floodValue').textContent==='Select a place' && document.getElementById('heatValue').textContent==='Select a place'")
            execute("document.querySelector('input[value=wildfire]').click()")
            assert execute("return !!document.querySelector('#legend img')")
            request(f'/session/{session}/window/rect', {'width':390,'height':844})
            assert execute('return document.documentElement.scrollWidth<=innerWidth'), 'Devon mobile overflow'
            screenshot('devon-mobile')
            request(f'/session/{session}/window/rect', {'width':1280,'height':1000})
            print('PASS: Devon heat values, flood queries/failures, postcode scope, stale-result clearing, source legend and mobile layout')
            visit('')
            result = async_js("""
              const done=arguments[arguments.length-1];
              Promise.all([import('./assets/data.js'),import('./assets/ranking.js'),import('./assets/geometry.js')]).then(async ([data,rank,geo])=>{
                const db=await data.loadData();
                const tests=[
                  [{rating:'Very high (text description)'},5],
                  [{rating:'Moderate',likelihood:1,impact:4},1],
                  [{rating:'Critical'},null],
                  [{likelihood:3,impact:5,visualRating:5},3],
                  [{visualRating:3.6},4], [{},null]
                ];
                for(const [r,expected] of tests)if(rank.commonRanking(r)!==expected)throw Error('Rank regression');
                const places=[[-3.5339,50.7184,'E48000008'],[-.1278,51.5074,'E48000021'],[-3.1791,51.4816,'W41000004'],[-2.2426,53.4808,'E48000013'],[-3.1883,55.9533,'S43000004'],[-4.2518,55.8642,'S43000003'],[-4.2247,57.4778,'S43000005'],[-1.145,60.155,'S43000005']];
                for(const [lon,lat,code] of places){const found=geo.findForumFeatures(db.boundaries,lon,lat);if(found.length!==1||found[0].properties.code!==code)throw Error('Wrong boundary for '+[lon,lat]);}
                const donut={geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]}};
                if(!geo.containsPoint(donut,[.5,.5])||geo.containsPoint(donut,[2,2])||geo.containsPoint(donut,[5,5]))throw Error('Polygon holes');
                done({counts:[db.forums.length,db.risks.length,db.nationalRisks.length,db.matches.length]});
              }).catch(e=>done({error:e.message}));
            """)
            assert result == {'counts':[45,657,95,681]}, result
            print('PASS: shared data, ranking precedence and geographic lookup (including polygon holes)')
            result=async_js("""
              const done=arguments[arguments.length-1];
              Promise.all([import('./assets/data.js'),import('./assets/definitions.js')]).then(async([loader,defs])=>{
                const db=await loader.loadData();
                const local=db.risks.find(r=>r.id==='E48000001-001');
                if(defs.resolveRiskDefinition(local,db).kind!=='local')throw Error('Local definition missing');
                const direct=db.risks.find(r=>!db.definitions.local[r.id]&&db.matches.some(m=>m.local_id===r.id&&m.match_status==='Direct'));
                if(defs.resolveRiskDefinition(direct,db).kind!=='national')throw Error('National fallback missing');
                const localDb={...db,definitions:{...db.definitions,local:{...db.definitions.local,[direct.id]:{text:'Local priority <script>test</script>',source_id:'avon-somerset-2026',pdf_page:9}}}};
                if(defs.resolveRiskDefinition(direct,localDb).kind!=='local'||!defs.riskDefinitionHTML(direct,localDb).includes('&lt;script&gt;'))throw Error('Local precedence or escaping');
                const candidateDb={...db,matches:db.matches.map(m=>m.local_id===direct.id?{...m,match_status:'Candidate'}:m),definitions:{...db.definitions,related:{}}};
                if(defs.resolveRiskDefinition(direct,candidateDb).kind!=='unavailable')throw Error('Candidate must not silently become a definition match');
                const related=db.risks.find(r=>defs.resolveRiskDefinition(r,db).kind==='related');
                if(defs.resolveRiskDefinition(related,db).kind!=='related')throw Error('Related context label');
                const missing=db.risks.find(r=>defs.resolveRiskDefinition(r,db).kind==='unavailable');
                if(defs.resolveRiskDefinition(missing,db).kind!=='unavailable')throw Error('Missing definitions must be explicit');
                const web=db.risks.find(r=>r.id==='E48000014-069');
                const html=defs.riskDefinitionHTML(web,db);
                if(!html.includes('Land movement')||!html.includes('hiowprepared.org.uk')||html.includes('#page=')||html.includes('undefined'))throw Error('Web source must link to its topic without a fake PDF page');
                const pdf=defs.riskDefinitionHTML(db.risks.find(r=>r.id==='E48000017-001'),db);
                if(!pdf.includes('#page=3')||!pdf.includes('Kent and Medway'))throw Error('Local PDF source page missing');
                done({national:Object.keys(db.definitions.national).length,local:Object.keys(db.definitions.local).length});
              }).catch(error=>done({error:error.message}));
            """)
            assert result=={'national':95,'local':372},result
            print('PASS: local definition precedence, national fallback, related context, missing definitions and safe HTML')
            visit('registers/legacy/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            assert execute("return document.querySelectorAll('.region').length===45 && document.querySelectorAll('.national-risk-item').length===95")
            execute("document.getElementById('region').value='E48000032';document.getElementById('region').dispatchEvent(new Event('change'))")
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===18")
            execute("document.querySelector('#riskRows tr').click()")
            assert execute("return !!document.querySelector('.expanded-risk')")
            execute("document.getElementById('riskSearch').value='no-such-risk';document.getElementById('riskSearch').dispatchEvent(new Event('input'))")
            assert execute("return document.getElementById('riskRows').textContent.includes('No matching risks')")
            visit('registers/legacy/?area=E48000031')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===47")
            visit('registers/legacy/?area=E48000009')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===42")
            execute("document.getElementById('plotTab').click()")
            assert execute("return !document.getElementById('plotView').hidden && document.querySelectorAll('.plot-marker').length>0")
            execute("document.querySelector('.plot-marker').dispatchEvent(new MouseEvent('click'))")
            assert execute("return document.querySelectorAll('.cluster-item').length>0")
            execute("document.querySelector('.national-risk-item').click()")
            assert execute("return !document.getElementById('nationalSelected').hidden")
            execute("document.getElementById('clearNational').click()")
            visit('registers/legacy/?area=E48000001')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===9")
            execute("document.querySelector('#riskRows tr').click()")
            assert execute("return document.querySelector('.expanded-risk [data-definition-kind=local]') && document.querySelector('.expanded-risk .rating-source > summary').textContent==='Rating and source details'")
            assert execute("return !document.querySelector('.expanded-risk .rating-source').open && document.querySelector('.expanded-risk').textContent.includes('Risk definition')")
            execute("document.querySelector('.expanded-risk').scrollIntoView({block:'center'})")
            screenshot('definition-dashboard')
            print('PASS: dashboard records, search, expansion, plot, national filter, area links and definition-first details')
            # Existing entry points and Pages-style subdirectory links.
            observe_postcodes=request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"window.postcodeRequests=[];const original=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('api.postcodes.io'))window.postcodeRequests.push(String(url));return original(url,options);};"}})
            for old_path in ['bypostcode/?postcode=EX2%204QD', 'bypostcode/index.html?postcode=EX2%204QD']:
                visit(old_path)
                wait("document.getElementById('postcode')?.value==='EX2 4QD' && !document.getElementById('postcode').disabled")
                assert execute("return location.pathname.endsWith('/registers/') && location.search==='?view=area' && document.getElementById('region').value==='' && window.postcodeRequests.length===0 && document.activeElement.id==='postcode'")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':observe_postcodes['identifier']}})
            for old_path in ['registers/preview/', 'registers/preview/index.html']:
                visit(old_path+'?view=risk&risk=NRR26-074&area=E48000008&ignored=value')
                wait("document.getElementById('resultsTitle')?.textContent.includes('Devon')")
                assert execute("return location.pathname.endsWith('/registers/') && !location.search.includes('ignored') && !document.getElementById('nationalControls').hidden && document.querySelector('.matching-callout').textContent.includes('Coastal flooding')")
            visit('registers/?area=E48000009')
            wait("document.querySelectorAll('.local-risk').length===42")
            assert execute("return !document.getElementById('areaControls').hidden && document.getElementById('region').value==='E48000009'")
            execute("document.querySelector('.local-risk').open=true")
            execute("document.querySelector('#localRisks [data-national]').click()")
            assert execute("return !document.getElementById('nationalControls').hidden && !location.search.includes('area=') && document.querySelectorAll('#results [data-area]').length>0"), 'Across areas must return to the national map'
            request(f'/session/{session}/back', {})
            wait("document.querySelectorAll('.local-risk').length===42")
            request(f'/session/{session}/forward', {})
            wait("!document.getElementById('nationalControls').hidden")
            visit('registers/?view=area&area=invalid&risk=invalid')
            wait("document.getElementById('resultsTitle')?.textContent==='Find your local risk register'")
            assert execute("return !document.getElementById('region').value && document.getElementById('loadError').hidden")
            visit('')
            assert execute("return [...document.querySelectorAll('.choice')].map(a=>a.getAttribute('href')).join('|')==='registers/?view=risk|registers/?view=area'")
            if '--live' in sys.argv:
                visit('registers/?view=area')
                wait("!document.getElementById('postcodeSubmit').disabled")
                execute("document.getElementById('postcode').value='EX2 4QD';document.getElementById('postcodeForm').requestSubmit()")
                wait("!document.getElementById('postcodeSubmit').disabled")
                assert execute("return document.getElementById('region').value==='E48000008' && document.getElementById('explorerMap').dataset.renderer==='leaflet'"), execute("return document.getElementById('postcodeError').textContent")
                wait("[...document.querySelectorAll('.leaflet-tile')].some(t=>t.naturalWidth>0)")
                screenshot('explorer-live-postcode')
                print('PASS: live Postcodes.io lookup and OpenStreetMap basemap')
            print('PASS: old area links, postcode prefills without submission, preview redirects, national drill-up, Back/Forward, invalid IDs and home links')
            visit('registers/')
            wait("document.getElementById('resultsTitle').textContent==='Surface water flooding'")
            assert execute("return document.querySelectorAll('#nationalTree [data-national]').length===95 && document.querySelectorAll('#region option').length===46")
            expected=async_js("""
              const done=arguments[arguments.length-1];
              import('../assets/data.js').then(async m=>{
                const db=await m.loadData();
                done([...new Set(db.matches.filter(m=>m.national_id==='NRR26-076'&&m.match_status==='Direct').map(m=>m.forum_code))].sort());
              });
            """)
            actual=execute("return [...document.querySelectorAll('#results [data-area]')].map(b=>b.dataset.area).sort()")
            assert actual==expected, (actual,expected)
            execute("document.getElementById('nationalSearch').focus();document.getElementById('nationalSearch').value='flood';document.getElementById('nationalSearch').dispatchEvent(new Event('input'))")
            # Real pointer events, including time for the blur timer between down/up.
            # A DOM .click() does not reproduce the focus change that caused this bug.
            option=request(f'/session/{session}/element', {'using':'css selector','value':'#nationalSuggestions [data-suggestion="NRR26-074"]'})
            element_id=option['element-6066-11e4-a52e-4f735466cecf']
            request(f'/session/{session}/actions', {'actions':[{'type':'pointer','id':'suggestion-mouse','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','duration':0,'origin':{'element-6066-11e4-a52e-4f735466cecf':element_id},'x':0,'y':0},{'type':'pointerDown','button':0},{'type':'pause','duration':100},{'type':'pointerUp','button':0}]}]})
            assert execute("return document.getElementById('resultsTitle').textContent==='Coastal flooding' && document.getElementById('nationalSuggestions').hidden && location.search.includes('NRR26-074')"), 'Pointer selection must not be swallowed by input blur'
            visit('registers/')
            wait("document.getElementById('resultsTitle').textContent==='Surface water flooding'")
            assert execute("return document.querySelectorAll('#explorerMap .forum-shape.matching, #explorerMap .leaflet-overlay-pane path[fill=\"#17634f\"]').length") == len(expected)
            if '--live' in sys.argv:
                wait("[...document.querySelectorAll('#explorerMap .leaflet-tile')].some(t=>t.naturalWidth>0)")
                assert execute("return [...document.querySelectorAll('#explorerMap .leaflet-overlay-pane path')].every(p=>Number(p.getAttribute('fill-opacity'))<1)"), 'Overview boundaries should reveal the basemap'
            screenshot('explorer-preview-national')
            overview_zoom=execute("return document.getElementById('explorerMap').dataset.zoom")
            execute("document.querySelector('#results [data-area=E48000008]').click()")
            wait("document.getElementById('resultsTitle').textContent.includes('Devon')")
            assert execute("return document.querySelectorAll('.local-risk').length===1 && document.querySelector('.local-risk').open && document.querySelector('.local-risk .risk-definition') && location.search.includes('area=E48000008')")
            local_zoom=execute("return document.getElementById('explorerMap').dataset.zoom")
            assert (local_zoom=='local' and overview_zoom=='national') or float(local_zoom)>float(overview_zoom)
            if '--live' in sys.argv:
                assert execute("return document.getElementById('explorerMap').dataset.renderer==='leaflet'")
                wait("[...document.querySelectorAll('#explorerMap .leaflet-tile')].some(t=>t.naturalWidth>0)")
            screenshot('explorer-preview-local')
            execute("document.getElementById('exploreArea').click()")
            assert execute("return !document.getElementById('areaControls').hidden && document.getElementById('region').value==='E48000008' && document.querySelectorAll('.local-risk').length===16 && document.querySelectorAll('.local-risk[open]').length===0")
            execute("document.getElementById('localSearch').value='no-such-risk';document.getElementById('localSearch').dispatchEvent(new Event('input'))")
            assert execute("return document.querySelectorAll('.local-risk').length===0 && document.getElementById('localRisks').textContent.includes('No local entries')")
            execute("document.getElementById('region').value='E48000001';document.getElementById('region').dispatchEvent(new Event('change'))")
            assert execute("return document.querySelectorAll('.local-risk').length===9 && document.getElementById('localSearch').value===''")
            execute("document.querySelector('.local-risk').open=true")
            assert execute("return document.querySelector('.local-risk [data-definition-kind=local]') && !document.querySelector('.local-risk .rating-source').open")
            execute("document.getElementById('riskRoute').click()")
            assert execute("return document.getElementById('results').textContent.includes('No eligible local link') && document.getElementById('resultsTitle').textContent.includes('Avon')")
            execute("document.getElementById('showAll').click()")
            assert execute("return document.querySelectorAll('#results [data-area]').length") == len(expected)
            execute("document.getElementById('nationalSearch').value='heatwave';document.getElementById('nationalSearch').dispatchEvent(new Event('input'));document.getElementById('nationalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))")
            assert execute("return document.getElementById('nationalSearch').getAttribute('aria-activedescendant') && document.querySelector('#nationalSuggestions [aria-selected=true]')")
            execute("document.getElementById('nationalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))")
            assert execute("return document.getElementById('resultsTitle').textContent.includes('heatwaves') && document.getElementById('nationalSuggestions').hidden && location.search.includes('NRR26-072')")
            request(f'/session/{session}/back', {})
            wait("document.getElementById('resultsTitle').textContent==='Surface water flooding'")
            # Catalogue choices with no direct matches must not imply absence of risk.
            empty_id=async_js("""
              const done=arguments[arguments.length-1];import('../assets/data.js').then(async m=>{const db=await m.loadData();done(db.nationalRisks.find(n=>!db.matches.some(m=>m.national_id===n.national_id&&m.match_status==='Direct')).national_id);});
            """)
            execute("document.querySelector('#nationalTree [data-national=\"'+arguments[0]+'\"]').click()", [empty_id])
            assert execute("return document.querySelectorAll('#results [data-area]').length===0 && document.getElementById('results').textContent.includes('No eligible local links')")
            # Postcode response is deterministic here; a stale completion cannot replace a manual selection.
            execute("""
              document.getElementById('areaRoute').click();
              window.previewOriginalFetch=window.fetch;
              window.previewMode='ok';window.previewPending=null;
              window.fetch=(url,options)=>{
                if(!String(url).includes('api.postcodes.io'))return previewOriginalFetch(url,options);
                if(previewMode==='missing')return Promise.resolve(new Response('{}',{status:404}));
                const response=()=>new Response(JSON.stringify({status:200,result:{postcode:'EX2 4QD',longitude:-3.5339,latitude:50.7184,country:'England',admin_district:'Exeter'}}));
                if(previewMode==='slow')return new Promise(resolve=>{previewPending=()=>resolve(response());});
                return Promise.resolve(response());
              };
              document.getElementById('postcode').value='EX2 4QD';document.getElementById('postcodeForm').requestSubmit();
            """)
            wait("!document.getElementById('postcodeSubmit').disabled")
            assert execute("return document.getElementById('region').value==='E48000008' && document.getElementById('results').textContent.includes('EX2 4QD') && !location.search.includes('postcode') && !location.search.includes('EX2')")
            assert execute("return !!document.querySelector('#explorerMap .map-postcode, #explorerMap .leaflet-overlay-pane circle, #explorerMap .leaflet-overlay-pane path[fill=\"#ad4933\"]')")
            execute("window.previewMode='missing';document.getElementById('postcodeForm').requestSubmit()")
            wait("!document.getElementById('postcodeSubmit').disabled")
            assert execute("return !document.getElementById('postcodeError').hidden && document.getElementById('postcodeError').textContent.includes('not found') && !document.getElementById('region').value && !document.getElementById('results').textContent.includes('EX2 4QD')")
            execute("window.previewMode='slow';document.getElementById('postcodeForm').requestSubmit()")
            wait("window.previewPending")
            execute("document.getElementById('region').value='E48000001';document.getElementById('region').dispatchEvent(new Event('change'));window.previewPending()")
            wait("!document.getElementById('postcodeSubmit').disabled")
            assert execute("return document.getElementById('region').value==='E48000001' && document.getElementById('resultsTitle').textContent.includes('Avon') && document.getElementById('postcodeError').hidden")
            request(f'/session/{session}/window/rect', {'width':390,'height':844})
            assert execute("return document.documentElement.scrollWidth<=window.innerWidth"), 'Preview area route overflows mobile width'
            execute("document.getElementById('riskRoute').click();document.getElementById('showAll').click();document.getElementById('nationalBrowse').open=true")
            assert execute("return document.documentElement.scrollWidth<=window.innerWidth"), 'Preview risk catalogue overflows mobile width'
            screenshot('explorer-preview-mobile')
            request(f'/session/{session}/window/rect', {'width':1280,'height':1000})
            print('PASS: explorer national matching, map zoom, risk/area navigation, local definitions, keyboard search, empty matches, postcode failures/races and mobile layouts')
            for code, count in [('S43000004',8),('S43000005',9),('S43000003',9)]:
                visit('registers/?view=area&area='+code)
                wait(f"document.querySelectorAll('.local-risk').length==={count}")
                assert execute("return [...document.querySelectorAll('.local-risk .rank')].every(x=>x.textContent==='Unranked') && document.getElementById('results').textContent.includes('Scotland integration preview')")
                execute("document.querySelector('.local-risk summary').click()")
                assert execute("return document.querySelector('.local-risk[open] .risk-definition').textContent.includes('2024')")
            screenshot('scotland-west-desktop')
            visit('registers/?view=area')
            wait("!document.getElementById('postcodeSubmit').disabled")
            execute("""
              window.fetch=(original=> (url,options)=>String(url).startsWith('https://api.postcodes.io/')
                ? Promise.resolve(new Response(JSON.stringify({status:200,result:{postcode:'EH1 1YZ',longitude:-3.1883,latitude:55.9533,country:'Scotland'}})))
                : original(url,options))(window.fetch);
              document.getElementById('postcode').value='EH1 1YZ';document.getElementById('postcodeForm').requestSubmit();
            """)
            wait("document.getElementById('region').value==='S43000004'")
            assert execute("return document.querySelectorAll('.local-risk').length===8 && document.getElementById('postcodeError').hidden")
            print('PASS: three Scottish registers, unscored definitions, islands and Scottish postcode lookup')
            visit('registers/?view=risk&risk=NRR26-071')
            wait("document.querySelector('#results [data-area=S43000005]')")
            assert execute("return document.querySelectorAll('#explorerMap .forum-shape.broad, #explorerMap .leaflet-overlay-pane path[fill=\"#b87827\"]').length===3 && document.getElementById('mapLegend').textContent.includes('Broader topic coverage')")
            screenshot('scotland-storms-overview')
            execute("document.getElementById('includeBroad').click()")
            assert execute("return !document.querySelector('#results [data-area=S43000005]') && !document.querySelector('#explorerMap .forum-shape.broad, #explorerMap .leaflet-overlay-pane path[fill=\"#b87827\"]') && location.search.includes('matches=direct')")
            request(f'/session/{session}/refresh', {})
            wait("!document.getElementById('includeBroad').checked")
            execute("document.getElementById('includeBroad').click();document.querySelector('#results [data-area=S43000005]').click()")
            assert execute("return document.querySelector('.local-risk .match-kind').textContent==='Broader topic coverage' && document.querySelector('.national-link-review').textContent.includes('national') && document.querySelectorAll('.local-risk').length===1")
            screenshot('scotland-broad-match')
            visit('registers/?view=risk&risk=NRR26-044&matches=direct')
            wait("document.querySelector('#results [data-area=S43000005]')")
            assert execute("return !!document.querySelector('#results [data-area=S43000004]') && !document.querySelector('#results [data-area=S43000003]')")
            execute("document.getElementById('includeBroad').click()")
            assert execute("return !!document.querySelector('#results [data-area=S43000003]')")
            visit('registers/?view=area&area=S43000003')
            wait("document.querySelectorAll('.local-risk').length===9")
            execute("document.getElementById('localSearch').value='Electricity';document.getElementById('localSearch').dispatchEvent(new Event('input'));document.querySelector('.local-risk summary').click()")
            assert execute("return document.querySelectorAll('.national-link-review').length===2 && document.querySelectorAll('.explore-national').length===2 && document.querySelector('.rank').textContent==='Unranked'")
            execute("document.querySelector('[data-national=NRR26-045]').click()")
            wait("document.getElementById('resultsTitle').textContent==='Regional failure of the electricity network'")
            assert execute("return !!document.querySelector('#results [data-area=S43000003]')")
            print('PASS: reviewed one-to-many links, broad/direct filter persistence, map styles, direct power matches and area-to-national navigation')
            # Only expected unavailable external map assets are allowed in the console.
            logs = request(f'/session/{session}/log', {'type':'browser'})
            unexpected = [x['message'] for x in logs if x['level']=='SEVERE' and not any(text in x['message'] for text in ['unpkg.com','tile.openstreetmap.org','favicon.ico'])]
            assert not unexpected, '\n'.join(unexpected)
            print('PASS: no unexpected browser errors')
            # Simulate the public host only inside this test server. Never send test hits to GoatCounter.
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setCacheDisabled','params':{'cacheDisabled':True}})
            capture_source = """
              window.analyticsRequests=[];
              const analyticsFetch=window.fetch;
              window.fetch=(url,options)=>{
                if(String(url).startsWith('https://climateresilient.goatcounter.com/count')){
                  window.analyticsRequests.push({url:String(url),options});
                  return Promise.resolve(new Response(null,{status:204}));
                }
                return analyticsFetch(url,options);
              };
            """
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':capture_source}})
            visit('bypostcode/?postcode=EX2%209AW#private-fragment')
            assert execute("return window.analyticsRequests.length===0"), 'Local previews must not count'
            Site.production_analytics = True
            # Start a fresh browser so its module cache cannot reuse the local-only tracker.
            request(f'/session/{session}', method='DELETE')
            result = request('/session', {'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'binary':browser,'args':['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server', *([] if '--live' in sys.argv else ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']), f'--user-data-dir={profile}/analytics-checks']},'goog:loggingPrefs':{'browser':'ALL'}}}})
            session = result['sessionId']
            request(f'/session/{session}/timeouts', {'script':15000,'pageLoad':30000})
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':capture_source}})
            visit('bypostcode/?postcode=EX2%209AW&utm_campaign=PRIVATECAMPAIGN#private-fragment')
            wait("window.analyticsRequests.length===1 && document.getElementById('postcode')?.value==='EX2 9AW'")
            first_hit=execute("return window.analyticsRequests[0]")
            from urllib.parse import parse_qs, urlsplit, unquote
            first_params=parse_qs(urlsplit(first_hit['url']).query)
            assert first_params['p']==['/registers/'] and first_params['t']==['Risk register dashboard']
            assert 'q' not in first_params
            assert first_hit['options']['credentials']=='omit' and first_hit['options']['referrerPolicy']=='no-referrer'
            execute("""
              const beforeMock=window.fetch;
              window.fetch=(url,options)=>String(url).includes('api.postcodes.io')
                ? Promise.resolve(new Response(JSON.stringify({status:200,result:{postcode:'EX2 9AW',longitude:-3.5339,latitude:50.7184,country:'England',admin_district:'Exeter'}})))
                : beforeMock(url,options);
              document.getElementById('postcodeForm').requestSubmit();
            """)
            wait("document.querySelectorAll('.local-risk').length===16 && !document.getElementById('postcodeSubmit').disabled")
            execute("document.getElementById('localSearch').value='PRIVATESEARCHMARKER';document.getElementById('localSearch').dispatchEvent(new Event('input'))")
            execute("document.getElementById('localSearch').value='';document.getElementById('localSearch').dispatchEvent(new Event('input'));document.querySelector('.local-risk').open=true")
            wait("window.analyticsRequests.some(hit=>new URL(hit.url).searchParams.get('p').startsWith('risk-opened/'))")
            execute("document.addEventListener('click',event=>event.preventDefault(),{once:true});document.querySelector('[data-analytics-event=register-source]').click()")
            execute("document.getElementById('riskRoute').click();document.querySelector('#nationalTree [data-national]').click()")
            hits=execute("return window.analyticsRequests")
            paths=[parse_qs(urlsplit(hit['url']).query)['p'][0] for hit in hits]
            assert 'postcode-started/registers' in paths and 'postcode-succeeded/registers/E48000008' in paths
            assert 'register-source/registers/E48000008' in paths
            assert 'area-selected/registers/E48000008' in paths
            assert 'view-changed/registers/risk' in paths
            assert any(path.startswith('risk-opened/registers/E48000008-') for path in paths)
            assert any(path.startswith('national-selected/registers/NRR26-') for path in paths)
            assert sum(not parse_qs(urlsplit(hit['url']).query).get('e') for hit in hits)==1, 'Lookup and route changes must not add duplicate pageviews'
            for hit in hits:
                decoded=unquote(hit['url'])
                assert all(private not in decoded for private in ['EX2 9AW','PRIVATECAMPAIGN','PRIVATESEARCHMARKER','private-fragment'])
                assert 'q' not in parse_qs(urlsplit(hit['url']).query)
            print('PASS: canonical pageviews and explorer actions exclude postcodes, queries, search text and fragments')
            visit('privacy/')
            execute("document.getElementById('analyticsPreference').click()")
            visit('')
            assert execute("return window.analyticsRequests.length===0"), 'Opt-out must suppress all requests'
            execute("localStorage.removeItem('skipgc')")
            for signal in ["Object.defineProperty(navigator,'doNotTrack',{value:'1',configurable:true})", "Object.defineProperty(navigator,'globalPrivacyControl',{value:true,configurable:true})"]:
                injected=request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':signal}})
                visit('')
                assert execute("return window.analyticsRequests.length===0"), 'Browser privacy signal must suppress all requests'
                request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':injected['identifier']}})
            print('PASS: local preview suppression, saved opt-out, Do Not Track and Global Privacy Control')
            broken=request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"window.fetch=((original)=>(url,options)=>String(url).includes('goatcounter.com')?Promise.reject(new Error('Analytics blocked')):original(url,options))(window.fetch);"}})
            visit('registers/?view=area&area=E48000008')
            wait("document.querySelectorAll('.local-risk').length===16")
            assert execute("return document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':broken['identifier']}})
            print('PASS: blocked analytics requests do not stop the risk dashboard')
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.enable','params':{}})
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setCacheDisabled','params':{'cacheDisabled':True}})
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setBlockedURLs','params':{'urls':['*/assets/analytics.js']}})
            visit('registers/?view=area&area=E48000008')
            wait("document.querySelectorAll('.local-risk').length===16")
            assert execute("return window.analyticsRequests.length===0 && document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setBlockedURLs','params':{'urls':[]}})
            print('PASS: a blocked analytics script does not stop the risk dashboard')
            optional_failure=request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"window.fetch=((original)=>(url,options)=>String(url).includes('risk-definitions.json')?Promise.resolve(new Response('',{status:503})):original(url,options))(window.fetch);"}})
            visit('registers/?view=area&area=E48000008')
            wait("document.querySelectorAll('.local-risk').length===16")
            execute("document.querySelector('.local-risk').open=true")
            assert execute("return document.querySelector('.local-risk').textContent.includes('Definition information could not be loaded') && document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':optional_failure['identifier']}})
            print('PASS: unavailable definitions do not stop existing risk records or ratings')
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"const originalFetch=window.fetch;window.fetch=(url, options)=>String(url).includes('forums.json')?Promise.resolve(new Response('',{status:503})):originalFetch(url,options);"}})
            visit('registers/?view=area&area=E48000008')
            wait("!document.getElementById('loadError').hidden")
            assert execute("return document.getElementById('loadError').textContent.includes('HTTP 503')")
            print('PASS: missing shared data produces a readable dashboard error')
            request(f'/session/{session}', method='DELETE'); session = None
    finally:
        if session:
            try: request(f'/session/{session}', method='DELETE')
            except Exception: pass
        driver.terminate(); driver.wait(timeout=10); server.shutdown(); server.server_close()

if __name__ == '__main__': main()
