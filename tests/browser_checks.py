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
                const places=[[-3.5339,50.7184,'E48000008'],[-.1278,51.5074,'E48000021'],[-3.1791,51.4816,'W41000004'],[-2.2426,53.4808,'E48000013']];
                for(const [lon,lat,code] of places){const found=geo.findForumFeatures(db.boundaries,lon,lat);if(found.length!==1||found[0].properties.code!==code)throw Error('Wrong boundary for '+[lon,lat]);}
                const donut={geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,3],[1,3],[1,1]]]}};
                if(!geo.containsPoint(donut,[.5,.5])||geo.containsPoint(donut,[2,2])||geo.containsPoint(donut,[5,5]))throw Error('Polygon holes');
                done({counts:[db.forums.length,db.risks.length,db.nationalRisks.length,db.matches.length]});
              }).catch(e=>done({error:e.message}));
            """)
            assert result == {'counts':[42,631,95,631]}, result
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
                const related=db.risks.find(r=>db.definitions.related[r.id]);
                if(defs.resolveRiskDefinition(related,db).kind!=='related')throw Error('Related context label');
                const missing=db.risks.find(r=>r.id==='E48000009-011');
                if(defs.resolveRiskDefinition(missing,db).kind!=='unavailable')throw Error('Missing definitions must be explicit');
                done({national:Object.keys(db.definitions.national).length,local:Object.keys(db.definitions.local).length});
              }).catch(error=>done({error:error.message}));
            """)
            assert result=={'national':95,'local':9},result
            print('PASS: local definition precedence, national fallback, related context, missing definitions and safe HTML')
            visit('registers/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            assert execute("return document.querySelectorAll('.region').length===42 && document.querySelectorAll('.national-risk-item').length===95")
            execute("document.getElementById('region').value='E48000032';document.getElementById('region').dispatchEvent(new Event('change'))")
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===18")
            execute("document.querySelector('#riskRows tr').click()")
            assert execute("return !!document.querySelector('.expanded-risk')")
            execute("document.getElementById('riskSearch').value='no-such-risk';document.getElementById('riskSearch').dispatchEvent(new Event('input'))")
            assert execute("return document.getElementById('riskRows').textContent.includes('No matching risks')")
            visit('registers/?area=E48000031')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===47")
            visit('registers/?area=E48000009')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===42")
            execute("document.getElementById('plotTab').click()")
            assert execute("return !document.getElementById('plotView').hidden && document.querySelectorAll('.plot-marker').length>0")
            execute("document.querySelector('.plot-marker').dispatchEvent(new MouseEvent('click'))")
            assert execute("return document.querySelectorAll('.cluster-item').length>0")
            execute("document.querySelector('.national-risk-item').click()")
            assert execute("return !document.getElementById('nationalSelected').hidden")
            execute("document.getElementById('clearNational').click()")
            visit('registers/?area=E48000001')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===9")
            execute("document.querySelector('#riskRows tr').click()")
            assert execute("return document.querySelector('.expanded-risk [data-definition-kind=local]') && document.querySelector('.expanded-risk .rating-source > summary').textContent==='Rating and source details'")
            assert execute("return !document.querySelector('.expanded-risk .rating-source').open && document.querySelector('.expanded-risk').textContent.includes('Risk definition')")
            execute("document.querySelector('.expanded-risk').scrollIntoView({block:'center'})")
            screenshot('definition-dashboard')
            print('PASS: dashboard records, search, expansion, plot, national filter, area links and definition-first details')
            visit('bypostcode/')
            if '--live' in sys.argv:
                execute("document.getElementById('postcode').value='EX2 4QD';document.getElementById('form').requestSubmit()")
                wait("!document.getElementById('submit').disabled")
                assert execute("return !document.getElementById('results').hidden && document.getElementById('forumName').textContent.includes('Devon')"), execute("return document.getElementById('error').textContent")
                assert execute("return !!window.L && !!document.querySelector('.leaflet-container .leaflet-overlay-pane path')"), 'Live Leaflet map did not initialise'
                assert execute("return getComputedStyle(document.querySelector('.leaflet-pane')).position==='absolute'"), 'Leaflet CSS did not load'
                wait("[...document.querySelectorAll('.leaflet-tile')].some(image=>image.naturalWidth>0)")
                screenshot('postcode-live-desktop')
                print('PASS: live Postcodes.io lookup, Leaflet stylesheet and OpenStreetMap tiles')
                visit('bypostcode/')
            execute("""
              window.L=undefined; // Explicitly exercise the fallback independently of the CDN.
              window.originalFetch=window.fetch;
              window.mockLocation={postcode:'EX2 4QD',longitude:-3.5339,latitude:50.7184,country:'England',admin_district:'Exeter'};
              window.mockMode='ok';
              window.fetch=async (url,options)=>{
                if(String(url).includes('api.postcodes.io')){
                  if(window.mockMode==='missing')return new Response('{}',{status:404});
                  return new Response(JSON.stringify({status:200,result:window.mockLocation}),{status:200});
                }
                return window.originalFetch(url,options);
              };
              document.getElementById('postcode').value='EX2 4QD';
              document.getElementById('form').requestSubmit();
            """)
            wait("!document.getElementById('results').hidden && !document.getElementById('submit').disabled")
            assert execute("return document.querySelectorAll('#riskRows > tr').length===16 && document.getElementById('forumName').textContent.includes('Devon') && !!document.querySelector('#map svg.fallback-map')")
            assert execute("return document.getElementById('forumWebsite').href==='https://www.dcisprepared.org.uk/' && document.getElementById('forumWebsite').textContent.includes('website')")
            assert execute("return document.getElementById('coverage').textContent.includes('partial') && document.getElementById('source').querySelector('a') && document.getElementById('explorerLink').href.includes('area=E48000008')")
            execute("document.querySelector('.source-details').open=true")
            assert execute("return document.querySelector('.source-details').textContent.includes('Source:')")
            execute("document.getElementById('riskSearch').value='no-such-risk';document.getElementById('riskSearch').dispatchEvent(new Event('input'))")
            assert execute("return !document.getElementById('empty').hidden")
            execute("window.mockLocation={postcode:'CF10 1AA',longitude:-3.1791,latitude:51.4816,country:'Wales',admin_district:'Cardiff'};document.getElementById('postcode').value='CF10 1AA';document.getElementById('form').requestSubmit()")
            wait("!document.getElementById('submit').disabled")
            assert execute("return document.getElementById('forumName').textContent==='CF10 1AA is in the South Wales resilience forum area' && document.querySelectorAll('#riskRows > tr').length===9 && document.getElementById('riskSearch').value===''")
            assert execute("return document.querySelector('#riskRows').textContent.includes('5') && document.getElementById('forumWebsite').href==='https://www.southwaleslrf.co.uk/'")
            execute("window.mockMode='missing';document.getElementById('form').requestSubmit()")
            wait("!document.getElementById('submit').disabled")
            assert execute("return document.getElementById('results').hidden && !document.getElementById('error').hidden && document.getElementById('error').textContent.includes('not found')")
            execute("window.mockMode='ok';window.mockLocation.country='Scotland';document.getElementById('form').requestSubmit()")
            wait("!document.getElementById('submit').disabled")
            assert execute("return document.getElementById('results').hidden && document.getElementById('error').textContent.includes('England and Wales')")
            execute("window.mockLocation={postcode:'BS1 5TR',longitude:-2.5879,latitude:51.4545,country:'England',admin_district:'Bristol'};document.getElementById('postcode').value='BS1 5TR';document.getElementById('form').requestSubmit()")
            wait("!document.getElementById('submit').disabled")
            execute("document.querySelector('.source-details').open=true")
            assert execute("return document.querySelector('.source-details > summary').textContent==='Risk definition' && document.querySelector('.source-details [data-definition-kind=local]') && document.querySelector('.source-details .rating-source > summary').textContent==='Rating and source details'")
            execute("document.querySelector('.source-details').scrollIntoView({block:'center'})")
            screenshot('definition-postcode')
            print('PASS: postcode lookup, local map, area switching, local definitions, source details and failure states')
            visit('bypostcode/?postcode=EX2%204QD')
            assert execute("return document.getElementById('postcode').value==='EX2 4QD' && document.getElementById('results').hidden")
            request(f'/session/{session}/window/rect', {'width':390,'height':844})
            assert execute("return document.documentElement.scrollWidth <= window.innerWidth"), 'Postcode page overflows mobile width'
            visit('')
            assert execute("return document.documentElement.scrollWidth <= window.innerWidth"), 'Home page overflows mobile width'
            visit('registers/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            assert execute("return document.documentElement.scrollWidth <= window.innerWidth"), 'Dashboard overflows mobile width'
            screenshot('registers-mobile')
            visit('')
            screenshot('home-mobile')
            print('PASS: explicit submission of shared postcodes and mobile layout widths')
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
            wait("window.analyticsRequests.length===1")
            first_hit=execute("return window.analyticsRequests[0]")
            from urllib.parse import parse_qs, urlsplit, unquote
            first_params=parse_qs(urlsplit(first_hit['url']).query)
            assert first_params['p']==['/bypostcode/'] and first_params['t']==['Postcode finder']
            assert 'q' not in first_params
            assert first_hit['options']['credentials']=='omit' and first_hit['options']['referrerPolicy']=='no-referrer'
            execute("""
              const beforeMock=window.fetch;
              window.fetch=(url,options)=>String(url).includes('api.postcodes.io')
                ? Promise.resolve(new Response(JSON.stringify({status:200,result:{postcode:'EX2 9AW',longitude:-3.5339,latitude:50.7184,country:'England',admin_district:'Exeter'}})))
                : beforeMock(url,options);
              document.getElementById('form').requestSubmit();
            """)
            wait("!document.getElementById('results').hidden && !document.getElementById('submit').disabled")
            execute("document.getElementById('riskSearch').value='PRIVATESEARCHMARKER';document.getElementById('riskSearch').dispatchEvent(new Event('input'))")
            execute("document.getElementById('riskSearch').value='';document.getElementById('riskSearch').dispatchEvent(new Event('input'));document.querySelector('.source-details').open=true")
            wait("window.analyticsRequests.some(hit=>new URL(hit.url).searchParams.get('p').startsWith('risk-opened/'))")
            execute("document.addEventListener('click',event=>event.preventDefault(),{once:true});document.getElementById('forumWebsite').click()")
            hits=execute("return window.analyticsRequests")
            paths=[parse_qs(urlsplit(hit['url']).query)['p'][0] for hit in hits]
            assert 'postcode-started/bypostcode' in paths and 'postcode-succeeded/bypostcode/E48000008' in paths
            assert 'forum-website/bypostcode/E48000008' in paths
            assert sum(not parse_qs(urlsplit(hit['url']).query).get('e') for hit in hits)==1, 'Lookup must not add duplicate pageviews'
            for hit in hits:
                decoded=unquote(hit['url'])
                assert all(private not in decoded for private in ['EX2 9AW','PRIVATECAMPAIGN','PRIVATESEARCHMARKER','private-fragment'])
                assert 'q' not in parse_qs(urlsplit(hit['url']).query)
            visit('registers/?postcode=EX2%209AW')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            execute("document.getElementById('region').value='E48000032';document.getElementById('region').dispatchEvent(new Event('change'));document.querySelector('#riskRows tr').click();document.querySelector('.national-risk-item').click();document.getElementById('plotTab').click()")
            dashboard_hits=execute("return window.analyticsRequests")
            dashboard_paths=[parse_qs(urlsplit(hit['url']).query)['p'][0] for hit in dashboard_hits]
            assert 'area-selected/registers/E48000032' in dashboard_paths
            assert any(path.startswith('risk-opened/registers/E48000032-') for path in dashboard_paths)
            assert any(path.startswith('national-selected/registers/NRR26-') for path in dashboard_paths)
            assert 'view-changed/registers/plot' in dashboard_paths
            assert all('EX2 9AW' not in unquote(hit['url']) for hit in dashboard_hits)
            print('PASS: analytics pageviews and actions exclude postcodes, queries, search text and fragments')
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
            visit('registers/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            assert execute("return document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':broken['identifier']}})
            print('PASS: blocked analytics requests do not stop the risk dashboard')
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.enable','params':{}})
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setCacheDisabled','params':{'cacheDisabled':True}})
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setBlockedURLs','params':{'urls':['*/assets/analytics.js']}})
            visit('registers/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            assert execute("return window.analyticsRequests.length===0 && document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Network.setBlockedURLs','params':{'urls':[]}})
            print('PASS: a blocked analytics script does not stop the risk dashboard')
            optional_failure=request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"window.fetch=((original)=>(url,options)=>String(url).includes('risk-definitions.json')?Promise.resolve(new Response('',{status:503})):original(url,options))(window.fetch);"}})
            visit('registers/')
            wait("document.querySelectorAll('#riskRows tr[role=button]').length===16")
            execute("document.querySelector('#riskRows tr').click()")
            assert execute("return document.querySelector('.expanded-risk').textContent.includes('Definition information could not be loaded') && document.getElementById('loadError').hidden")
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.removeScriptToEvaluateOnNewDocument','params':{'identifier':optional_failure['identifier']}})
            print('PASS: unavailable definitions do not stop existing risk records or ratings')
            request(f'/session/{session}/goog/cdp/execute', {'cmd':'Page.addScriptToEvaluateOnNewDocument','params':{'source':"const originalFetch=window.fetch;window.fetch=(url, options)=>String(url).includes('forums.json')?Promise.resolve(new Response('',{status:503})):originalFetch(url,options);"}})
            visit('registers/')
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
