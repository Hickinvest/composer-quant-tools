const columnOptions = [
  "MTD",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "Win Days",
  "Best Day",
  "Worst Day",
  "Best Month",
  "Start Period",
  "End Period",
  "Risk-Free Rate",
  "Time in Market",
  "Cumulative Return",
  "CAGR﹪",
  "Sharpe",
  "Prob. Sharpe Ratio",
  "Smart Sharpe",
  "Sortino",
  "Smart Sortino",
  "Sortino/√2",
  "Smart Sortino/√2",
  "Omega",
  "Max Drawdown",
  "Longest DD Days",
  "Volatility (ann.)",
  "Calmar",
  "Skew",
  "Kurtosis",
  "Expected Daily",
  "Expected Monthly",
  "Expected Yearly",
  "Kelly Criterion",
  "Risk of Ruin",
  "Daily Value-at-Risk",
  "Expected Shortfall (cVaR)",
  "Max Consecutive Wins",
  "Max Consecutive Losses",
  "Gain/Pain Ratio",
  "Gain/Pain (1M)",
  "Payoff Ratio",
  "Profit Factor",
  "Common Sense Ratio",
  "CPC Index",
  "Tail Ratio",
  "Outlier Win Ratio",
  "Outlier Loss Ratio",
  "3Y (ann.)",
  "5Y (ann.)",
  "10Y (ann.)",
  "All-time (ann.)",
  "Worst Month",
  "Best Year",
  "Worst Year",
  "Avg. Drawdown",
  "Avg. Drawdown Days",
  "Recovery Factor",
  "Ulcer Index",
  "Serenity Index",
  "Avg. Up Month",
  "Avg. Down Month",
  "Win Month",
  "Win Quarter",
  "Win Year",
  "Running Days",
  "Avg. Daily Return",
  "Median Daily Return",
];

// Default settings
const defaultSettings = {
  addedColumns: [
    "Running Days",
    "Avg. Daily Return",
    "MTD",
    "3M",
    "6M",
    "YTD",
    "1Y",
    "Win Days",
    "Best Day",
    "Worst Day",
  ],
  userDefinedUploadUrl: null,
  enableTooltips: true,
  enableCmdClick: true,
};

let currentSettings = { ...defaultSettings }; // Initialize with defaults

// --- New Settings Management ---

async function loadSettings(keys = null) {
  const keysToLoad = keys || Object.keys(defaultSettings);
  const result = await chrome.storage.local.get(keysToLoad);

  // Merge loaded settings with defaults, ensuring all keys exist
  const loadedSettings = {};
  for (const key of keysToLoad) {
    loadedSettings[key] = result.hasOwnProperty(key) ? result[key] : defaultSettings[key];
  }

  // Update currentSettings state
  Object.assign(currentSettings, loadedSettings);
  return loadedSettings;
}

async function saveSettings(settingsToSave) {
  await chrome.storage.local.set(settingsToSave);
  // Update currentSettings state
  Object.assign(currentSettings, settingsToSave);
  broadcastSettings(settingsToSave);
}

function broadcastSettings(changedSettings) {
  // Keep the existing runtime message for internal extension communication
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: changedSettings }, (response) => {
    if (chrome.runtime.lastError) {
      // Handle potential errors, e.g., no receiving end
      console.log("Broadcast error:", chrome.runtime.lastError.message);
    }
  });
  
  // Use postMessage to communicate with content scripts
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs && tabs[0]) {
      // Execute a script in the page that will use postMessage
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (settingsData) => {
          window.postMessage({
            source: 'composer-quant-tools-extension',
            type: 'SETTINGS_UPDATED',
            settings: settingsData
          }, '*');
        },
        args: [changedSettings]
      }).catch(err => console.error("Error posting message:", err));
    }
  });
}


// -------------------


let selectizeInstance = null; // Keep track of the selectize instance

async function initHeadersChoices() {
  // Settings are now loaded globally at startup
  const initialColumns = currentSettings.addedColumns || defaultSettings.addedColumns;

  $(document).ready(function () {
    selectizeInstance = $(".headers-select-box").selectize({
      plugins: ["remove_button", "drag_drop"],
      persist: false,
      valueField: "value",
      labelField: "value",
      searchField: ["value"],
      create: false,
      onChange: function (value) {
        // Use saveSettings to save the updated array
        saveSettings({ addedColumns: value || [] });
      },
    })[0].selectize;

    // Add options using Selectize API
    columnOptions.forEach(function (option) {
      selectizeInstance.addOption({ value: option });
    });

    // Set selected options using Selectize API from currentSettings
    selectizeInstance.setValue(initialColumns);
  });
}

async function initUserDefinedUploadUrl() {
  // Settings are now loaded globally at startup
  const initialUrl = currentSettings.userDefinedUploadUrl || defaultSettings.userDefinedUploadUrl || '';
  const userDefinedUploadUrlInput = document.getElementById('userDefinedUploadUrl');
  userDefinedUploadUrlInput.value = initialUrl;

  userDefinedUploadUrlInput.addEventListener('change', (e) => {
    const trimmedUrl = e.target.value.trim();
    // Use saveSettings
    saveSettings({ userDefinedUploadUrl: trimmedUrl || null });
  });
}

async function initEnableTooltips() {
  const enableTooltipsCheckbox = document.getElementById('enableTooltips');
  enableTooltipsCheckbox.checked = currentSettings.enableTooltips || false;
  
  enableTooltipsCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableTooltips: e.target.checked });
  });
}

async function initEnableCmdClick() {
  const enableCmdClickCheckbox = document.getElementById('enableCmdClick');
  enableCmdClickCheckbox.checked = currentSettings.enableCmdClick || false;
  
  enableCmdClickCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableCmdClick: e.target.checked });
  });
}

function positionTooltips() {
  const tooltips = document.querySelectorAll('.tooltip-container');
  tooltips.forEach(tooltip => {
    const icon = tooltip.querySelector('.tooltip-icon');
    const text = tooltip.querySelector('.tooltip-text');
    const rect = icon.getBoundingClientRect();
    const spaceTop = rect.top;
    const spaceBottom = window.innerHeight - rect.bottom;
    const spaceLeft = rect.left;
    const spaceRight = window.innerWidth - rect.right;

    tooltip.classList.remove('tooltip-top', 'tooltip-bottom', 'tooltip-left', 'tooltip-right');

    if (spaceTop > spaceBottom && spaceTop > spaceLeft && spaceTop > spaceRight) {
      tooltip.classList.add('tooltip-top');
    } else if (spaceBottom > spaceLeft && spaceBottom > spaceRight) {
      tooltip.classList.add('tooltip-bottom');
    } else if (spaceLeft > spaceRight) {
      tooltip.classList.add('tooltip-left');
    } else {
      tooltip.classList.add('tooltip-right');
    }
  });
}

function initEventListeners() {
  window.addEventListener('load', positionTooltips);
  window.addEventListener('resize', positionTooltips);
}

// --- Initialization ---

async function initializePopup() {
  await loadSettings(); // Load all settings initially
  broadcastSettings(currentSettings);
  await initHeadersChoices();
  await initUserDefinedUploadUrl();
  await initEnableTooltips();
  await initEnableCmdClick();
  positionTooltips(); // Initial positioning
  initEventListeners();
}

initializePopup(); // Start the initialization process
