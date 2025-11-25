// Keep-alive alarm management for Service Worker

function setupKeepAlive(enabled) {
  if (enabled) {
    chrome.alarms.create('keep-alive', { periodInMinutes: 0.4 });
  } else {
    chrome.alarms.clear('keep-alive');
  }
}

export async function initKeepAlive() {
  // Setup keep-alive alarm based on setting
  const { enableKeepAlive } = await chrome.storage.local.get('enableKeepAlive');
  setupKeepAlive(enableKeepAlive ?? true);

  // Listen for alarm (does nothing, just keeps worker alive)
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keep-alive') {
      // Just waking up is enough
    }
  });

  // Listen for setting changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enableKeepAlive) {
      setupKeepAlive(changes.enableKeepAlive.newValue);
    }
  });
}

