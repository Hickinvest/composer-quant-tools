// Table-specific logic for the portfolio page
import { performanceData, getSymphonyDailyChange, getAccountDeploys, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphony, addQuantstatsToSymphony, addGeneratedSymphonyStatsToSymphonyWithModifiedDietz, calculatePL, formatPLDollar, formatPLPercent } from "./liveSymphonyPerformance.js";
import { calculateActiveCagr, injectActiveCagrWithTooltip, injectActiveCagrLoadingPlaceholder } from "./portfolioReturns.js";
import { getBenchmarks, alignBenchmarkWithSymphony } from "./benchmarkData.js";
import { log } from "./logger.js";
import {
  setupNativeColumnListener,
  setupTableObserver,
  handleColumnSort,
  addSortIndicatorToHeader,
  getCurrentSortColumn,
  getCurrentSortDirection,
  isSortingEnabled,
  setSortingEnabled
} from "./tableSortUtil.js";

let extraColumns = [
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
];

export function setExtraColumns(columns) {
  extraColumns = columns;
}

// Re-export sorting control for external use
export { setSortingEnabled, isSortingEnabled };

export const startPortfolioTableInterval = async () => {
  const checkInterval = setInterval(async () => {
    if (window.location.pathname !== "/portfolio") return;
    const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
    const portfolioChart = document.querySelector('[data-highcharts-chart], .border-graph-axislines');
    const mainTableContent = document.querySelectorAll("main :not(.tv-lightweight-charts) > table td");
    if (!mainTable) return;
    if (mainTable.classList.contains('composer-quant-tools-initialized')) {
      const hasAnyExtraColumns = mainTable.querySelector('.extra-column');
      if (!hasAnyExtraColumns) {
        mainTable.classList.remove('composer-quant-tools-initialized');
      }
    }
    if (!mainTable.classList.contains('composer-quant-tools-initialized')) {
      if (portfolioChart && mainTableContent) {
        mainTable.classList.add('composer-quant-tools-initialized');
        await startSymphonyPerformanceSync(mainTable);
      }
      return;
    }
    if (performanceData?.symphonyStats?.symphonies?.length > 0) {
      const mainTableBody = mainTable.querySelector("tbody");
      const rows = mainTableBody?.querySelectorAll("tr .bg-sheet");
      if (rows?.length > 0) {
        const needsUpdate = Array.from(rows).some(row => {
          const columnCells = row.querySelectorAll('.extra-column');
          return columnCells.length !== extraColumns.length;
        });
        if (needsUpdate) {
          updateColumns(mainTable, extraColumns);
        }
        // Always update rows to keep P/L in sync with real-time value changes
        updateTableRows();
      }
    }
  }, 1000);
  window.addEventListener('unload', () => {
    clearInterval(checkInterval);
  });
};

export const startSymphonyPerformanceSync = async (mainTable) => {
  updateColumns(mainTable, extraColumns);
  setupNativeColumnListener(updateTableRows);
  setupTableObserver(); // Watch for Composer updates to re-apply our sort

  // Show loading placeholder for Active CAGR while data loads
  injectActiveCagrLoadingPlaceholder();

  const data = await getSymphonyPerformanceInfo({
    onSymphonyCallback: extendSymphonyStatsRow,
    skipCache: true,
  });
  if (!data) {
    log("no symphony performance data found");
    return;
  }
  chrome.runtime.sendMessage({
    action: "processSymphonies",
    performanceData: data
  }, (response) => {
    if (response.success) {
      log("symphony performance data processed", response.data);
    } else {
      log("error processing symphony performance data", response.error);
    }
  });
  updateTableRows();
  log("all symphony stats added", performanceData);

  // Calculate and inject Active CAGR after all symphony stats are loaded
  const activeCagrStats = calculateActiveCagr();
  if (activeCagrStats) {
    injectActiveCagrWithTooltip(activeCagrStats);
  }
};

const TwelveHours = 12 * 60 * 60 * 1000; // this should only update once per day ish base on a normal user's usage. It could happen multiple times if multiple windows are open. or if the user is refreshing every 12 hours.
let performanceDataFetchedAt = Date.now() - TwelveHours;
export async function getSymphonyPerformanceInfo(options = {}) {
  const onSymphonyCallback = options.onSymphonyCallback;
  // if the last call options are the same as the current call options and was less than 2 hours ago, return the cached data
  if (performanceDataFetchedAt >= Date.now() - TwelveHours && !options.skipCache) {
    for (const symphony of performanceData.symphonyStats.symphonies) {
      onSymphonyCallback?.(symphony);
    }
    return performanceData;
  }
  try {
    // const accountDeploys = await getAccountDeploys();
    const symphonyStats = await getSymphonyStatsMeta();

    // performanceData.accountDeploys = accountDeploys;
    performanceData.symphonyStats = symphonyStats;

    // Check if benchmark calculations are enabled
    let benchmarks = null;
    let benchmarkCalculationsEnabled = true;
    try {
      const settings = await window.storageAccess?.get?.(['enableBenchmarkCalculations']);
      benchmarkCalculationsEnabled = settings?.enableBenchmarkCalculations ?? true;
    } catch (settingsError) {
      log("Warning: Could not read benchmark settings, defaulting to enabled", settingsError);
    }

    // Fetch benchmark data (SPY, QQQ, BIL) for alpha/beta calculations
    if (benchmarkCalculationsEnabled) {
      try {
        benchmarks = await getBenchmarks();
        log("Benchmark data fetched successfully", Object.keys(benchmarks));
      } catch (benchmarkError) {
        log("Warning: Could not fetch benchmark data, alpha/beta will not be calculated", benchmarkError);
      }
    } else {
      log("Benchmark calculations disabled in settings");
    }

    // Process symphonies in batches
    const batchSize = 5; // Process 5 symphonies at a time
    const symphonies = [...symphonyStats.symphonies];

    // FIRST PASS: Get main stats (without benchmarks - faster and more reliable)
    for (let i = 0; i < symphonies.length; i += batchSize) {
      const batch = symphonies.slice(i, i + batchSize);

      // Process each batch in parallel
      await Promise.all(batch.map(async (symphony) => {
        try {
          symphony.dailyChanges = await getSymphonyDailyChange(
            symphony.id,
            TwelveHours
          );

          const symphonyActivityHistory = await getSymphonyActivityHistory(symphony.id);

          // addGeneratedSymphonyStatsToSymphony(symphony, []);
          addGeneratedSymphonyStatsToSymphonyWithModifiedDietz(symphony, symphonyActivityHistory);

          // First pass: NO benchmarks - just get the main quantstats metrics
          await addQuantstatsToSymphony(symphony, [], null);

          // Update the symphony in the performanceData
          const symphonyIndex = performanceData.symphonyStats.symphonies.findIndex(s => s.id === symphony.id);
          if (symphonyIndex !== -1) {
            performanceData.symphonyStats.symphonies[symphonyIndex] = symphony;
          }

          // Call the callback if provided
          onSymphonyCallback?.(symphony);
        } catch (error) {
          log(
            "Error adding stats to symphony",
            symphony?.id,
            symphony?.name,
            error,
          );
        }
      }));
    }

    // SECOND PASS: Add alpha/beta (runs after all main stats are done)
    // This is a separate pass so failures don't affect the main stats
    if (benchmarks) {
      log("Starting alpha/beta calculations...");
      for (let i = 0; i < symphonies.length; i += batchSize) {
        const batch = symphonies.slice(i, i + batchSize);

        await Promise.all(batch.map(async (symphony) => {
          try {
            if (!symphony.dailyChanges?.epoch_ms?.length) return;

            // Prepare aligned benchmark data for this symphony
            const spyAligned = alignBenchmarkWithSymphony(benchmarks.SPY, symphony.dailyChanges.epoch_ms);
            const qqqAligned = alignBenchmarkWithSymphony(benchmarks.QQQ, symphony.dailyChanges.epoch_ms);
            const bilAligned = alignBenchmarkWithSymphony(benchmarks.BIL, symphony.dailyChanges.epoch_ms);

            const alignedBenchmarkData = {
              SPY: { returns: spyAligned.returns },
              QQQ: { returns: qqqAligned.returns },
              BIL: { returns: bilAligned.returns },
            };

            // Second pass: WITH benchmarks for alpha/beta only
            await addQuantstatsToSymphony(symphony, [], alignedBenchmarkData);

            // Update the row with alpha/beta values
            onSymphonyCallback?.(symphony);
          } catch (error) {
            log("Warning: Could not calculate alpha/beta for symphony", symphony.id, error.message || error);
          }
        }));
      }
      log("Alpha/beta calculations complete");
    }

    // Update the timestamp to indicate successful data fetch
    performanceDataFetchedAt = Date.now();

    return performanceData;
  } catch (error) {
    log("Error getting symphony performance info", error);
  }
}

// Helper to extract symphony ID from a row (handles various row states)
function getSymphonyIdFromRow(row) {
  // Primary: Try to get ID from the symphony link in first cell
  const primaryLink = row.querySelector("td:first-child a[href*='/symphony/']");
  if (primaryLink) {
    const match = primaryLink.href.match(/\/symphony\/([^\/]+)/);
    if (match) return match[1];
  }

  // Fallback: Look for any symphony link in the row (handles pending trades, liquidations, etc.)
  const anyLink = row.querySelector("a[href*='/symphony/']");
  if (anyLink) {
    const match = anyLink.href.match(/\/symphony\/([^\/]+)/);
    if (match) return match[1];
  }

  // Final fallback: Check for data attributes that might store the ID
  const dataId = row.dataset?.symphonyId || row.querySelector("[data-symphony-id]")?.dataset?.symphonyId;
  if (dataId) return dataId;

  return null;
}

export function updateTableRows() {
  const mainTableBody = document.querySelector("main :not(.tv-lightweight-charts) > table tbody");
  const rows = mainTableBody?.querySelectorAll("tr");
  performanceData?.symphonyStats?.symphonies?.forEach?.((symphony) => {
    if (symphony.addedStats) {
      for (let row of rows) {
        // Use robust ID extraction that handles various row states
        const symphonyId = getSymphonyIdFromRow(row);
        if (symphonyId == symphony.id) {
          // Recalculate P/L with current value from DOM if netDeposits is available
          if (symphony.netDeposits !== undefined) {
            const currentValue = getCurrentValueFromRow(row);
            if (currentValue !== null) {
              const { plDollar, plPercent } = calculatePL(currentValue, symphony.netDeposits);
              symphony.addedStats["P/L $"] = formatPLDollar(plDollar);
              symphony.addedStats["P/L %"] = formatPLPercent(plPercent);
            }
          }
          updateRowStats(row, symphony.addedStats);
          break;
        }
      }
    }
  });
}

// Extract current value from Composer's native "Current Value" column
function getCurrentValueFromRow(row) {
  // Composer's table structure: find the cell that contains the current value
  // It's typically in a cell with dollar formatting like "$1,234.56"
  const cells = row.querySelectorAll("td");
  for (const cell of cells) {
    const text = cell.textContent?.trim();
    // Match dollar amounts like "$1,234.56" or "$12,345.67"
    // Skip cells that look like percentages or other formats
    if (text && /^\$[\d,]+\.\d{2}$/.test(text)) {
      // Parse the dollar amount
      const value = parseFloat(text.replace(/[$,]/g, ''));
      if (!isNaN(value) && value > 0) {
        return value;
      }
    }
  }
  return null;
}

export function extendSymphonyStatsRow(symphony) {
  const mainTableBody = document.querySelector("main :not(.tv-lightweight-charts) > table tbody");
  const rows = mainTableBody?.querySelectorAll("tr");
  for (let row of rows) {
    // Use robust ID extraction that handles various row states
    const symphonyId = getSymphonyIdFromRow(row);
    if (symphonyId == symphony.id && symphony.addedStats) {
      updateRowStats(row, symphony.addedStats);
      break;
    }
  }
}

export function updateRowStats(row, addedStats) {
  extraColumns.forEach((key, index) => {
    let value = addedStats[key];
    let cell = row.querySelector(`.extra-column[data-key="${key}"]`);
    if (!cell) {
      cell = document.createElement("td");
      cell.className = "table-cell py-4 truncate w-[160px] extra-column";
      cell.dataset.key = key;
      const rowWrapper = row.querySelector("td:last-child").parentElement;
      rowWrapper.append(cell);
    }
    cell.textContent = value;

    // Apply green/red coloring for P/L columns
    if (key === "P/L $" || key === "P/L %") {
      if (value && value.startsWith("+")) {
        cell.style.color = "#22c55e"; // green
      } else if (value && value.startsWith("-")) {
        cell.style.color = "#ef4444"; // red
      } else {
        cell.style.color = ""; // reset
      }
    }
  });
}

export function updateColumns(mainTable, extraColumns) {
  const theadFirstRow = mainTable?.querySelector("thead tr");
  mainTable.querySelectorAll('.extra-column').forEach(element => {
    element.remove();
  });
  extraColumns.forEach((columnName, index) => {
    let th = theadFirstRow.querySelector(`.extra-column[data-key="${columnName}"]`);
    if (!th) {
      th = document.createElement("th");
      th.className = "group relative flex font-normal select-none items-center gap-x-1 text-left text-xs whitespace-nowrap w-[160px] extra-column";
      th.dataset.key = columnName;

      // Only add cursor/click handler if sorting is enabled
      if (isSortingEnabled()) {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';

        // Add click handler for sorting
        th.addEventListener('click', () => {
          handleColumnSort(th.dataset.key);
        });
      }

      const theadRowWrapper = theadFirstRow.querySelector("th:last-child").parentElement;
      theadRowWrapper.append(th);
    }

    // Set column text
    th.textContent = columnName;

    // Add sort indicator arrow (only if sorting is enabled)
    if (isSortingEnabled()) {
      addSortIndicatorToHeader(th, columnName);
    }
  });
}

export function onScrollUpdateTableHeaderAndNav() {
  if (window.location.pathname !== "/portfolio") {
    return;
  }
  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) {
    return;
  }
  const nav = document.querySelector("nav");
  const mainTableHeader = mainTable.querySelector("thead");
  const headerRect = mainTableHeader.getBoundingClientRect();
  const scrollContainer = mainTable.closest('.overflow-x-scroll');
  const stickyTopValue = 62;
  const navPosition = nav.style.getPropertyValue('position');
  const mainTableHeaderPosition = mainTableHeader.style.getPropertyValue('position');
  if (scrollContainer) {
    if (headerRect.top <= stickyTopValue) {
      // Don't change overflow-x - it causes scroll position reset
      navPosition !== 'fixed' && nav.style.setProperty('position', 'fixed');
      if(mainTableHeaderPosition !== 'sticky') {
        mainTableHeader.style.setProperty('position', 'sticky');
        mainTableHeader.style.setProperty('top', `${stickyTopValue}px`);
        mainTableHeader.style.setProperty('z-index', '400');
      }
    } else{
      navPosition === 'fixed' && nav.style.removeProperty('position');
      if(mainTableHeaderPosition === 'sticky') {
        mainTableHeader.style.removeProperty('position');
        mainTableHeader.style.removeProperty('top');
        mainTableHeader.style.removeProperty('z-index');
      }
    }
  }
}

export function setupScrollListener() {
  window.removeEventListener('scroll', onScrollUpdateTableHeaderAndNav);
  window.addEventListener('scroll', onScrollUpdateTableHeaderAndNav);
}

export function getElementsByText(str, tag = "a") {
  return Array.prototype.slice
    .call(document.getElementsByTagName(tag))
    .filter((el) => el.textContent.trim().includes(str.trim()));
} 