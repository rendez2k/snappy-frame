// Snappy Frame — popup. Two capture modes; the worker does the actual grabbing.
const body = document.body;
function run(type, el) {
  body.classList.add('busy');
  if (el) el.textContent = 'Working…';
  chrome.runtime.sendMessage({ type }, (res) => {
    // Ignore the response — the worker opens the app tab on success.
    // On full-page failure it falls back to the visible area, so either way we close.
    window.close();
  });
}
document.getElementById('visible').addEventListener('click', (e) => run('capture-visible', e.currentTarget));
document.getElementById('full').addEventListener('click', (e) => run('capture-full', e.currentTarget));
