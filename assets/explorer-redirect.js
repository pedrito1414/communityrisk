// GitHub Pages has no server-side redirect rules. Keep old entry points useful
// with a same-origin replacement, preserving only supported explorer inputs.
const target = new URL(document.body.dataset.explorerTarget, location.href);
const old = new URLSearchParams(location.search);
for (const name of ['view','risk','area','postcode']) {
  if (old.has(name)) target.searchParams.set(name,old.get(name));
}
if (document.body.dataset.postcodeEntry === 'true') {
  target.searchParams.set('view','area');
  target.hash='postcode';
}
document.getElementById('continueExplorer').href=target.href;
location.replace(target.href);
