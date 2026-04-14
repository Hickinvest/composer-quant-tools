/**
 * TabTitleUpdater
 * Updates the browser tab title to show the daily percent change when on the portfolio page.
 */
(function() {
  if (!window.interceptorCore) return;

  let isEnabled = true;

  function registerHook() {
    window.interceptorCore.registerResponseHook(async ({ url, response, xhr }) => {
      if (!url.includes('/total-stats')) return;
      if (window.location.pathname !== "/portfolio") return;
      if (!isEnabled) return;

      try {
        const data = response ? await response.json() : JSON.parse(xhr?.responseText);
        const change = data?.todays_percent_change;
        if (change === undefined) return;

        const formatted = (change >= 0 ? '+' : '') + (change * 100).toFixed(2) + '%';
        document.title = `${formatted} • Composer`;
      } catch (e) {
        // ignore parse errors
      }
    });
  }

  registerHook();

  window.addEventListener('message', function(event) {
    if (event.data.type === 'SETTINGS_UPDATED' && event.data.settings?.enableTabTitleUpdate !== undefined) {
      isEnabled = event.data.settings.enableTabTitleUpdate;
    }
  });
})();