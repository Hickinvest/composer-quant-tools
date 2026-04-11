import { log } from "./logger.js";
import { getTokenAndAccount } from "./tokenAndAccountUtil.js";
import { getSymphonyDailyChange, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphonyWithModifiedDietz } from "./liveSymphonyPerformance.js";

let cachedBacktestData = null;
let isUpdatingUI = false;
let currentSortCol = null;
let currentSortDir = 'desc';

const SORT_ARROW_HTML = `
  <span class="flex flex-col items-center justify-center gap-px pt-px ml-1 sort-arrows">
    <span class="h-0 w-0 border-b-[4px] border-x-[3px] border-x-transparent arrow-up" style="border-bottom-color: rgba(0, 0, 0, 0.25);"></span>
    <span class="h-0 w-0 border-t-[4px] border-x-[3px] border-x-transparent arrow-down" style="border-top-color: rgba(0, 0, 0, 0.25);"></span>
  </span>
`;

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
  "Trailing 1D Return": "trailing_one_day_return",
  "Trailing 1Y Return": "trailing_one_year_return",
  "Top 1D Contribution": "top_one_day_contribution",
  "Top 5% Contribution": "top_five_percent_day_contribution",
  "Top 10% Contribution": "top_ten_percent_day_contribution",
  "Herfindahl Index": "herfindahl_index",
  "Size": "size",
};

const columnTooltips = {
  "Cumulative Return": "The total percent change in investment value over the chosen period.",
  "Annualized Return": "The geometric average amount earned by an investment each year, assuming profits are reinvested.",
  "Trailing 1D Return": "The percent change in the value over the most recent 1-day period.",
  "Trailing 1W Return": "The percent change in the value over the most recent 1-week period.",
  "Trailing 2W Return": "The percent change in the value over the most recent 2-week period.",
  "Trailing 1M Return": "The percent change in the value over the most recent 1-month period.",
  "Trailing 3M Return": "The percent change in the value over the most recent 3-month period.",
  "Trailing 1Y Return": "The percent change in the value over the most recent 1-year period.",
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
  "Tail Ratio": "The ratio of the 95th percentile return to the absolute 5th percentile return. Right vs Left tail strength.",
  "Top 1D Contribution": "The contribution of the single best day to total returns.",
  "Top 5% Contribution": "The combined contribution of the top 5% best days to total returns.",
  "Top 10% Contribution": "The combined contribution of the top 10% best days to total returns.",
  "Herfindahl Index": "A measure of concentration. Higher values indicate more concentrated portfolios.",
  "Size": "The number of trading days in the analysis period."
};

const desiredMasterOrder = [
  "Cumulative Return",
  "Annualized Return",
  "Trailing 1D Return",
  "Trailing 1W Return",
  "Trailing 2W Return",
  "Trailing 1M Return",
  "Trailing 3M Return",
  "Trailing 1Y Return",
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
  "Tail Ratio",
  "Top 1D Contribution",
  "Top 5% Contribution",
  "Top 10% Contribution",
  "Herfindahl Index",
  "Size"
];

function formatPercent(value) {
  if (value === null || value === undefined) return '<span class="text-black/40">—</span>';
  return (value * 100).toFixed(1) + "%";
}

function formatRatio(value) {
  if (value === null || value === undefined) return '<span class="text-black/40">—</span>';
  return value.toFixed(2);
}

function getCellFormatter(key) {
  if (["win_rate", "median", "max", "min", "trailing_one_week_return", "trailing_two_week_return", "trailing_one_day_return", "trailing_one_year_return"].includes(key)) {
    return formatPercent;
  }
  if (key === "size") {
    return (value) => {
      if (value === null || value === undefined) return '<span class="text-black/40">—</span>';
      return value.toLocaleString();
    };
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
  const tables = document.querySelectorAll('.overflow-x-auto.border.border-black\\/16 table, .overflow-x-auto table');
  for (const table of tables) {
    const headerText = table.textContent || '';
    if (headerText.includes('Cumulative Return') && headerText.includes('Annualized Return')) {
      return table;
    }
  }
  const fallbackTables = document.querySelectorAll('table');
  for (const table of fallbackTables) {
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

    if (!th.querySelector('.cqt-header-inner')) {
      const text = th.textContent;
      const isFirstCol = idx === 0;
      
      th.innerHTML = `
        <span class="inline-flex items-center cqt-header-inner">
          <span class="text-left text-[12px] font-normal leading-4 tracking-[0.24px] text-black/70 whitespace-nowrap align-middle">${text}</span>
          ${!isFirstCol ? SORT_ARROW_HTML : ''}
        </span>
      `;
      
      // Add sorting listener for native columns (except the first labels column)
      if (!isFirstCol && (nativeColumns.includes(rawText) || !th.classList.contains('extra-column'))) {
        th.classList.add('cursor-pointer', 'select-none');
        th.addEventListener('click', () => handleFactsheetSort(th.dataset.columnId));
      }
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
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // Remove emojis
    .replace(/^[^\w\s\.]+/g, '') // Remove leading non-alphanumeric (except space/dot)
    .replace(/[\u25CF\u2022\u25CB]/g, '') // Remove dot symbols
    .replace(/\s*\(Benchmark\)$/i, '')
    .replace(/\(Benchmark\)$/i, '')
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
      th.className = 'text-left px-0 py-2 align-middle pr-6 min-w-[120px] extra-column group cursor-pointer select-none';
      th.dataset.columnId = colName;
      th.innerHTML = `
        <span class="inline-flex items-center cqt-header-inner">
          <span class="text-left text-[12px] font-normal leading-4 tracking-[0.24px] text-black/70 whitespace-nowrap align-middle">${colName}</span>
          ${SORT_ARROW_HTML}
        </span>
      `;
      th.addEventListener('click', () => handleFactsheetSort(colName));
      thead.appendChild(th);
    }

    // Check cells in each row
    rows.forEach((row) => {
      let td = row.querySelector(`td[data-column-id="${colName}"]`);
      if (!td) {
        td = document.createElement('td');
        td.className = 'px-0 py-2 text-[14px] font-medium leading-5 text-[#101516] whitespace-nowrap align-middle pr-6 extra-column';
        td.dataset.columnId = colName;
        row.appendChild(td);
      }

      // Fill data
      let statsToUse = null;
      const fullRowName = row.querySelector('td:first-child')?.textContent?.trim() || "";
      const cleanedName = cleanRowName(fullRowName);
      
      // 1. Check if it's the main symphony
      const symphonyName = document.querySelector('h2.text-2xl.font-bold span')?.innerText || "";
      const cleanedSymphonyName = cleanRowName(symphonyName);
      
      if (cleanedName === cleanedSymphonyName || 
          cleanedName === cleanRowName(cachedBacktestData.symphony_name || "") ||
          // Fallback: If it's a "button" style row and doesn't match benchmark, usually it's the main one
          (row.querySelector('a[style*="background-color: black"]') && !cleanedName.includes('spy') && !cleanedName.includes('qqq'))) {
        statsToUse = stats;
      } else {
        // 2. Match benchmark by ID or legend name
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
        if (td.innerHTML !== newVal) {
          td.innerHTML = newVal;
        }
      } else {
        if (td.innerHTML !== '<span class="text-black/40">—</span>') {
          td.innerHTML = '<span class="text-black/40">—</span>';
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

function handleFactsheetSort(colName) {
  if (currentSortCol === colName) {
    currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    currentSortCol = colName;
    currentSortDir = 'desc';
  }
  refreshTable();
}

function refreshTable() {
  if (isUpdatingUI) return;
  const table = getStatsTable();
  if (!table) return;

  isUpdatingUI = true;
  try {
    updateColumnValues(table);
    
    // If we have a custom sort on one of our columns, apply it to the rows
    if (currentSortCol) {
      sortFactsheetRows(table, currentSortCol, currentSortDir);
    }
    
    // Update arrow visual states
    updateHeaderArrows(table);
  } finally {
    // Settle delay to avoid immediate re-triggers and catch quick React updates
    setTimeout(() => {
      isUpdatingUI = false;
    }, 150);
  }
}

function sortFactsheetRows(table, colName, dir) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  rows.sort((a, b) => {
    const cellA = a.querySelector(`td[data-column-id="${colName}"]`);
    const cellB = b.querySelector(`td[data-column-id="${colName}"]`);
    
    let valA = cellA?.textContent?.trim() || "";
    let valB = cellB?.textContent?.trim() || "";
    
    // Parse
    if (valA === "—" || valA === "-" || valA === "") return 1;
    if (valB === "—" || valB === "-" || valB === "") return -1;
    
    const numA = parseFloat(valA.replace(/[^0-9.-]/g, ""));
    const numB = parseFloat(valB.replace(/[^0-9.-]/g, ""));
    
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    
    return dir === 'asc' ? numA - numB : numB - numA;
  });
  
  rows.forEach(row => tbody.appendChild(row));
}

function updateHeaderArrows(statsTable) {
  const headers = statsTable.querySelectorAll('thead th');
  headers.forEach(th => {
    const colId = th.dataset.columnId;
    const up = th.querySelector('.arrow-up');
    const down = th.querySelector('.arrow-down');
    if (!up || !down) return;

    if (currentSortCol === colId) {
      up.style.borderBottomColor = currentSortDir === 'asc' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.25)';
      down.style.borderTopColor = currentSortDir === 'desc' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.25)';
    } else {
      up.style.borderBottomColor = 'rgba(0, 0, 0, 0.25)';
      down.style.borderTopColor = 'rgba(0, 0, 0, 0.25)';
    }
  });
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
    let container = document.querySelector('.flex.flex-wrap-reverse.items-start.justify-between.gap-x-4.gap-y-3');
    
    if (!container) {
      const modal = document.querySelector(".factsheet-open");
      container = modal?.querySelector('.flex.flex-wrap-reverse.items-start.justify-between.gap-x-4.gap-y-3');
    }
    
    if (!container && isPathOnDetailsPage()) {
      const app = document.getElementById("app");
      container = app?.querySelector('.flex.flex-wrap-reverse.items-start.justify-between.gap-x-4.gap-y-3');
    }
    
    const widgetAttached = Boolean(document.querySelector("#tearsheat-widget"));

    if (container && !widgetAttached) {
      if (document.querySelector("#tearsheat-widget")) {
        return;
      }
      renderTearsheetButton(container);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
};

const showToast = (message, isError = false) => {
  const existing = document.querySelector('.tearsheet-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `tearsheet-toast fixed bottom-4 right-4 px-4 py-2 rounded-md shadow-lg z-[9999] text-sm ${isError ? 'bg-red-600' : 'bg-dark'} text-white`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

function renderTearsheetButton(container) {
  if (!container) {
    container = document.querySelector('.flex.flex-wrap-reverse.items-start.justify-between.gap-x-4.gap-y-3');
  }
  if (!container) {
    return;
  }

  const button = (buttonId, buttonText, func) => {
    let btn = document.createElement("button");
    btn.id = buttonId;
    btn.className = "rounded-full px-2 py-1.5 bg-dark text-white text-xs font-medium hover:opacity-90 transition";

    btn.textContent = buttonText;
    btn.addEventListener("click", (e) => func(e));

    return btn;
  };

  async function buildTearsheetButtonClickHandler(testType) {
    const factsheet = document.querySelector("#tearsheat-widget")?.closest('.flex.flex-wrap-reverse')?.closest('[class*="factsheet"]') || document.body;
    const widget = document.querySelector("#tearsheat-widget");
    const buildBtn = widget.querySelector('button');
    setButtonEnabled(buildBtn, false);
    const originalHtml = buildBtn.innerHTML;
    buildBtn.innerHTML = "Building...";

    widget.querySelector(`.tearsheet-${testType}-link`)?.remove();

    let symphonyName = document.querySelector('h2.text-2xl.font-bold span')?.innerText || 
                  document.querySelectorAll(".items-start")?.[0]?.innerText;
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
      const { token, sessionId } = (isLoggedIn() && (await getTokenAndAccount())) || {};
      const headers = { "accept": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (sessionId) headers["X-Session-Id"] = sessionId;

      const resp = await fetch(`https://backtest-api.composer.trade/api/v1/public/symphonies/${symphony.id}`, { headers });
      const data = await resp.json();
      symphony = { ...symphony, ...data };
    }

    let tearsheetUrl;
    try {
      tearsheetUrl = await getTearsheet(symphony, backtestData, testType);
      if (tearsheetUrl) {
        window.open(tearsheetUrl, '_blank');
        showToast(`Generated ${testType} tearsheet!`);
      } else {
        showToast(`No tearsheet generated`, true);
      }
    } catch (err) {
      showToast(`Error generating ${testType} tearsheet`, true);
    }

    buildBtn.innerHTML = originalHtml;
    setButtonEnabled(buildBtn, true);
  }

  const btnContainer = container.querySelector('.flex.flex-1.lg\\:flex-initial.gap-2') || container;
  const widget = document.createElement("div");
  widget.id = "tearsheat-widget";
  widget.className = "relative";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button btn-base-js gap-x-1.5 transition btn-shadow-inset btn-shadow border disabled:shadow-dark/10 active:shadow-none text-white focus-visible:ring-2 focus-visible:ring-action-soft/50 justify-center px-3 py-3 rounded bg-grass-500 border-grass-700 shadow-grass-500/30 hover:bg-grass-450 hover:border-grass-700 disabled:!bg-grass-light disabled:text-white/50 flex-1 lg:flex-initial min-w-[150px] !justify-start";
  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 28 36" aria-hidden="true" focusable="false"><rect x="0" y="0" width="28" height="36" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><polyline points="19,0 28,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="19,0 19,9 28,9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="20" width="4" height="10" rx="1"/><rect x="11" y="15" width="4" height="15" rx="1"/><rect x="17" y="18" width="4" height="12" rx="1"/></svg><span class="ml-1">Tearsheet</span>`;

  let menuVisible = false;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuVisible = !menuVisible;
    const existingMenu = widget.querySelector('.tearsheet-dropdown-menu');
    if (existingMenu) {
      existingMenu.remove();
      if (!menuVisible) return;
    }
    const menu = document.createElement("div");
    menu.className = "tearsheet-dropdown-menu absolute bottom-full left-0 mb-1 bg-dark rounded-md shadow-lg py-1 z-50 min-w-[120px]";
    
    // Check for Live at click time
    const containerNow = document.querySelector('.flex.flex-wrap-reverse.items-start.justify-between.gap-x-4.gap-y-3');
    const hasLiveDataNow = containerNow?.querySelector('.flex.gap-1 button')?.innerText?.includes("Live") || 
                          document.querySelector('.flex.gap-1 button')?.innerText?.includes("Live");
    
    const options = [{ id: "backtest", label: "Backtest" }];
    if (hasLiveDataNow) {
      options.unshift({ id: "live", label: "Live" });
    }
    options.push({ id: "oos", label: "OOS" });
    options.forEach(opt => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "block w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/20";
      item.textContent = opt.label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.remove();
        menuVisible = false;
        buildTearsheetButtonClickHandler(opt.id);
      });
      menu.appendChild(item);
    });
    widget.appendChild(menu);
  });

  document.addEventListener("click", () => {
    widget.querySelector('.tearsheet-dropdown-menu')?.remove();
    menuVisible = false;
  });

  widget.appendChild(btn);
  btnContainer.insertBefore(widget, btnContainer.firstChild);
}

async function getTearsheet(symphony, backtestData, type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "getTearsheet", symphony, backtestData, type }, (response) => {
      if (response?.error) {
        reject(response.error);
      } else {
        const blob = new Blob([response], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        resolve(url);
      }
    });
  });
}

async function getSymphonyBacktest(symphonyId) {
  if (cachedBacktestData && cachedBacktestData.symphony_id === symphonyId) return cachedBacktestData;
  const { token, sessionId } = (isLoggedIn() && (await getTokenAndAccount())) || {};
  const headers = { "accept": "application/json", "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (sessionId) headers["X-Session-Id"] = sessionId;

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
  return window.location.pathname.startsWith("/symphony") && 
         (window.location.pathname.endsWith("/details") || window.location.pathname.endsWith("/factsheet"));
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
  if (window.location.pathname === "/portfolio" || 
      window.location.pathname === "/watch" || 
      window.location.pathname === "/discover" ||
      window.location.pathname === "/drafts" ||
      isPathOnDetailsPage()) {
    waitForFactsheet();
  }

  window.navigation?.addEventListener("navigate", (event) => {
    const url = event.destination.url;
    if (url?.includes("/portfolio") || url?.includes("/watch") ||  url?.includes("/drafts") ||
        url?.includes("/discover") || (url?.includes("/symphony/") && (url?.includes("/details") || url?.includes("/factsheet")))) {
      waitForFactsheet();
    }
  });
}

const collectSymphonyDataForFactsheet = () => {
  document.body.addEventListener("click", handleOpenFactSheet, true);
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
