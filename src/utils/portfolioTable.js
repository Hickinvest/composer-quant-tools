// Table-specific logic for the portfolio page
import { performanceData, getSymphonyDailyChange, getAccountDeploys, getSymphonyStatsMeta, getSymphonyActivityHistory } from "../apiService.js";
import { addGeneratedSymphonyStatsToSymphony, addQuantstatsToSymphony, addGeneratedSymphonyStatsToSymphonyWithModifiedDietz } from "./liveSymphonyPerformance.js";
import { log } from "./logger.js";

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
          updateTableRows();
        }
      }
    }
  }, 1000);
  window.addEventListener('unload', () => {
    clearInterval(checkInterval);
  });
};

export const startSymphonyPerformanceSync = async (mainTable) => {
  updateColumns(mainTable, extraColumns);
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

    // Process symphonies in batches
    const batchSize = 5; // Process 5 symphonies at a time
    const symphonies = [...symphonyStats.symphonies];
    
    // Process symphonies in batches
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
          await addQuantstatsToSymphony(symphony, []);
          
          // Update the symphony in the performanceData
          const symphonyIndex = performanceData.symphonyStats.symphonies.findIndex(s => s.id === symphony.id);
          if (symphonyIndex !== -1) {
            performanceData.symphonyStats.symphonies[symphonyIndex] = symphony;
            
            // Send updated data to MAIN world (throttled to avoid too many messages)
            // this is used by assetAllocationCharts.js
            clearTimeout(window.performanceDataUpdateTimeout);
            window.performanceDataUpdateTimeout = setTimeout(() => {
              window.postMessage({
                type: 'COMPOSER_QUANT_TOOLS_CHART_DATA',
                source: 'composer-quant-tools-isolated',
                data: performanceData
              }, '*');
            }, 100);
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
    
    // Update the timestamp to indicate successful data fetch
    performanceDataFetchedAt = Date.now();

    // Send performance data to MAIN world for chart rendering
    window.postMessage({
      type: 'COMPOSER_QUANT_TOOLS_CHART_DATA',
      source: 'composer-quant-tools-isolated',
      data: performanceData
    }, '*');

    return performanceData;
  } catch (error) {
    log("Error getting symphony performance info", error);
  }
}

export function updateTableRows() {
  const mainTableBody = document.querySelector("main :not(.tv-lightweight-charts) > table tbody");
  const rows = mainTableBody?.querySelectorAll("tr");
  performanceData?.symphonyStats?.symphonies?.forEach?.((symphony) => {
    if (symphony.addedStats) {
      for (let row of rows) {
        const nameTd = row.querySelector("td:first-child .truncate[href]");
        const nameText = nameTd?.textContent?.trim?.();
        if (nameText == symphony.name) {
          updateRowStats(row, symphony.addedStats);
          break;
        }
      }
    }
  });
}

export function extendSymphonyStatsRow(symphony) {
  const mainTableBody = document.querySelector("main :not(.tv-lightweight-charts) > table tbody");
  const rows = mainTableBody?.querySelectorAll("tr");
  for (let row of rows) {
    const nameTd = row.querySelector("td:first-child a");
    const symphonyId = nameTd?.href?.split?.('/')?.[4];
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
      const theadRowWrapper = theadFirstRow.querySelector("th:last-child").parentElement;
      theadRowWrapper.append(th);
    }
    th.textContent = columnName;
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
  const overflowXValue = parseInt(mainTableHeader.style.getPropertyValue('overflow-x'));
  const navPosition = nav.style.getPropertyValue('position');
  const mainTableHeaderPosition = mainTableHeader.style.getPropertyValue('position');
  if (scrollContainer) {
    if (headerRect.top <= stickyTopValue) {
      overflowXValue !== 'unset' && scrollContainer.style.setProperty('overflow-x', 'unset', 'important');
      navPosition !== 'fixed' && nav.style.setProperty('position', 'fixed');
      if(mainTableHeaderPosition !== 'sticky') {
        mainTableHeader.style.setProperty('position', 'sticky');
        mainTableHeader.style.setProperty('top', `${stickyTopValue}px`);
        mainTableHeader.style.setProperty('z-index', '400');
      }
    } else{
      overflowXValue !== 'scroll' && scrollContainer.style.removeProperty('overflow-x');
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