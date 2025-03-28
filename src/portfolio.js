import { getTokenAndAccount } from "./utils/tokenAndAccountUtil.js";
import {
  addGeneratedSymphonyStatsToSymphony,
  addQuantstatsToSymphony,
} from "./utils/liveSymphonyPerformance.js";
import {log} from "./utils/logger.js";
import { makeApiCallWithCache } from "./utils/apiUtils.js";

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
export const performanceData = {};
window.composerQuantTools = {
  performanceData,
};

chrome.storage.local.get(["addedColumns"], function (result) {
  if (result?.addedColumns?.length) {
    extraColumns = result?.addedColumns || [];
    log("extraColumns loaded:", extraColumns);
  }
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === "local" && changes.addedColumns) {
    log("extraColumns updated:", changes.addedColumns.newValue);
    extraColumns = changes.addedColumns.newValue;
    // Perform any necessary actions with the updated selected languages
    const mainTable = document.querySelector("main table");
    updateColumns(mainTable, extraColumns);
    updateTableRows();
    Sortable.initTable(mainTable);
  }
});

export const startInterval = async () => {
  // Cache token on initial load
  await getTokenAndAccount();
  
  const checkInterval = setInterval(async () => {
    // Only proceed if we're on the portfolio page
    if (window.location.pathname !== "/portfolio") {
      return;
    }

    const mainTable = document.querySelector("main table");
    const portfolioChart = document.querySelector('[data-highcharts-chart], .border-graph-axislines');
    const mainTableContent = document.querySelectorAll("main table td");

    // If table doesn't exist yet, skip this interval
    if (!mainTable) {
      return;
    }

    // Check if table was re-rendered (lost all extra columns)
    if (mainTable.classList.contains('composer-quant-tools-initialized')) {
      const hasAnyExtraColumns = mainTable.querySelector('.extra-column');
      if (!hasAnyExtraColumns) {
        // Table was re-rendered, remove initialized class to trigger re-initialization
        mainTable.classList.remove('composer-quant-tools-initialized');
      }
    }

    // Initial setup if not done yet
    if (!mainTable.classList.contains('composer-quant-tools-initialized')) {
      // Check if DOM is ready for initial setup
      if (portfolioChart && mainTableContent) {
        mainTable.classList.add('composer-quant-tools-initialized');
        await startSymphonyPerformanceSync(mainTable);
      }
      return;
    }

    // Update rows if data exists but rows need updating
    if (performanceData?.symphonyStats?.symphonies?.length > 0) {
      const mainTableBody = mainTable.querySelector("tbody");
      const rows = mainTableBody?.querySelectorAll("tr .bg-sheet"); // Get all rows with data there are some that are just headers or spacer rows
      
      // Check if we have rows to update
      if (rows?.length > 0) {
        // Check if any row needs updating by looking for missing extra columns
        // or if number of extra columns doesn't match expected
        const needsUpdate = Array.from(rows).some(row => {
          const columnCells = row.querySelectorAll('.extra-column');
          // Check if we're missing columns or have wrong number of columns
          return columnCells.length !== extraColumns.length;
        });

        if (needsUpdate) {
          // Re-initialize columns in case they were removed
          updateColumns(mainTable, extraColumns);
          updateTableRows();
          Sortable.initTable(mainTable);
        }
      }
    }
  }, 1000); // Check every second

  // Cleanup on page unload
  window.addEventListener('unload', () => {
    clearInterval(checkInterval);
  });
};

const startSymphonyPerformanceSync = async (mainTable) => {
  const mainTableBody = mainTable.querySelectorAll("tbody")[0];
  
  // Initialize columns
  updateColumns(mainTable, extraColumns);
  
  // Initialize data
  const data = await getSymphonyPerformanceInfo({
    onSymphonyCallback: extendSymphonyStatsRow,
    skipCache: true,
  });

  if (!data) {
    log("no symphony performance data found");
    return;
  }
  
  // Process data
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

  // Update rows with data
  updateTableRows();
  
  // Initialize sorting
  Sortable.initTable(mainTable);
  

  log("all symphony stats added", performanceData);
};

function updateTableRows() {
  const mainTableBody = document.querySelector("main table tbody");
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

function extendSymphonyStatsRow(symphony) {
  const mainTableBody = document.querySelector("main table tbody");
  const rows = mainTableBody?.querySelectorAll("tr");

  for (let row of rows) {
    const nameTd = row.querySelector("td:first-child a");
    // const nameText = nameTd?.textContent?.trim?.();
    const symphonyId = nameTd?.href?.split?.('/')?.[4]
    if (symphonyId == symphony.id && symphony.addedStats) {
      updateRowStats(row, symphony.addedStats);
      break;
    }
  }
}

function updateRowStats(row, addedStats) {
  extraColumns.forEach((key, index) => {
    let value = addedStats[key];
    let cell = row.querySelector(`.extra-column[data-key="${key}"]`);
    
    if (!cell) {
      cell = document.createElement("td");
      cell.className = "table-cell py-4 truncate w-[160px] extra-column";
      // cell.style = "min-width: 10rem; max-width: 10rem;";
      cell.dataset.key = key;
      // I took this approach hoping that if the dom changes whatever the parent is to the current td's will be where we put them.
      const rowWrapper = row.querySelector("td:last-child").parentElement;
      rowWrapper.append(cell);
    }
    
    cell.textContent = value;
  });
}

function updateColumns(mainTable, extraColumns) {
  const theadFirstRow = mainTable?.querySelector("thead tr");
  
  // Remove extra columns that are no longer needed
  mainTable.querySelectorAll('.extra-column').forEach(element => {
    element.remove();
  });

  // Add or update columns
  extraColumns.forEach((columnName, index) => {
    let th = theadFirstRow.querySelector(`.extra-column[data-key="${columnName}"]`);
    if (!th) {
      th = document.createElement("th");
      th.className = "group relative flex font-normal select-none items-center gap-x-1 text-left text-xs whitespace-nowrap w-[160px] extra-column";
      th.setAttribute("data-sortable-type", "numeric");
      th.dataset.key = columnName;
      const theadRowWrapper = theadFirstRow.querySelector("th:last-child").parentElement;
      theadRowWrapper.append(th);
    }
    th.textContent = columnName;
  });
}

const TwoHours = 2 * 60 * 60 * 1000; // this should only update once per day ish base on a normal user's usage. It could happen multiple times if multiple windows are open. or if the user is refreshing every 12 hours.
let performanceDataFetchedAt = Date.now() - TwoHours;
export async function getSymphonyPerformanceInfo(options = {}) {
  const onSymphonyCallback = options.onSymphonyCallback;
  // if the last call options are the same as the current call options and was less than 2 hours ago, return the cached data
  if (performanceDataFetchedAt >= Date.now() - TwoHours && !options.skipCache) {
    for (const symphony of performanceData.symphonyStats.symphonies) {
      onSymphonyCallback?.(symphony);
    }
    return performanceData;
  }
  try {
    const accountDeploys = await getAccountDeploys();
    const symphonyStats = await getSymphonyStatsMeta();

    performanceData.accountDeploys = accountDeploys;
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
            TwoHours
          );
          addGeneratedSymphonyStatsToSymphony(symphony, accountDeploys);
          await addQuantstatsToSymphony(symphony, accountDeploys);
          
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
    
    // Update the timestamp to indicate successful data fetch
    performanceDataFetchedAt = Date.now();

    return performanceData;
  } catch (error) {
    log("Error getting symphony performance info", error);
  }
}

export async function getSymphonyDailyChange(
  symphonyId,
  cacheTimeout = 0,
  timeToWaitBeforeCall = 0,
) {
  const cacheKey = "composerQuantTools-" + symphonyId;
  const { token, account } = await getTokenAndAccount();
  
  // Use the new API utility with caching
  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphonies/${symphonyId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey,
        cacheTimeout,
      },
      `Get symphony daily change for ${symphonyId}`
    );
    
    return symphonyStats;
  } catch (error) {
    log(
      `Cannot load extension. symphonies/${symphonyId} endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }
}

async function getAccountDeploys(status = "SUCCEEDED") {
  const { token, account } = await getTokenAndAccount();

  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://trading-api.composer.trade/api/v1/deploy/accounts/${account.account_uuid}/deploys?status=${status}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey: `composerQuantTools-deploys-${status}`,
        cacheTimeout: TwoHours,
      },
      `Get account deploys with status ${status}`
    );
    
    return symphonyStats?.deploys;
  } catch (error) {
    log(
      `Cannot load extension. deploys endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }
}

export async function getSymphonyStatsMeta() {
  const { token, account } = await getTokenAndAccount();

  try {
    const symphonyStats = await makeApiCallWithCache(
      `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphony-stats-meta`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      {
        cacheKey: `composerQuantTools-symphony-stats-meta`,
        cacheTimeout: TwoHours,
      },
      `Get symphony stats meta`
    );
    
    return symphonyStats;
  } catch (error) {
    log(
      `Cannot load extension. symphony-stats endpoint returned an error`,
      error
    );
    const holdings = [];
    return {
      account,
      holdings,
    };
  }
}

// Add scroll watcher for table header
function onScrollUpdateTableHeaderAndNav() {
  if (window.location.pathname !== "/portfolio") {
    return;
  }
  const mainTable = document.querySelector("main table");
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
};



function getElementsByText(str, tag = "a") {
  return Array.prototype.slice
    .call(document.getElementsByTagName(tag))
    .filter((el) => el.textContent.trim().includes(str.trim()));
}

export function initPortfolio() {
  // Remove existing scroll listener if any
  window.removeEventListener('scroll', onScrollUpdateTableHeaderAndNav);
  // Add new scroll listener
  window.addEventListener('scroll', onScrollUpdateTableHeaderAndNav);
  startInterval();
}
