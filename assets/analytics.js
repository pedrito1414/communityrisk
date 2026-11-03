// GoatCounter's documented /count interface lets us omit URL query strings entirely.
// https://www.goatcounter.com/help/pixel
const ENDPOINT = 'https://climateresilient.goatcounter.com/count';
const publicHosts = new Set(['communityrisk.climateresilient.org.uk', 'pedrito1414.github.io']);
const basePath = new URL('../', import.meta.url).pathname;
const localPath = location.pathname.startsWith(basePath) ? location.pathname.slice(basePath.length) : '';
const pages = new Map([
  ['', ['/', 'Community risk home']], ['index.html', ['/', 'Community risk home']],
  ['registers/', ['/registers/', 'Risk register dashboard']], ['registers/index.html', ['/registers/', 'Risk register dashboard']],
  ['bypostcode/', ['/bypostcode/', 'Postcode finder']], ['bypostcode/index.html', ['/bypostcode/', 'Postcode finder']]
]);
const page = pages.get(localPath);
const events = {
  'open-home': ['Open home menu'],
  'open-registers': ['Open risk register dashboard'],
  'open-postcode': ['Open postcode finder'],
  'postcode-started': ['Postcode lookup started'],
  'postcode-succeeded': ['Postcode lookup succeeded', /^[EW]\d{8}$/],
  'postcode-failed': ['Postcode lookup failed'],
  'postcode-invalid': ['Invalid postcode submitted'],
  'area-selected': ['Forum area selected', /^[EW]\d{8}$/],
  'risk-opened': ['Risk details opened', /^[EW]\d{8}-\d{3}$/],
  'national-selected': ['National risk selected', /^NRR\d{2}-\d{3}$/],
  'view-changed': ['Dashboard view changed', /^(list|plot)$/],
  'forum-website': ['Forum website opened', /^[EW]\d{8}$/],
  'register-source': ['Original register source opened', /^[EW]\d{8}$/],
  'download-matches': ['Local–national matches downloaded']
};

export function analyticsDisabled() {
  if (!publicHosts.has(location.hostname) || !page) return true;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return true;
  try { return localStorage.getItem('skipgc') === 't'; }
  catch { return true; } // If browser privacy settings block storage, don't count.
}
function send(path, title, event = false) {
  if (analyticsDisabled() || document.visibilityState === 'prerender') return;
  try {
    // Fixed page titles, allowlisted event IDs, and referrer origin only.
    // Never read location.search, location.hash, input values, or result headings.
    let referrer = '';
    try { referrer = new URL(document.referrer).origin; } catch {}
    const params = new URLSearchParams({p:path, t:title, r:referrer, rnd:Math.random().toString(36).slice(2, 10)});
    if (event) params.set('e', 'true');
    if (Number.isFinite(screen.width)) params.set('s', String(screen.width));
    if (navigator.webdriver) params.set('b', '153');
    // Omit cookies and the HTTP Referer header as well as the campaign/query field q.
    // Analytics failures must never interrupt the visitor's task.
    void fetch(ENDPOINT + '?' + params, {
      method:'GET', mode:'no-cors', credentials:'omit', referrerPolicy:'no-referrer', keepalive:true
    }).catch(() => {});
  } catch {}
}
export function trackEvent(name, code = '') {
  const definition = events[name];
  if (!definition) return;
  if (definition[1] ? !definition[1].test(code) : code !== '') return;
  const label = page?.[0] === '/' ? 'home' : page?.[0].replaceAll('/', '');
  send(`${name}/${label}${code ? '/' + code : ''}`, `${definition[0]}${code ? ' · ' + code : ''}`, true);
}

document.addEventListener('communityrisk:interaction', event => {
  trackEvent(event.detail?.name, event.detail?.code || '');
});

// Delegation also handles links inserted after a postcode lookup or area selection.
function linkClick(event) {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest('a');
  if (!link) return;
  const tagged = link.closest('[data-analytics-event]');
  if (tagged) {
    trackEvent(tagged.dataset.analyticsEvent, tagged.dataset.analyticsCode || '');
    return;
  }
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(basePath)) return;
  const destination = url.pathname.slice(basePath.length);
  if (destination === 'data/risk-matches.csv') trackEvent('download-matches');
  else if (destination === '' || destination === 'index.html') trackEvent('open-home');
  else if (destination === 'registers/' || destination === 'registers/index.html') trackEvent('open-registers');
  else if (destination === 'bypostcode/' || destination === 'bypostcode/index.html') trackEvent('open-postcode');
}
document.addEventListener('click', linkClick);
document.addEventListener('auxclick', linkClick);
document.addEventListener('toggle', event => {
  const details = event.target;
  if (details instanceof HTMLDetailsElement && details.open && details.dataset.analyticsRisk) {
    trackEvent('risk-opened', details.dataset.analyticsRisk);
  }
}, true);
// One view per page load; history updates after postcode searches don't add views.
if (page) send(page[0], page[1]);
