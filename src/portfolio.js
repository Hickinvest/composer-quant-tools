import { getTokenAndAccount } from "./utils/tokenAndAccountUtil.js";
import {
  addGeneratedSymphonyStatsToSymphony,
  addQuantstatsToSymphony,
} from "./utils/liveSymphonyPerformance.js";
import {log} from "./utils/logger.js";

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
      const rows = mainTableBody?.querySelectorAll("tr");
      
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
  const thead = mainTable.querySelector("thead tr");
  
  // Remove extra columns that are no longer needed
  mainTable.querySelectorAll('.extra-column').forEach(element => {
    element.remove();
  });

  // Add or update columns
  extraColumns.forEach((columnName, index) => {
    let th = thead.querySelector(`.extra-column[data-key="${columnName}"]`);
    if (!th) {
      th = document.createElement("th");
      th.className = "group relative flex font-normal select-none items-center gap-x-1 text-left text-xs whitespace-nowrap w-[160px] extra-column";
      th.setAttribute("data-sortable-type", "numeric");
      th.dataset.key = columnName;
      // I took this approach hoping that if the dom changes whatever the parent is to the current td's will be where we put them.
      const theadRowWrapper = thead.querySelector("th:last-child").parentElement;
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
    for (const symphony of symphonyStats.symphonies) {
      onSymphonyCallback?.(symphony);
    }
    return performanceData;
  }
  try {

    const accountDeploys = await getAccountDeploys();
    const symphonyStats = await getSymphonyStatsMeta();

    performanceData.accountDeploys = accountDeploys;
    performanceData.symphonyStats = symphonyStats;

    await Promise.all(symphonyStats.symphonies.map(async (symphony) => {
      try {
        symphony.dailyChanges = await getSymphonyDailyChange(
          symphony.id,
          TwoHours,
          200,
        );
        addGeneratedSymphonyStatsToSymphony(symphony, accountDeploys);
        await addQuantstatsToSymphony(symphony, accountDeploys);
        // find the symphony in the array and update it by id
        const symphonyIndex = performanceData.symphonyStats.symphonies.findIndex(s => s.id === symphony.id);
        if (symphonyIndex !== -1) {
          performanceData.symphonyStats.symphonies[symphonyIndex] = symphony;
        }
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
  const cachedData = localStorage.getItem(cacheKey);

  if (cachedData) {
    const { data, timestamp } = JSON.parse(cachedData);
    const cacheTimeoutAgo = Date.now() - cacheTimeout;

    if (timestamp > cacheTimeoutAgo) {
      return data;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, timeToWaitBeforeCall)); // timeToWaitBeforeCall-ms delay this is 2 calls per second. we may need to decrease this for rate limiting

  const { token, account } = await getTokenAndAccount();

  const response = await fetch(
    `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphonies/${symphonyId}`, // symphony value over time on each day
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 200) {
    log(
      `Cannot load extension. symphonies/${symphonyId} endpoint returned a ${response.status} error code.`,
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }

  const symphonyStats = await response.json();

  localStorage.setItem(
    cacheKey,
    JSON.stringify({
      data: symphonyStats,
      timestamp: Date.now(),
    }),
  );

  return symphonyStats;
}

async function getAccountDeploys(status = "SUCCEEDED") {
  const { token, account } = await getTokenAndAccount();

  const response = await fetch(
    `https://trading-api.composer.trade/api/v1/deploy/accounts/${account.account_uuid}/deploys?status=${status}`, // all user initiated symphony cash allocation changes
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 200) {
    log(
      `Cannot load extension. deploys endpoint returned a ${response.status} error code.`,
    );
    const holdings = [];
    return {
      account,
      holdings,
      token,
    };
  }

  const symphonyStats = await response.json();
  return symphonyStats?.deploys;
}

export async function getSymphonyStatsMeta() {
  const { token, account } = await getTokenAndAccount();

  const response = await fetch(
    `https://stagehand-api.composer.trade/api/v1/portfolio/accounts/${account.account_uuid}/symphony-stats-meta`, // all current symphony info
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (response.status !== 200) {
    log(
      `Cannot load extension. symphony-stats endpoint returned a ${response.status} error code.`,
    );
    const holdings = [];
    return {
      account,
      holdings,
    };
  }

  const symphonyStats = await response.json();
  return symphonyStats;
}

function getElementsByText(str, tag = "a") {
  return Array.prototype.slice
    .call(document.getElementsByTagName(tag))
    .filter((el) => el.textContent.trim().includes(str.trim()));
}

export function initPortfolio() {
  startInterval();
}
