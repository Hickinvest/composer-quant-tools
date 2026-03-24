import { getTokenAndAccount } from "./tokenAndAccountUtil.js";
import { getSymphonyDailyChange, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphonyWithModifiedDietz } from "./liveSymphonyPerformance.js";
import { log } from "./logger.js";

// ─── Backtest Stats Table: Column Definitions & Caching ─────────────────────
// (from SolarWolf) Extra columns injected into Composer's native backtest stats table

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

// ─── Formatters for Extra Columns ────────────────────────────────────────────

function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  return (value * 100).toFixed(1) + "%";
}

function formatRatio(value) {
  if (value === null || value === undefined) return "-";
  return value.toFixed(2);
}

function getCellFormatter(key) {
  if (["win_rate", "median", "max", "min", "trailing_one_week_return", "trailing_two_week_return", "trailing_one_day_return", "trailing_one_year_return"].includes(key)) {
    return formatPercent;
  }
  if (key === "size") {
    return (value) => {
      if (value === null || value === undefined) return "-";
      return value.toLocaleString();
    };
  }
  return formatRatio;
}

// ─── Tooltip Functions (uses CSS classes from additional.css) ─────────────────

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

// ─── Stats Table Injection Functions ─────────────────────────────────────────
// These find Composer's native backtest stats table and inject extra columns
// with data from the cached backtest response.

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

  // Tag headers with data-column-id
  headers.forEach((th, idx) => {
    const rawText = th.textContent.trim();
    if (!th.dataset.columnId) {
      th.dataset.columnId = th.dataset.key || rawText || `native-col-${idx}`;
    }

    // Initialize Tooltip ONLY for our custom columns (not native ones)
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

  // Tag row cells to match their header column IDs
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

  // 2. Ensure extra columns and cells exist, fill data
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const stats = cachedBacktestData.stats || {};
  const benchmarks = stats.benchmarks || {};
  const legend = cachedBacktestData.legend || {};

  Object.keys(extraColumnMapping).forEach(colName => {
    // Ensure header exists
    let th = thead.querySelector(`th[data-column-id="${colName}"]`);
    if (!th) {
      th = document.createElement('th');
      th.className = 'p-2 border-r border-data-table-border text-xs font-medium whitespace-nowrap text-left min-w-[120px] extra-column';
      th.dataset.columnId = colName;
      th.textContent = colName;
      thead.appendChild(th);
    }

    // Ensure cells exist in each row and fill values
    rows.forEach((row, rowIndex) => {
      let td = row.querySelector(`td[data-column-id="${colName}"]`);
      if (!td) {
        td = document.createElement('td');
        td.className = 'p-2 border-data-table-border border-t border-r border-l extra-column';
        td.dataset.columnId = colName;
        row.appendChild(td);
      }

      // Determine which stats object to use for this row
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

  // 3. Sort headers into desired order (idempotent)
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

  // 4. Sort row cells to match header order (idempotent)
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

// ─── Login / Page Detection ──────────────────────────────────────────────────

function isLoggedIn() {
  if (window.location.pathname.endsWith("details")) {
    // details page — check for the "Go to Composer" link that appears when logged out
    return Boolean(
      document
        .querySelector('a[href="/portfolio"]')
        ?.innerText?.includes?.("Go to Composer")
    );
  }
  // anywhere else — assume logged in
  return true;
}

function isPathOnDetailsPage() {
  return (
    window.location.pathname.startsWith("/symphony") &&
    window.location.pathname.endsWith("/details")
  );
}

// ─── Factsheet Widget: Wait & Render ─────────────────────────────────────────

const waitForFactsheet = async () => {
  const observer = new MutationObserver(async function (
    mutations,
    mutationInstance
  ) {
    let factsheetOpen = document.querySelector(".factsheet-open");
    if (isPathOnDetailsPage()) {
      factsheetOpen = document.getElementById("app");
    }
    const factsheetGraphNode = factsheetOpen?.querySelector?.("section");

    const widgetAttached = Boolean(
      factsheetOpen?.querySelector?.("#tearsheat-widget")
    );

    if (factsheetOpen && factsheetGraphNode && !widgetAttached) {
      isLoggedIn() && (await getTokenAndAccount()); // cache the token and account
      const exists = factsheetOpen?.querySelector?.("#tearsheat-widget");
      if (exists) {
        return;
      }
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
    btn.className = `rounded flex border border-asset-border shadow-sm bg-panel-bg divide-x divide-solid divide-asset-border text-sm font-light flex items-center justify-center px-2 py-2 shadow-inner transition focus:outline-none leading-none select-none ${css} text-dark bg-white hover:bg-tab-light`;

    let span = document.createElement("span");
    span.className = "flex items-center space-x-2";

    let text = document.createElement("span");
    text.innerText = buttonText;

    btn.addEventListener("click", (e) => {
      func(e);
    });

    span.appendChild(text);
    btn.appendChild(span);
    return btn;
  };

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
    const buildTearsheetButton = factsheet?.querySelector?.(
      `#tearsheat-widget #build-${testType}-tearsheet-button`
    );

    setButtonEnabled(buildTearsheetButton, false);
    let originalText = buildTearsheetButton?.innerText;

    // Animated loading spinner (from Gabraham)
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
      symphony.dailyChanges = await getSymphonyDailyChange(symphony.id);

      const symphonyActivityHistory = await getSymphonyActivityHistory(symphony.id);
      addGeneratedSymphonyStatsToSymphonyWithModifiedDietz(symphony, symphonyActivityHistory);

    } else if (testType === "oos") {
      // Use sessionId in OOS tearsheet fetch (from SolarWolf)
      const { token, sessionId } = (isLoggedIn() && (await getTokenAndAccount())) || {};
      const fetchHeaders = {};
      isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
      fetchHeaders["accept"] = "application/json";
      if (sessionId) fetchHeaders["X-Session-Id"] = sessionId;

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
    linkContainer.classList.add(`tearsheet-${testType}-link`);
    linkContainer.innerHTML = downloadLink;

    buildTearsheetButton.innerHTML = `<span class="flex items-center space-x-2">${originalText}</span>`;
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
  );
  const backtestTearsheetArea = document.createElement('div');
  backtestTearsheetArea.style.display = 'flex';
  backtestTearsheetArea.appendChild(buildBackTestTearsheetButton);
  tearsheetContainer.appendChild(backtestTearsheetArea);

  if (hasLiveData) {
    const buildLiveTearsheetButton = button(
      "build-live-tearsheet-button",
      "Build Live Tearsheet",
      () => buildTearsheetButtonClickHandler("live"),
      "rounded-tl rounded-bl"
    );
    const liveTearsheetArea = document.createElement('div');
    liveTearsheetArea.style.display = 'flex';
    liveTearsheetArea.appendChild(buildLiveTearsheetButton);
    tearsheetContainer.appendChild(liveTearsheetArea);
  }

  const buildOOSTearsheetButton = button(
    "build-oos-tearsheet-button",
    "Build OOS Tearsheet",
    () => buildTearsheetButtonClickHandler("oos"),
    "rounded-tl rounded-bl"
  );
  const oosTearsheetArea = document.createElement('div');
  oosTearsheetArea.style.display = 'flex';
  oosTearsheetArea.appendChild(buildOOSTearsheetButton);
  tearsheetContainer.appendChild(oosTearsheetArea);

  graphNode.appendChild(tearsheetContainer);
}

// ─── Backtest Data Fetching ──────────────────────────────────────────────────

async function getSymphonyBacktest(symphonyId) {
  // Use cached backtest data from interceptor if available (from SolarWolf)
  if (cachedBacktestData && cachedBacktestData.symphony_id === symphonyId) {
    return cachedBacktestData;
  }

  let auth;
  if (isLoggedIn()) {
    auth = await getTokenAndAccount();
  }
  const { token, account, sessionId } = auth || {};

  const fetchHeaders = {};
  isLoggedIn() && (fetchHeaders["Authorization"] = `Bearer ${token}`);
  fetchHeaders["accept"] = "application/json";
  fetchHeaders["Content-Type"] = "application/json";
  // SessionId support in backtest fetch (from SolarWolf)
  if (sessionId) fetchHeaders["X-Session-Id"] = sessionId;

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
        start_date: "1990-01-01", // we were using "1969-12-31", but that gives "backtest-precedes-earliest-available-data" error
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
  return backtestData;
}

// ─── Button Helpers ──────────────────────────────────────────────────────────

const setButtonEnabled = (buttonElement, isEnabled) => {
  if (!buttonElement) return;
  // Combined approach: SolarWolf's opacity-50 toggle + Gabraham's class swaps
  buttonElement.disabled = !isEnabled;
  buttonElement.classList.toggle("opacity-50", !isEnabled);
  if (isEnabled) {
    buttonElement.classList.remove("text-dark-soft");
    buttonElement.classList.add("text-dark");
    buttonElement.classList.remove("bg-background");
    buttonElement.classList.add("bg-white");
    buttonElement.classList.remove("hover:bg-tab-light");
  } else {
    buttonElement.classList.add("text-dark-soft");
    buttonElement.classList.remove("text-dark");
    buttonElement.classList.add("bg-background");
    buttonElement.classList.remove("bg-white");
    buttonElement.classList.add("hover:bg-tab-light");
  }
};

// ─── Symphony ID Resolution (from Gabraham) ─────────────────────────────────
// getSymphonyIdFromName uses the stats meta API to look up a symphony ID by name.
// getReactProps bridges into React internals as a fallback when no anchor href exists.

let cachedSymphonyStats;
async function getSymphonyIdFromName(symphonyName) {
  if (!cachedSymphonyStats) {
    try {
      cachedSymphonyStats = await getSymphonyStatsMeta();
    } catch (e) {
      log('error loading symphonies', e);
    }
  }

  if (!cachedSymphonyStats) {
    log('getSymphonyIdFromName no symphonies loaded');
    return;
  }

  const symphony = cachedSymphonyStats.symphonies.find((symphony) =>
    symphony.name.replace("  ", " ").includes(
      symphonyName.replace("  ", " ") // discrepancy between symphony name and factsheet name (extra double spaces)
    )
  );
  if (!symphony) {
    log(`Symphony ${symphonyName} not found`);
    return;
  }
  return symphony.id;
}

// Helper function to get React props from main world (from Gabraham)
// Needed when no anchor href exists on the clicked table row
function getReactProps(selector, propSelector) {
  return new Promise((resolve, reject) => {
    const messageId = Date.now().toString();

    // Listen for response from main world
    const listener = function (event) {
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

// ─── Click Handler: Capture Active Symphony ID ──────────────────────────────
// Full version from Gabraham with React props fallback
// (SolarWolf simplified this to only check anchor href, but the React props
// fallback is needed when no anchor href exists on the row)

async function handleOpenFactSheet(event) {
  let clickedTableRow = event.target.closest("tbody tr");

  // if the clicked element is not a table row, do nothing
  if (!clickedTableRow) {
    return;
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

// ─── Data Collection & Navigation ────────────────────────────────────────────

async function collectSymphonyDataForFactsheet() {
  // Attach click listener to capture the symphony ID from clicked rows
  document.body.addEventListener("click", handleOpenFactSheet);

  if (isPathOnDetailsPage()) {
    // pull the symphony id from the url
    window.active_factsheet_symphonyId = window.location.pathname.split("/")[2];
    waitForFactsheet();
  }
}

// Navigation listener — watches ALL relevant routes (merged from both versions):
// Gabraham: /portfolio, /watch, /discover
// SolarWolf: /symphony/*/details
function initNavigation() {
  // Trigger on current page load for portfolio/watch/discover
  if (
    window.location.pathname === "/portfolio" ||
    window.location.pathname === "/watch" ||
    window.location.pathname === "/discover"
  ) {
    waitForFactsheet();
  }

  window.navigation?.addEventListener("navigate", (event) => {
    const url = event.destination.url;
    if (
      url === "https://app.composer.trade/portfolio" ||
      url === "https://app.composer.trade/watch" ||
      url === "https://app.composer.trade/discover" ||
      (url?.includes?.("/symphony/") && url?.includes?.("/details"))
    ) {
      waitForFactsheet();
    }
  });
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export function initFactsheet() {
  // Gabraham's existing init: click handler + navigation routes
  collectSymphonyDataForFactsheet();
  initNavigation();

  // SolarWolf's backtest data interceptor: listens for BACKTEST_DATA_INTERCEPTED
  // messages posted by the content script's fetch interceptor, caches the data,
  // and injects extra columns into the stats table.
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

  // SolarWolf's MutationObserver: watches for table DOM changes so we can
  // re-inject extra columns when React re-renders the stats table
  const tableObserver = new MutationObserver((mutations) => {
    if (isUpdatingUI) return;

    // Only trigger if we see actual structural changes to a relevant table
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
  tableObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}
