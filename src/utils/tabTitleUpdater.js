/**
 * TabTitleUpdater
 * Updates the browser tab title to show the daily percent change when on the portfolio page.
 */
(function() {
  let isEnabled = true;
  let hookRegistered = false;

  function updateTitle(change) {
    const formatted = (change >= 0 ? '+' : '') + (change * 100).toFixed(2) + '%';
    document.title = `${formatted} • Composer`;
  }

  function registerHook() {
    if (hookRegistered || !window.interceptorCore) return;
    hookRegistered = true;

    window.interceptorCore.registerResponseHook(async ({ url, response, xhr }) => {
      if (!url.includes('/total-stats')) return;
      if (window.location.pathname !== "/portfolio") return;
      if (!isEnabled) return;

      try {
        const data = response ? await response.json() : JSON.parse(xhr?.responseText);
        const change = data?.todays_percent_change;
        if (change === undefined) return;

        updateTitle(change);
      } catch (e) {
        // ignore parse errors
      }
    });
  }

  async function loadSettings() {
    if (window.storageAccess) {
      const settings = await window.storageAccess.get(['enableTabTitleUpdate']);
      if (settings && settings.hasOwnProperty('enableTabTitleUpdate')) {
        isEnabled = settings.enableTabTitleUpdate;
      }
    }
  }

  window.addEventListener('message', function(event) {
    if (event.data.type === 'SETTINGS_UPDATED') {
      if (event.data.settings?.enableTabTitleUpdate !== undefined) {
        isEnabled = event.data.settings.enableTabTitleUpdate;
      }
    } else if (event.data.type === 'INIT_READY') {
      loadSettings().then(registerHook);
    }
  });

  registerHook();
})();