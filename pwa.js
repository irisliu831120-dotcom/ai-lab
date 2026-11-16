'use strict';
(() => {
  const button = document.getElementById('installApp');
  const help = document.getElementById('installHelp');
  const close = document.getElementById('installHelpClose');
  const offline = document.getElementById('offlineNotice');
  let installPrompt;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const installed = () => standalone.matches || window.navigator.standalone === true;
  const updateButton = () => { button.hidden = installed(); };
  const updateNetwork = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; updateButton();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; button.hidden = true; help.close(); });
  button.addEventListener('click', async () => {
    if (!installPrompt) { help.showModal(); return; }
    const prompt = installPrompt; installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; } catch { help.showModal(); }
  });
  close.addEventListener('click', () => help.close());
  if (standalone.addEventListener) standalone.addEventListener('change', updateButton);
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  updateButton(); updateNetwork();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'})
        .then(registration => registration.update().catch(() => {}))
        .catch(error => console.warn('PWA service worker registration failed:', error));
    });
  }
})();
