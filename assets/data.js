const base = new URL('../data/', import.meta.url);
let pending;
async function loadAsset(name, optional = false) {
  try {
    const response = await fetch(new URL(name, base));
    if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
    return await response.json();
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}
export function loadData() {
  if (!pending) pending = Promise.all(['forums.json', 'local-risks.json', 'national-risks.json', 'risk-matches.json', 'boundaries.geojson', 'risk-definitions.json'].map(name => loadAsset(name, name === 'risk-definitions.json')))
    .then(([forums, risks, nationalRisks, matches, boundaries, definitions]) => {
      if (!forums.length || !risks.length || !boundaries.features?.length) throw new Error('The shared dataset is empty or incomplete.');
      return {forums, risks, nationalRisks, matches, boundaries, definitions};
    }).catch(error => { pending = undefined; throw error; });
  return pending;
}
