const button = document.getElementById('analyticsPreference');
const status = document.getElementById('analyticsStatus');
function render() {
  try {
    const disabled = localStorage.getItem('skipgc') === 't';
    const browserOptOut = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
    button.textContent = disabled ? 'Allow visit statistics in this browser' : 'Do not count my visits';
    status.textContent = disabled ? 'Your visits are excluded in this browser.' : browserOptOut ? 'Your browser privacy signal excludes your visits.' : 'Visit statistics are enabled in this browser.';
    button.disabled = false;
  } catch {
    status.textContent = 'Your browser blocks preference storage. Visit statistics are disabled.';
    button.disabled = true;
  }
}
button.addEventListener('click', () => {
  try {
    if (localStorage.getItem('skipgc') === 't') localStorage.removeItem('skipgc');
    else localStorage.setItem('skipgc', 't');
  } catch {}
  render();
});
render();
