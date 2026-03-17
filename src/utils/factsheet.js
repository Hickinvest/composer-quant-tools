import { log } from "./logger.js";
import { getTokenAndAccount } from "./tokenAndAccountUtil.js";
import { getSymphonyDailyChange, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphonyWithModifiedDietz } from "./liveSymphonyPerformance.js";

let cachedBacktestData = null;
let isUpdatingUI = false;

const extraColumnMapping = {
  "Sortino Ratio": "sortino_ratio",
  "Win Rate": "win_rate",
  "Kurtosis": "kurtosis",
  "Skewness": "skewness",
  "Turnover": "annualized_turnover",
  "Tail Ratio": "tail_ratio",
  "Median": "median",
  "Max": "max",
  "Min": "min",
  "Trailing 1W Return": "trailing_one_week_return",
  "Trailing 2W Return": "trailing_two_week_return",
};

const columnTooltips = {
  "Cumulative Return": "The total percent change in investment value over the chosen period.",
  "Annualized Return": "The geometric average amount earned by an investment each year, assuming profits are reinvested.",
  "Trailing 1W Return": "The percent change in the value over the most recent 1-week period.",
  "Trailing 2W Return": "The percent change in the value over the most recent 2-week period.",
  "Trailing 1M Return": "The percent change in the value over the most recent 1-month period.",
  "Trailing 3M Return": "The percent change in the value over the most recent 3-month period.",
  "Sharpe Ratio": "A measure of risk-adjusted return. It's the annualized arithmetic mean of daily returns divided by its annualized standard deviation.",
  "Sortino Ratio": "A measure of risk-adjusted return that focuses only on downside deviation, ignoring 'good' (upside) volatility.",
  "Calmar Ratio": "The ratio of annualized return to maximum drawdown. Measures return relative to historical drawdown risk.",
  "Max Drawdown": "The largest peak-to-trough decline in value observed over the backtest period.",
  "Standard Deviation": "A measure of the dispersion of returns from the mean, commonly used as a proxy for volatility.",
  "Win Rate": "The percentage of days with a positive return.",
  "Median": "The median daily return over the backtest period.",
  "Max": "The single highest daily return recorded.",
  "Min": "The single lowest (most negative) daily return recorded.",
  "Kurtosis": "A measure of 'fat tails'. High kurtosis indicates more frequent extreme returns (outliers).",
  "Skewness": "Measures asymmetry. Positive skew indicates more frequent small losses balanced by occasional large gains.",
  "Turnover": "The annualized frequency at which the portfolio's assets are replaced.",
  "Tail Ratio": "The ratio of the 95th percentile return to the absolute 5th percentile return. Right vs Left tail strength."
};

const desiredMasterOrder = [
  "Cumulative Return",
  "Annualized Return",
  "Trailing 1W Return",
  "Trailing 2W Return",
  "Trailing 1M Return",
  "Trailing 3M Return",
  "Sharpe Ratio",
  "Sortino Ratio",
  "Calmar Ratio",
  "Max Drawdown",
  "Standard Deviation",
  "Win Rate",
  "Median",
  "Max",
  "Min",
  "Kurtosis",
  "Skewness",
  "Turnover",
  "Tail Ratio"
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
  if (["win_rate", "median", "max", "min", "trailing_one_week_return", "trailing_two_week_return"].includes(key)) {
    return formatPercent;
  }
  return formatRatio;
}

const nativeColumns = [
  "Cumulative Return",
  "Annualized Return",
  "Trailing 1M Return",
  "Trailing 3M Return",
  "Sharpe Ratio",
  "Standard Deviation",
  "Max Drawdown",
  "Calmar Ratio"
];

function showTooltip(e, text) {
  let root = document.querySelector('.composer-custom-tooltip-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'composer-custom-tooltip-root';
    root.setAttribute('data-tippy-root', '');
    
    const box = document.createElement('div');
    box.className = 'tippy-box';
    box.setAttribute('role', 'tooltip');
    box.setAttribute('data-placement', 'top');
    
    const content = document.createElement('div');
    content.className = 'tippy-content';
    
    const innerText = document.createElement('div');
    content.appendChild(innerText);
    box.appendChild(content);
    root.appendChild(box);
    document.body.appendChild(root);
  }

  const box = root.querySelector('.tippy-box');
  const content = root.querySelector('.tippy-content > div');
  
  content.textContent = text;
  root.style.display = 'block';
  
  // Trigger animations
  requestAnimationFrame(() => {
    box.setAttribute('data-state', 'visible');
    root.querySelector('.tippy-content').setAttribute('data-state', 'visible');
  });

  const rect = e.currentTarget.getBoundingClientRect();
  root.style.left = `${rect.left + rect.width / 2}px`;
  root.style.top = `${rect.top - 8}px`;
  
  e.currentTarget.setAttribute('aria-expanded', 'true');
}

function hideTooltip(e) {
  const root = document.querySelector('.composer-custom-tooltip-root');
  if (root) {
    const box = root.querySelector('.tippy-box');
    const content = root.querySelector('.tippy-content');
    box.setAttribute('data-state', 'hidden');
    content.setAttribute('data-state', 'hidden');
    
    // Hide after transition
    setTimeout(() => {
      if (box.getAttribute('data-state') === 'hidden') {
        root.style.display = 'none';
      }
    }, 300);
  }
  const target = e.currentTarget || e.target;
  if (target && typeof target.setAttribute === 'function') {
    target.setAttribute('aria-expanded', 'false');
  }
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

function getColumnOrderIndex(id) {
  const index = desiredMasterOrder.findIndex(o => id.includes(o));
  return index === -1 ? 999 : index;
}

function ensureColumnIds(statsTable) {
  const thead = statsTable.querySelector('thead tr');
  if (!thead) return;
  const headers = Array.from(thead.querySelectorAll('th'));
  
  // Tag headers
  headers.forEach((th, idx) => {
    const rawText = th.textContent.trim();
    if (!th.dataset.columnId) {
      th.dataset.columnId = th.dataset.key || rawText || `native-col-${idx}`;
    }

    // Initialize Tooltip ONLY for our custom columns
    const tooltipText = columnTooltips[rawText];
    const isNative = nativeColumns.includes(rawText);
    if (tooltipText && !isNative && !th.dataset.tooltipInitialized) {
      th.addEventListener('mouseenter', (e) => showTooltip(e, tooltipText));
      th.addEventListener('mouseleave', hideTooltip);
      th.dataset.tooltipInitialized = "true";
      th.setAttribute('aria-haspopup', 'true');
      th.setAttribute('aria-expanded', 'false');
      th.classList.add('cursor-help');
    }
  });

  // Tag rows
  const rows = statsTable.querySelectorAll('tbody tr');
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    cells.forEach((td, idx) => {
      if (!td.dataset.columnId) {
        const header = headers[idx];
        if (header) td.dataset.columnId = header.dataset.columnId;
      }
    });
  });
}

function cleanRowName(name) {
  return name
    .replace(/^[^\w\s\.]+/g, '') 
    .replace(/[\u25CF\u2022\u25CB]/g, '') 
    .replace(/\s*\(Benchmark\)$/i, '')
    .replace(/\(Benchmark\)$/i, '') // Extra catch for different formatting
    .trim()
    .toLowerCase();
}

function updateColumnValues(statsTable) {
  if (!statsTable || !cachedBacktestData) return;

  const tbody = statsTable.querySelector('tbody');
  const thead = statsTable.querySelector('thead tr');
  if (!tbody || !thead) return;

  // 1. Tag all existing columns with IDs if not already tagged
  ensureColumnIds(statsTable);

  // 2. Ensure extra columns and cells exist
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const stats = cachedBacktestData.stats || {};
  const benchmarks = stats.benchmarks || {};
  const legend = cachedBacktestData.legend || {};

  Object.keys(extraColumnMapping).forEach(colName => {
    // Check header
    let th = thead.querySelector(`th[data-column-id="${colName}"]`);
    if (!th) {
      th = document.createElement('th');
      th.className = 'p-2 border-r border-data-table-border text-xs font-medium whitespace-nowrap text-left min-w-[120px] extra-column';
      th.dataset.columnId = colName;
      th.textContent = colName;
      thead.appendChild(th);
    }

    // Check cells in each row
    rows.forEach((row, rowIndex) => {
      let td = row.querySelector(`td[data-column-id="${colName}"]`);
      if (!td) {
        td = document.createElement('td');
        td.className = 'p-2 border-data-table-border border-t border-r border-l extra-column';
        td.dataset.columnId = colName;
        row.appendChild(td);
      }

      // Fill data
      let statsToUse = null;
      if (rowIndex === 0) {
        statsToUse = stats;
      } else {
        const fullRowName = row.querySelector('td:first-child')?.textContent?.trim() || "";
        const cleanedName = cleanRowName(fullRowName);
        
        // Match benchmark by ID or legend name
        const benchmarkKey = Object.keys(benchmarks).find(key => {
          const cleanKey = key.toLowerCase();
          if (cleanedName === cleanKey || cleanedName.includes(cleanKey) || cleanKey.includes(cleanedName)) return true;
          
          const legendName = legend[key]?.name;
          if (legendName) {
            const cleanLegend = cleanRowName(legendName);
            return cleanedName === cleanLegend || cleanedName.includes(cleanLegend) || cleanLegend.includes(cleanedName);
          }
          return false;
        });

        if (benchmarkKey) {
          statsToUse = benchmarks[benchmarkKey];
        }
      }

      if (statsToUse) {
        const key = extraColumnMapping[colName];
        const formatter = getCellFormatter(key);
        const newVal = formatter(statsToUse[key]);
        if (td.textContent !== newVal) {
          td.textContent = newVal;
        }
      }
    });
  });

  // 3. Idempotent Sort Headers
  const allHeaders = Array.from(thead.querySelectorAll('th'));
  const restHeaders = allHeaders.slice(1);
  restHeaders.sort((a, b) => getColumnOrderIndex(a.dataset.columnId) - getColumnOrderIndex(b.dataset.columnId));
  
  let currentHeader = thead.querySelector('th:first-child');
  restHeaders.forEach(th => {
    if (currentHeader.nextElementSibling !== th) {
      currentHeader.after(th);
    }
    currentHeader = th;
  });

  // 4. Idempotent Sort Rows
  const finalHeaderIds = Array.from(thead.querySelectorAll('th')).map(th => th.dataset.columnId);
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td'));
    let currentCell = row.querySelector('td:first-child');
    finalHeaderIds.slice(1).forEach(id => {
      const cell = cells.find(c => c.dataset.columnId === id);
      if (cell && currentCell.nextElementSibling !== cell) {
        currentCell.after(cell);
      }
      currentCell = cell;
    });
  });
}

function refreshTable() {
  if (isUpdatingUI) return;
  const table = getStatsTable();
  if (!table) return;

  isUpdatingUI = true;
  try {
    updateColumnValues(table);
  } finally {
    // Settle delay to avoid immediate re-triggers and catch quick React updates
    setTimeout(() => {
      isUpdatingUI = false;
    }, 150);
  }
}

function isLoggedIn() {
  if (window.location.pathname.endsWith("details")) {
    return Boolean(
      document
        .querySelector('a[href="/portfolio"]')
        ?.innerText?.includes?.("Go to Composer")
    );
  }
  return true;
}

const waitForFactsheet = async () => {
  const observer = new MutationObserver(async function (mutations, mutationInstance) {
    let factsheetOpen = document.querySelector(".factsheet-open");
    if (isPathOnDetailsPage()) {
      factsheetOpen = document.getElementById("app");
    }
    const factsheetGraphNode = factsheetOpen?.querySelector?.("section");
    const widgetAttached = Boolean(factsheetOpen?.querySelector?.("#tearsheat-widget"));

    if (factsheetOpen && factsheetGraphNode && !widgetAttached) {
      isLoggedIn() && (await getTokenAndAccount());
      if (factsheetOpen?.querySelector?.("#tearsheat-widget")) return;
      renderTearsheetButton(factsheetOpen);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
};

function renderTearsheetButton(factsheet) {
  const graphNode = factsheet?.querySelector?.("section");
  if (!graphNode) return;

  const button = (buttonId, buttonText, func, css) => {
    let btn = document.createElement("button");
    btn.id = buttonId;
    btn.className = `rounded flex border border-asset-border shadow-sm bg-panel-bg divide-y divide-solid divide-asset-border text-sm font-light flex items-center justify-center px-2 py-2 shadow-inner transition focus:outline-none leading-none select-none ${css} text-dark bg-white hover:bg-tab-light`;

    let span = document.createElement("span");
    span.className = "flex items-center space-x-2";

    let text = document.createElement("span");
    text.innerText = buttonText;

    btn.addEventListener("click", (e) => func(e));

    span.appendChild(text);
    btn.appendChild(span);
    return btn;
  };

  async function buildTearsheetButtonClickHandler(testType) {
    const buildBtn = factsheet.querySelector(`#tearsheat-widget #build-${testType}-tearsheet-button`);
    setButtonEnabled(buildBtn, false);
    let originalText = buildBtn.innerText;
    buildBtn.querySelector("span").innerHTML = `${originalText.replace("Build ", "Building ")} ...`;

    let symphonyName = factsheet.querySelectorAll(".items-start")?.[0]?.innerText;
    const backtestData = await getSymphonyBacktest(window.active_factsheet_symphonyId);
    
    let symphony = {
      id: window.active_factsheet_symphonyId,
      name: symphonyName,
    };

    if (testType === "live") {
      symphony.dailyChanges = await getSymphonyDailyChange(symphony.id);
      const activityHistory = await getSymphonyActivityHistory(symphony.id);
      addGeneratedSymphonyStatsToSymphonyWithModifiedDietz(symphony, activityHistory);
    } else if (testType === "oos") {
      const { token } = (isLoggedIn() && (await getTokenAndAccount())) || {};
      const headers = { "accept": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch(`https://backtest-api.composer.trade/api/v1/public/symphonies/${symphony.id}`, { headers });
      const data = await resp.json();
      symphony = { ...symphony, ...data };
    }

    try {
      const reportHtml = await getTearsheet(symphony, backtestData, testType);
      const linkContainer = document.createElement('div');
      linkContainer.classList.add(`tearsheet-${testType}-link`);
      linkContainer.innerHTML = reportHtml;
      buildBtn.insertAdjacentElement('afterend', linkContainer);
    } catch (e) {
      log("Error building tearsheet:", e);
    } finally {
      buildBtn.innerHTML = `<span class="flex items-center space-x-2">${originalText}</span>`;
      setButtonEnabled(buildBtn, true);
    }
  }

  const hasLiveData = factsheet.querySelector(".max-w-screen-2xl .flex-col")?.innerText?.includes("Live");
  const container = document.createElement("div");
  container.id = "tearsheat-widget";
  container.className = "border border-panel-border rounded-md shadow-sm bg-panel-bg pt-4 pb-5 px-4 space-y-3";

  container.appendChild(button("build-backtest-tearsheet-button", "Build Backtest Tearsheet", () => buildTearsheetButtonClickHandler("backtest"), "rounded-tl rounded-bl"));
  if (hasLiveData) {
    container.appendChild(button("build-live-tearsheet-button", "Build Live Tearsheet", () => buildTearsheetButtonClickHandler("live"), "rounded-tl rounded-bl"));
  }
  container.appendChild(button("build-oos-tearsheet-button", "Build OOS Tearsheet", () => buildTearsheetButtonClickHandler("oos"), "rounded-tl rounded-bl"));

  graphNode.appendChild(container);
}

async function getTearsheet(symphony, backtestData, type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getTearsheet", symphony, backtestData, type }, (response) => {
      if (response?.error) {
        reject(response.error);
      } else {
        const blob = new Blob([response], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        resolve(`<a href="${url}" target="_blank" style="display: block; margin-left: 20px; margin-top: 6px; color: #007bff;">Open QuantStats ${type} Tearsheet Report</a>`);
      }
    });
  });
}

async function getSymphonyBacktest(symphonyId) {
  if (cachedBacktestData && cachedBacktestData.symphony_id === symphonyId) return cachedBacktestData;
  const { token } = (isLoggedIn() && (await getTokenAndAccount())) || {};
  const headers = { "accept": "application/json", "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`https://backtest-api.composer.trade/api/v2${isLoggedIn() ? "" : "/public"}/symphonies/${symphonyId}/backtest`, {
    method: "POST",
    headers,
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
    })
  });
  return await resp.json();
}

const setButtonEnabled = (el, isEnabled) => {
  if (!el) return;
  el.disabled = !isEnabled;
  el.classList.toggle("opacity-50", !isEnabled);
};

function isPathOnDetailsPage() {
  return window.location.pathname.startsWith("/symphony") && window.location.pathname.endsWith("/details");
}

async function handleOpenFactSheet(event) {
  const clickedTableRow = event.target.closest("tbody tr");
  if (!clickedTableRow) return;
  const anchor = clickedTableRow.querySelector("a");
  if (anchor) {
    window.active_factsheet_symphonyId = anchor.href?.split("/")?.[4];
  }
}

function initNavigation() {
  window.navigation?.addEventListener("navigate", (event) => {
    if (event.destination.url?.includes?.("/symphony/") && event.destination.url?.includes?.("/details")) {
      waitForFactsheet();
    }
  });
}

const collectSymphonyDataForFactsheet = () => {
  document.body.addEventListener("click", handleOpenFactSheet);
  if (isPathOnDetailsPage()) {
    window.active_factsheet_symphonyId = window.location.pathname.split("/")[2];
    waitForFactsheet();
  }
};

export function initFactsheet() {
  initNavigation();
  collectSymphonyDataForFactsheet();
  
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'BACKTEST_DATA_INTERCEPTED') {
      // Only store if it's actual backtest result with stats
      if (event.data.data?.stats) {
        cachedBacktestData = event.data.data;
        refreshTable();
        // Retry logic: catch React re-renders that might happen several hundred ms later
        setTimeout(refreshTable, 500);
        setTimeout(refreshTable, 1000);
      }
    }
  });

  const observer = new MutationObserver((mutations) => {
    if (isUpdatingUI) return;
    
    // Only trigger if we see actual structural changes to a relevant table or data container
    const hasMeaningfulTableChange = mutations.some(m => {
      // Ignore mutations on our own extra-column elements to break the loop
      const isOurElement = m.target.classList?.contains?.('extra-column') || 
                          m.target.parentElement?.classList?.contains?.('extra-column');
      if (isOurElement) return false;
      
      const isTablePart = m.target.nodeName === 'TABLE' || 
                         m.target.nodeName === 'TBODY' || 
                         m.target.nodeName === 'THEAD' ||
                         m.target.nodeName === 'TR' ||
                         m.target.closest?.('.border-data-table-border');
                         
      return isTablePart && (m.type === 'childList' || m.type === 'characterData');
    });

    if (hasMeaningfulTableChange) {
      refreshTable();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}
