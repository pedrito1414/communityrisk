import { esc } from './shared.js';

function nationalSource(id, data) {
  const definition = data.definitions?.national?.[id];
  const risk = data.nationalRisks.find(record => record.national_id === id);
  const source = definition && data.definitions.sources[definition.source_id];
  return definition && source ? {...source, pdf_page:definition.pdf_page, risk_name:risk?.national_risk || id} : null;
}
export function resolveRiskDefinition(risk, data) {
  const definitions = data.definitions;
  const local = definitions?.local?.[risk.id];
  if (local?.text && definitions.sources[local.source_id]) {
    return {kind:'local', label:'Local definition', text:local.text, sources:[{...definitions.sources[local.source_id],pdf_page:local.pdf_page}], note:'Plain-English summary of the local register.'};
  }
  const match = data.matches.find(record => record.local_id === risk.id);
  if (match?.match_status === 'Direct') {
    const definition = definitions?.national?.[match.national_id];
    const source = nationalSource(match.national_id, data);
    if (definition?.text && source) return {kind:'national',label:'National definition',text:definition.text,sources:[source],note:'National Risk Register summary; local wording has not yet been transcribed. The local–national match is provisional.'};
  }
  const related = definitions?.related?.[risk.id];
  if (related) {
    const topic = related.topic_id && definitions.topics[related.topic_id];
    const ids = topic ? topic.national_ids : related.national_ids;
    const sources = ids?.map(id => nationalSource(id, data)).filter(Boolean) || [];
    const text = topic ? topic.text : definitions.national[ids?.[0]]?.text;
    if (text && sources.length) return {kind:'related',label:'National background',text,sources,note:'Related national context, not a definition published by this LRF or confirmation of an exact scenario match.'};
  }
  return {kind:'unavailable',label:'Definition not yet available',text:definitions ? 'A source-checked definition has not yet been recorded for this entry. The local register may contain further detail.' : 'Definition information could not be loaded. You can still read the risk ratings and follow the original source.',sources:[],note:''};
}
export function riskDefinitionHTML(risk, data, showHeading = true) {
  const definition = resolveRiskDefinition(risk, data);
  const heading = showHeading ? '<h4>Risk definition</h4>' : '';
  let sources = '';
  if (definition.sources.length === 1) {
    const source = definition.sources[0];
    sources = `<p class="definition-source"><a href="${esc(source.url)}#page=${source.pdf_page}" target="_blank" rel="noopener noreferrer">${esc(source.title)} · PDF page ${source.pdf_page} ↗</a></p>`;
  } else if (definition.sources.length) {
    sources = `<details class="definition-sources"><summary>National source scenarios (${definition.sources.length})</summary><ul>${definition.sources.map(source=>`<li><a href="${esc(source.url)}#page=${source.pdf_page}" target="_blank" rel="noopener noreferrer">${esc(source.risk_name)} · PDF page ${source.pdf_page} ↗</a></li>`).join('')}</ul></details>`;
  } else {
    const forum = data.forums.find(record => record.code === risk.forum_code);
    if (forum?.source_url) sources = `<p class="definition-source"><a href="${esc(forum.source_url)}" target="_blank" rel="noopener noreferrer">Read the local register / risk information ↗</a></p>`;
  }
  return `<section class="risk-definition" data-definition-kind="${definition.kind}">${heading}<p>${esc(definition.text)}</p><p class="definition-origin"><strong>${esc(definition.label)}</strong>${definition.note ? ' · '+esc(definition.note) : ''}</p>${sources}</section>`;
}
