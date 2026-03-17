import { getTokenAndAccount } from "./tokenAndAccountUtil.js";
import { getSymphonyDailyChange, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphonyWithModifiedDietz } from "./liveSymphonyPerformance.js";
import { log } from "./logger.js";

let cachedBacktestData = {};
let lastBacktestDates = {};

function setupBacktestInterceptor() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1] || {};
    
    const response = await originalFetch.apply(this, args);
    
    if (typeof url === 'string' && url.includes('/symphonies/') && url.includes('/backtest')) {
      const clonedResponse = response.clone();
      
      clonedResponse.json().then(data => {
        if (data?.stats) {
          const pathParts = url.split('/');
          const symphonyId = pathParts[pathParts.indexOf('symphonies') + 1];
          
          if (symphonyId) {
            cachedBacktestData[symphonyId] = data;
            log('Intercepted backtest data for symphony:', symphonyId);
            
            const statsTable = getStatsTable();
            if (statsTable) {
              injectExtraColumns();
              populateExtraColumns();
            }
          }
        }
      }).catch(err => {
        log('Error parsing backtest response:', err);
      });
    }
    
    return response;
  };
}

function isLoggedIn() {
  if (window.location.pathname.endsWith("details")) {
    // details page
    return Boolean(
      document
        .querySelector('a[href="/portfolio"]')
        ?.innerText?.includes?.("Go to Composer")
    );
  }
  // anywhere else
  return true;
}

const waitForFactsheet = async () => {
  const observer = new MutationObserver(async function (
    mutations,
    mutationInstance
  ) {
    let factsheetOpen = document.querySelector(".factsheet-open");
    if (isPathOnDetailsPage()) {
      factsheetOpen = document.getElementById("app");
    }
    // const factsheetClosed = document.querySelector('.factsheet-closed')
    const factsheetGraphNode = factsheetOpen?.querySelector?.("section");

    const widgetAttached = Boolean(
      factsheetOpen?.querySelector?.("#tearsheat-widget")
    );

    if (factsheetOpen && factsheetGraphNode && !widgetAttached) {
      isLoggedIn() && (await getTokenAndAccount()); // this is to cache the token and account
      const exists = factsheetOpen?.querySelector?.("#tearsheat-widget");
      if (exists) {
        return;
      }
      renderTearsheetButton(factsheetOpen);
      // mutationInstance.disconnect(); // we should find a sane place to disconnect and reattatch this
    }
  });
  observer.observe(document, { childList: true, subtree: true });
};

function renderTearsheetButton(factsheet) {
  const graphNode = factsheet?.querySelector?.("section");

  const button = (buttonId, buttonText, func, css) => {
    let button = document.createElement("button");
    button.id = buttonId;
    button.className = `rounded flex border border-asset-border shadow-sm bg-panel-bg divide-y divide-solid divide-asset-border text-sm font-light flex items-center justify-center px-2 py-2 shadow-inner transition focus:outline-none leading-none select-none ${css} text-dark bg-white hover:bg-tab-light`;

    let span = document.createElement("span");
    span.className = "flex items-center space-x-2";

    let text = document.createElement("span");
    text.innerText = buttonText;

    button.addEventListener("click", (e) => {
      func(e);
    });

    span.appendChild(text);
    button.appendChild(span);
    return button;
  };

  const extraColumns = [
    "Sortino Ratio",
    "Win Rate",
    "Kurtosis",
    "Skewness",
    "Turnover",
    "Tail Ratio",
    "Median",
    "Max",
    "Min",
    "1W Return",
    "2W Return",
  ];

  const extraColumnKeys = [
    "sortino_ratio",
    "win_rate",
    "kurtosis",
    "skewness",
    "annualized_turnover",
    "tail_ratio",
    "median",
    "max",
    "min",
    "trailing_one_week_return",
    "trailing_two_week_return",
  ];

  function formatPercent(value) {
    if (value === null || value === undefined) return "-";
    return (value * 100).toFixed(1) + "%";
  }

  function formatRatio(value) {
    if (value === null || value === undefined) return "-";
    return value.toFixed(2);
  }

  function getCellFormatter(key) {
    if (["annualized_turnover", "win_rate", "tail_ratio", "median", "max", "min", "trailing_one_week_return", "trailing_two_week_return"].includes(key)) {
      return formatPercent;
    }
    return formatRatio;
  }

  function getStatsTable() {
    const tables = document.querySelectorAll('.border-t.border-b.border-data-table-border table');
    for (const table of tables) {
      const headerText = table.textContent || '';
      if (headerText.includes('Cumulative Return') && headerText.includes('Annualized Return')) {
        return table;
      }
    }
    return null;
  }

  function injectExtraColumns() {
    const statsTable = getStatsTable();
    if (!statsTable) return;

    if (statsTable.classList.contains('composer-quant-tools-initialized')) return;
    statsTable.classList.add('composer-quant-tools-initialized');

    const thead = statsTable.querySelector('thead tr');
    if (!thead) return;

    const lastTh = thead.querySelector('th:last-child');
    if (!lastTh) return;

    extraColumns.forEach((colName, index) => {
      const existingTh = thead.querySelector(`.extra-column[data-key="${colName}"]`);
      if (existingTh) return;

      const th = document.createElement('th');
      th.className = 'p-2 border-r border-data-table-border text-xs font-medium whitespace-nowrap text-left min-w-[120px] extra-column';
      th.dataset.key = colName;
      th.textContent = colName;
      lastTh.parentNode.insertBefore(th, lastTh);
    });
  }

  async function populateExtraColumns() {
    const statsTable = getStatsTable();
    if (!statsTable) return;

    const tbody = statsTable.querySelector('tbody');
    if (!tbody) return;

    const symphonyId = getCurrentSymphonyId();
    if (!symphonyId || !cachedBacktestData[symphonyId]?.stats) return;

    const backtestStats = cachedBacktestData[symphonyId].stats;
    const currentDates = `${backtestStats.first_day}-${backtestStats.last_market_day}`;
    const cachedDates = lastBacktestDates[symphonyId];
    
    if (cachedDates && cachedDates !== currentDates) {
      statsTable.classList.remove('composer-quant-tools-initialized');
      statsTable.querySelectorAll('.extra-column').forEach(el => el.remove());
      lastBacktestDates[symphonyId] = currentDates;
    }
    
    if (!cachedDates) {
      lastBacktestDates[symphonyId] = currentDates;
    }

    if (statsTable.classList.contains('composer-quant-tools-initialized')) {
      updateColumnValues(statsTable, backtestStats);
      return;
    }

    const rows = tbody.querySelectorAll('tr');

    rows.forEach(async (row) => {
      const nameCell = row.querySelector('td:first-child a');
      if (!nameCell) return;

      const symphonyName = nameCell.textContent?.trim();

      let statsData = null;
      let isBenchmark = false;

      if (backtestStats.benchmarks) {
        const benchmarkNames = Object.values(cachedBacktestData[symphonyId]?.legend || {});
        const isBenchmarkRow = Object.keys(backtestStats.benchmarks).some(bmName => 
          symphonyName?.toLowerCase().includes(bmName.toLowerCase())
        );
        
        if (isBenchmarkRow) {
          const benchmarkKey = Object.keys(backtestStats.benchmarks).find(bmName => 
            symphonyName?.toLowerCase().includes(bmName.toLowerCase())
          );
          if (benchmarkKey) {
            statsData = backtestStats.benchmarks[benchmarkKey];
            isBenchmark = true;
          }
        }
      }

      if (!statsData && !isBenchmark) {
        statsData = backtestStats;
      }

      if (!statsData) return;

      extraColumnKeys.forEach((key, index) => {
        const colName = extraColumns[index];
        let cell = row.querySelector(`.extra-column[data-key="${colName}"]`);
        
        if (!cell) {
          const lastTd = row.querySelector('td:last-child');
          if (!lastTd) return;
          
          cell = document.createElement('td');
          cell.className = 'p-2 border-data-table-border border-t border-r border-l extra-column';
          cell.dataset.key = colName;
          lastTd.parentNode.insertBefore(cell, lastTd);
        }

        const formatter = getCellFormatter(key);
        cell.textContent = formatter(statsData[key]);
      });
    });
  }

  function updateColumnValues(statsTable, backtestStats) {
    const tbody = statsTable.querySelector('tbody');
    if (!tbody) return;

    const symphonyId = getCurrentSymphonyId();
    if (!symphonyId) return;

    const rows = tbody.querySelectorAll('tr');

    rows.forEach((row) => {
      const nameCell = row.querySelector('td:first-child a');
      if (!nameCell) return;

      const symphonyName = nameCell.textContent?.trim();

      let statsData = null;

      if (backtestStats.benchmarks) {
        const isBenchmarkRow = Object.keys(backtestStats.benchmarks).some(bmName => 
          symphonyName?.toLowerCase().includes(bmName.toLowerCase())
        );
        
        if (isBenchmarkRow) {
          const benchmarkKey = Object.keys(backtestStats.benchmarks).find(bmName => 
            symphonyName?.toLowerCase().includes(bmName.toLowerCase())
          );
          if (benchmarkKey) {
            statsData = backtestStats.benchmarks[benchmarkKey];
          }
        }
      }

      if (!statsData) {
        statsData = backtestStats;
      }

      if (!statsData) return;

      extraColumnKeys.forEach((key, index) => {
        const colName = extraColumns[index];
        const cell = row.querySelector(`.extra-column[data-key="${colName}"]`);
        if (!cell) return;

        const formatter = getCellFormatter(key);
        cell.textContent = formatter(statsData[key]);
      });
    });
  }

  function getStatsTableDateRange() {
    const statsTable = getStatsTable();
    if (!statsTable) return null;
    
    const dateSpan = statsTable.closest('.col-span-3')?.querySelector('span.text-xs');
    if (!dateSpan) return null;
    
    const text = dateSpan.textContent || '';
    return text;
  }

  let lastSeenDateRange = null;

  const statsTableObserver = new MutationObserver(() => {
    const statsTable = getStatsTable();
    const symphonyId = getCurrentSymphonyId();
    if (!symphonyId) return;

    const currentDateRange = getStatsTableDateRange();
    
    if (currentDateRange && currentDateRange !== lastSeenDateRange) {
      lastSeenDateRange = currentDateRange;
      
      if (statsTable && cachedBacktestData[symphonyId]) {
        const cachedDates = lastBacktestDates[symphonyId];
        const cachedStats = cachedBacktestData[symphonyId]?.stats;
        
        if (cachedStats) {
          const currentDates = `${cachedStats.first_day}-${cachedStats.last_market_day}`;
          if (!cachedDates || cachedDates !== currentDates) {
            statsTable.classList.remove('composer-quant-tools-initialized');
            statsTable.querySelectorAll('.extra-column').forEach(el => el.remove());
            delete cachedBacktestData[symphonyId];
          }
        }
      }
    }
    
    if (statsTable && !statsTable.classList.contains('composer-quant-tools-initialized')) {
      if (cachedBacktestData[symphonyId]?.stats) {
        injectExtraColumns();
        populateExtraColumns();
      } else {
        getSymphonyBacktest(symphonyId).then(() => {
          setTimeout(() => {
            if (cachedBacktestData[symphonyId]?.stats) {
              injectExtraColumns();
              populateExtraColumns();
            }
          }, 2000);
        });
      }
    }
  });

  statsTableObserver.observe(document.body, { childList: true, subtree: true });

  async function fetchBacktestDataForStats() {
    const symphonyId = getCurrentSymphonyId();
    if (!symphonyId || cachedBacktestData[symphonyId]) return;
    
    try {
      await getSymphonyBacktest(symphonyId);
      const statsTable = getStatsTable();
      if (statsTable && cachedBacktestData[symphonyId]?.stats) {
        injectExtraColumns();
        populateExtraColumns();
      }
    } catch (error) {
      log("Error fetching backtest data for stats:", error);
    }
  }

  fetchBacktestDataForStats();

  setTimeout(() => {
    const symphonyId = getCurrentSymphonyId();
    if (symphonyId && cachedBacktestData[symphonyId]?.stats) {
      injectExtraColumns();
      populateExtraColumns();
    }
  }, 2000);

  function getTearsheet(symphony, backtestData, testType) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "getTearsheet", symphony, backtestData, type: testType },
        (response) => {
          if (response?.error) {
            log(response?.error);
            reject(response.error);
          } else {
            // Create a Blob from the HTML content
            const blob = new Blob([response], { type: "text/html" });
            const url = URL.createObjectURL(blob);

            const downloadLinkHTML = `
              <a 
                 href="${url}" 
                 target="_blank" 
                 style="display: block; margin-left: 20px; margin-top: 6px; color: #007bff;">
                Open QuantStats ${testType} Tearsheet Report
              </a>
            `;

            resolve(downloadLinkHTML);
          }
        }
      );
    });
  }

  async function buildTearsheetButtonClickHandler(testType) {
    // disable buttons while toggling
    const buildTearsheetButton = factsheet?.querySelector?.(
      `#tearsheat-widget #build-${testType}-tearsheet-button`
    );

    setButtonEnabled(buildTearsheetButton, false);
    let originalText = buildTearsheetButton?.innerText;
    buildTearsheetButton.querySelector("span").innerHTML = `
          ${originalText.replace("Build ", "Building ")}
          <div style="height: 27px; margin: -7px 10px;"><svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" class="h-full w-full" style="color: rgb(28, 32, 51);"><rect width="512" height="512" x="0" y="0" rx="0" fill="transparent" stroke="transparent" stroke-width="0" stroke-opacity="100%" paint-order="stroke"></rect><svg width="512px" height="512px" viewBox="0 0 24 24" fill="#1C2033" x="0" y="0" role="img" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;"><g fill="#1C2033"><circle cx="4" cy="12" r="3" fill="currentColor"><animate id="svgSpinners3DotsScale0" attributeName="r" begin="0;svgSpinners3DotsScale1.end-0.25s" dur="0.75s" values="3;.2;3"></animate></circle><circle cx="12" cy="12" r="3" fill="currentColor"><animate attributeName="r" begin="svgSpinners3DotsScale0.end-0.6s" dur="0.75s" values="3;.2;3"></animate></circle><circle cx="20" cy="12" r="3" fill="currentColor"><animate id="svgSpinners3DotsScale1" attributeName="r" begin="svgSpinners3DotsScale0.end-0.45s" dur="0.75s" values="3;.2;3"></animate></circle></g></svg></svg></div>
        `;

    factsheet?.querySelector?.(`.tearsheet-${testType}-link`)?.remove();
    let symphonyName =
      factsheet?.querySelectorAll?.(".items-start")?.[0]?.innerText;

    const backtestData = await getSymphonyBacktest(
      window.active_factsheet_symphonyId
    );
    let symphony = {
      id: window.active_factsheet_symphonyId,
      name: symphonyName,
    };
    if (testType === "live") {
      symphony.dailyChanges = await getSymphonyDailyChange(
        symphony.id
      );

      const symphonyActivityHistory = await getSymphonyActivityHistory(symphony.id);
      addGeneratedSymphonyStatsToSymphonyWithModifiedDietz(symphony, symphonyActivityHistory);

    } else if (testType === "oos") {
      const { token } = (isLoggedIn() && (await getTokenAndAccount())) || {};
      const fetchHeaders = {};
      isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
      fetchHeaders["accept"] = "application/json";

      symphony = {
        ...symphony,
        ...(await (
          await fetch(
            "https://backtest-api.composer.trade/api/v1/public/symphonies/" +
              window.active_factsheet_symphonyId,
            { headers: fetchHeaders }
          )
        ).json()),
      };
    }

    let downloadLink;
    try {
      downloadLink = await getTearsheet(symphony, backtestData, testType);
    } catch {
      downloadLink = `<span style="display: block; margin-left: 20px; margin-top: 6px;">(error generating ${testType} tearsheet)</span>`;
      // we already logged it
    }

    const linkContainer = document.createElement('div');
    linkContainer.classList.add(`tearsheet-${testType}-link`)
    linkContainer.innerHTML = downloadLink;
    

    buildTearsheetButton.innerHTML = `<span class="flex items-center space-x-2">${originalText}</span>`; // Clear any previous link
    buildTearsheetButton.insertAdjacentElement('afterend', linkContainer);
    setButtonEnabled(buildTearsheetButton, true);
  }

  const hasLiveData = (
    factsheet.querySelector(".max-w-screen-2xl .flex-col")?.innerText || ""
  )?.includes?.("Live");

  const tearsheetContainer = document.createElement("div");
  tearsheetContainer.id = "tearsheat-widget";
  tearsheetContainer.classList.add(
    "border",
    "border-panel-border",
    "rounded-md",
    "shadow-sm",
    "bg-panel-bg",
    "pt-4",
    "pb-5",
    "px-4",
    "space-y-3"
  );

  const buildBackTestTearsheetButton = button(
    "build-backtest-tearsheet-button",
    "Build Backtest Tearsheet",
    () => buildTearsheetButtonClickHandler("backtest"),
    "rounded-tl rounded-bl"
  ); // this is the button that will build the backtest tearsheet
  const backtestTearsheetArea = document.createElement('div')
  backtestTearsheetArea.style.display = 'flex';
  backtestTearsheetArea.appendChild(buildBackTestTearsheetButton);
  tearsheetContainer.appendChild(backtestTearsheetArea);

  if (hasLiveData) {
    const buildLiveTearsheetButton = button(
      "build-live-tearsheet-button",
      "Build Live Tearsheet",
      () => buildTearsheetButtonClickHandler("live"),
      "rounded-tl rounded-bl"
    ); // this is the button that will build the live tearsheet
    const liveTearsheetArea = document.createElement('div')
    liveTearsheetArea.style.display = 'flex';
    liveTearsheetArea.appendChild(buildLiveTearsheetButton);
    tearsheetContainer.appendChild(liveTearsheetArea);
  }

  const buildOOSTearsheetButton = button(
    "build-oos-tearsheet-button",
    "Build OOS Tearsheet",
    () => buildTearsheetButtonClickHandler("oos"),
    "rounded-tl rounded-bl"
  ); // this is the button that will build the live tearsheet
  const oosTearsheetArea = document.createElement('div')
  oosTearsheetArea.style.display = 'flex';
  oosTearsheetArea.appendChild(buildOOSTearsheetButton);
  tearsheetContainer.appendChild(oosTearsheetArea);

  graphNode.appendChild(tearsheetContainer);
}

async function getSymphonyBacktest(symphonyId, forceRefresh = false) {
  if (!forceRefresh && cachedBacktestData[symphonyId]) {
    return cachedBacktestData[symphonyId];
  }

  let auth;
  if (isLoggedIn()) {
    auth = await getTokenAndAccount();
  }
  const { token, account } = auth || {};

  const fetchHeaders = {};
  isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
  fetchHeaders["accept"] = "application/json";
  fetchHeaders["Content-Type"] = "application/json";

  const response = await fetch(
    // using public endpoint for backtests when not logged in
    `https://backtest-api.composer.trade/api/v2${
      isLoggedIn() ? "" : "/public"
    }/symphonies/${symphonyId}/backtest`,
    {
      method: "POST",
      body: JSON.stringify({
        capital: 10000,
        apply_reg_fee: true,
        apply_taf_fee: true,
        apply_subscription: "none",
        backtest_version: "v2",
        slippage_percent: 0,
        spread_markup: 0,
        start_date: "1990-01-01",
        end_date: new Date().toISOString().split("T")[0],
        benchmark_symphonies: [],
      }),
      headers: fetchHeaders,
    }
  );

  if (response.status !== 200) {
    log(
      `Cannot load backtest data. Backtest endpoint for ${symphonyId} returned a ${response.status} error code.`
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }

  const backtestData = await response.json();
  cachedBacktestData[symphonyId] = backtestData;
  return backtestData;
}

const setButtonEnabled = (buttonElement, isEnabled) => {
  if (isEnabled) {
    buttonElement.classList.remove("text-dark-soft");
    buttonElement.classList.add("text-dark");
    buttonElement.classList.remove("bg-background");
    buttonElement.classList.add("bg-white");
    buttonElement.classList.remove("hover:bg-tab-light");
    buttonElement.disabled = false;
  } else {
    buttonElement.classList.add("text-dark-soft");
    buttonElement.classList.remove("text-dark");
    buttonElement.classList.add("bg-background");
    buttonElement.classList.remove("bg-white");
    buttonElement.classList.add("hover:bg-tab-light");
    buttonElement.disabled = true;
  }
};

let cachedSymphonyStats;
async function getSymphonyIdFromName(symphonyName) {
  if (!cachedSymphonyStats) {
    try {
      cachedSymphonyStats = await getSymphonyStatsMeta();
    } catch (e) {
      log('error loading symphonies',e);
    }
  }

  if(!cachedSymphonyStats) {
    log('getSymphonyIdFromName no symphonies loaded');
    return;
  }

  const symphony = cachedSymphonyStats.symphonies.find((symphony) =>
    symphony.name.replace("  ", " ").includes(
      symphonyName.replace("  ", " ") // this is a weird discrepancy between the symphony name and the factsheet name there are extra double spaces
    )
  );
  if (!symphony) {
    log(`Symphony ${symphonyName} not found`);
    return;
  }
  return symphony.id;
}

// Helper function to get React props from main world
function getReactProps(selector, propSelector) {
  return new Promise((resolve, reject) => {
    const messageId = Date.now().toString();
    
    // Listen for response from main world
    const listener = function(event) {
      if (event.data.type === 'REACT_PROPS_RESULT' && event.data.id === messageId) {
        window.removeEventListener('message', listener);
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data.data);
        }
      }
    };
    
    window.addEventListener('message', listener);
    
    // Send request to main world
    window.postMessage({
      type: 'GET_REACT_PROPS',
      element: selector,
      propSelector: propSelector,
      id: messageId
    }, '*');
  });
}

async function handleOpenFactSheet(event) {
  // Check if the clicked element or any of its parents is a tr or table cell

  // the a tag has the id in the href
  // in all other cases we try to get the id from the react props using the dom node
  let clickedTableRow = event.target.closest("tbody tr");
  // log(clickedTableRow, 'clicked')

  // if the clicked element is not a table row, do nothing
  if(!clickedTableRow) {
    return
  }

  let clickedRowAnchor = clickedTableRow.querySelector("a");

  if (clickedRowAnchor) {
    window.active_factsheet_symphonyId = clickedRowAnchor?.href?.split?.("/")?.[4];
  } else if (clickedTableRow?.tagName === 'TR') {
    try {
      // Add a unique class to the clicked row
      const uniqueClass = `symphony-row-${Date.now()}`;
      clickedTableRow.classList.add(uniqueClass);
      
      // Get React props from the main world using the unique class
      const symphonyId = await getReactProps(`.${uniqueClass}`, 'child.pendingProps.row.original.id');
      
      // Remove the unique class after we're done
      clickedTableRow.classList.remove(uniqueClass);
      
      if (symphonyId) {
        window.active_factsheet_symphonyId = symphonyId;
        return;
      }
    } catch (error) {
      log("Error getting React props:", error);
    }
  } else {
    log("Could not find get dom node for symphony id");
  }
}


async function collectSymphonyDataForFactsheet() {
  // Attach the click event listener to the body this will collect the id of the symphony that was clicked
  document.body.addEventListener("click", handleOpenFactSheet);

  if (isPathOnDetailsPage()) {
    // pull the sypmhony id from the url
    window.active_factsheet_symphonyId = window.location.pathname.split("/")[2];
    waitForFactsheet();
  }
}

function isPathOnDetailsPage() {
  return (
    window.location.pathname.startsWith("/symphony") &&
    window.location.pathname.endsWith("/details")
  );
}

function getCurrentSymphonyId() {
  if (isPathOnDetailsPage()) {
    const pathParts = window.location.pathname.split("/");
    return pathParts[2];
  }
  return window.active_factsheet_symphonyId;
}

function initNavigation() {
  let lastDetailsUrl = window.location.href;

  if (
    window.location.pathname === "/portfolio" ||
    window.location.pathname === "/watch" ||
    window.location.pathname === "/discover"
  ) {
    waitForFactsheet();
  }

  if (isPathOnDetailsPage()) {
    waitForFactsheet();
  }

  window.navigation.addEventListener("navigate", (event) => {
    if (
      event.destination.url === "https://app.composer.trade/portfolio" ||
      event.destination.url === "https://app.composer.trade/watch" ||
      event.destination.url === "https://app.composer.trade/discover"
    ) {
      waitForFactsheet();
    }
    
    if (event.destination.url?.includes?.("/symphony/") && event.destination.url?.includes?.("/details")) {
      const newSymphonyId = event.destination.url.split("/")[4];
      
      if (event.destination.url !== lastDetailsUrl && newSymphonyId) {
        lastDetailsUrl = event.destination.url;
        
        const statsTable = getStatsTable();
        if (statsTable) {
          statsTable.classList.remove('composer-quant-tools-initialized');
          statsTable.querySelectorAll('.extra-column').forEach(el => el.remove());
        }
      }
      
      waitForFactsheet();
    }
  });
}

export function initFactsheet() {
  setupBacktestInterceptor();
  collectSymphonyDataForFactsheet();
  initNavigation();
}
