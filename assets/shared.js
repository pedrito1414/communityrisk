import { ratingRank, calculatedPriority, commonRanking } from './ranking.js';
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}
export function showLoadError(error) {
  const element = document.getElementById('loadError');
  if (element) {
    element.hidden = false;
    element.textContent = 'The risk data could not be loaded. Please reload the page or try again later. ' + error.message;
  }
}
export function rankDescription(risk) {
  const rank = commonRanking(risk);
  if (ratingRank(risk.rating) !== null) return `Published rating: ${risk.rating}. Mapped to navigation rank ${rank}/5 (Very Low 1, Low 2, Medium 3, High 4, Very High 5).`;
  const product = calculatedPriority(risk);
  if (product !== null) return `Published likelihood ${risk.likelihood}/5 × impact ${risk.impact}/5 = ${product}. Products 1–5, 6–10, 11–15, 16–20 and 21–25 map to navigation ranks 1–5. This gives rank ${rank}/5; it is not an official combined rating.`;
  if (Number.isFinite(risk.visualRating)) return `Approximate graphical position ${risk.visualRating}, rounded to navigation rank ${rank}/5. This is an interpretation of the source graphic, not a precise published table score.`;
  return 'Unranked: no usable individual rating has been transcribed. The original source may contain further detail.';
}

// The tools emit optional analytics signals without depending on the tracker loading.
export function trackEvent(name, code = '') {
  document.dispatchEvent(new CustomEvent('communityrisk:interaction', {detail:{name, code}}));
}
