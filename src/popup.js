const columnOptions = [
  "10Y (ann.)",
  "1Y",
  "3M",
  "3Y (ann.)",
  "5Y (ann.)",
  "6M",
  "All-time (ann.)",
  // Alpha/Beta columns (CAPM metrics)
  "Alpha vs SPY",
  "Alpha vs QQQ",
  "Avg. Daily Return",
  "Avg. Down Month",
  "Avg. Drawdown Days",
  "Avg. Drawdown",
  "Avg. Up Month",
  "Best Day",
  "Best Month",
  "Best Year",
  "Beta vs SPY",
  "Beta vs QQQ",
  "CAGR% (Annual Return)",
  "Calmar",
  "Daily Value-at-Risk",
  "End Period",
  "Expected Daily%",
  "Expected Monthly%",
  "Expected Shortfall (cVaR)",
  "Expected Yearly%",
  "Kurtosis",
  "Longest DD Days",
  "Loss Days",
  "Max Drawdown",
  "Median Daily Return",
  "MTD",
  "Omega",
  "Prob. Sharpe Ratio",
  "R² vs SPY",
  "R² vs QQQ",
  "Recovery Factor",
  "Risk-Free Rate",
  "RoMaD",
  "Running Days",
  "Serenity Index",
  "Sharpe",
  "Skew",
  "Smart Sharpe",
  "Smart Sortino",
  "Smart Sortino/√2",
  "Sortino",
  "Sortino/√2",
  "Start Period",
  "Time in Market",
  "Total Return",
  "Ulcer Index",
  "Volatility (ann.)",
  "Win Days",
  "Win Days%",
  "Win Month%",
  "Win Quarter%",
  "Win Year%",
  "Worst Day",
  "Worst Month",
  "Worst Year",
  "YTD",
  // these are not returned from quantstats
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
  enableYtdReturns: true,
  enableKeepAlive: true,
  enableColumnSorting: true,
  enableBenchmarkCalculations: true,
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
  
  // If we want to broadcast to content scripts, it requires manifest.json 
  // to have "scripting" permission
  //
  // // Use postMessage to communicate with content scripts
  // chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
  //   if (tabs && tabs[0]) {
  //     // Execute a script in the page that will use postMessage
  //     chrome.scripting.executeScript({
  //       target: { tabId: tabs[0].id },
  //       func: (settingsData) => {
  //         window.postMessage({
  //           source: 'composer-quant-tools-extension',
  //           type: 'SETTINGS_UPDATED',
  //           settings: settingsData
  //         }, '*');
  //       },
  //       args: [changedSettings]
  //     }).catch(err => console.error("Error posting message:", err));
  //   }
  // });
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
  const enableCmdClickCheckbox = document.getElementById('enableCmdClick');
  // Attempt to find the label associated with the CmdClick checkbox
  const enableCmdClickLabel = document.querySelector('label[for="enableCmdClick"]');

  // Set initial checked state from settings
  enableTooltipsCheckbox.checked = currentSettings.enableTooltips ?? false;

  // Function to update CmdClick state (checkbox and label)
  const updateCmdClickState = (isTooltipEnabled) => {
    enableCmdClickCheckbox.disabled = !isTooltipEnabled;
    if (enableCmdClickLabel) {
      if (isTooltipEnabled) {
        enableCmdClickLabel.classList.remove('disabled-label');
      } else {
        enableCmdClickLabel.classList.add('disabled-label');
      }
    }
  };

  // Set initial state for CmdClick checkbox and label
  updateCmdClickState(enableTooltipsCheckbox.checked);

  enableTooltipsCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    saveSettings({ enableTooltips: isChecked });
    // Update the state of CmdClick checkbox and label
    updateCmdClickState(isChecked);
  });
}

async function initEnableCmdClick() {
  const enableCmdClickCheckbox = document.getElementById('enableCmdClick');
  enableCmdClickCheckbox.checked = currentSettings.enableCmdClick || false;
  
  enableCmdClickCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableCmdClick: e.target.checked });
  });
}

async function initEnableYtdReturns() {
  const enableYtdReturnsCheckbox = document.getElementById('enableYtdReturns');
  enableYtdReturnsCheckbox.checked = currentSettings.enableYtdReturns ?? true;
  
  enableYtdReturnsCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableYtdReturns: e.target.checked });
  });
}

async function initEnableKeepAlive() {
  const enableKeepAliveCheckbox = document.getElementById('enableKeepAlive');
  enableKeepAliveCheckbox.checked = currentSettings.enableKeepAlive ?? true;

  enableKeepAliveCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableKeepAlive: e.target.checked });
  });
}

async function initEnableColumnSorting() {
  const enableColumnSortingCheckbox = document.getElementById('enableColumnSorting');
  enableColumnSortingCheckbox.checked = currentSettings.enableColumnSorting ?? true;

  enableColumnSortingCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableColumnSorting: e.target.checked });
  });
}

async function initEnableBenchmarkCalculations() {
  const enableBenchmarkCalculationsCheckbox = document.getElementById('enableBenchmarkCalculations');
  enableBenchmarkCalculationsCheckbox.checked = currentSettings.enableBenchmarkCalculations ?? true;

  enableBenchmarkCalculationsCheckbox.addEventListener('change', (e) => {
    saveSettings({ enableBenchmarkCalculations: e.target.checked });
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
  await initEnableYtdReturns();
  await initEnableKeepAlive();
  await initEnableColumnSorting();
  await initEnableBenchmarkCalculations();
  positionTooltips(); // Initial positioning
  initEventListeners();
}

initializePopup(); // Start the initialization process
