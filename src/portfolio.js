import { logPortfolioReturns } from "./utils/portfolioReturns.js";
import { startPortfolioTableInterval, updateTableRows, updateColumns, setupScrollListener, setExtraColumns, setSortingEnabled } from "./utils/portfolioTable.js";
import { log } from "./utils/logger.js";

// Remove all table-specific logic from this file. Only keep portfolio orchestration and initialization.

chrome.storage.local.get(["addedColumns", "enableColumnSorting"], function (result) {
  if (result?.addedColumns?.length) {
    setExtraColumns(result?.addedColumns || []);
    log("extraColumns loaded:", result?.addedColumns || []);
  }
  // Load column sorting setting (default to true if not set)
  const sortingEnabled = result?.enableColumnSorting ?? true;
  setSortingEnabled(sortingEnabled);
  log("enableColumnSorting loaded:", sortingEnabled);
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === "local" && changes.addedColumns) {
    log("extraColumns updated:", changes.addedColumns.newValue);
    setExtraColumns(changes.addedColumns.newValue);
    const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
    updateColumns(mainTable, changes.addedColumns.newValue);
    updateTableRows();
  }
  if (namespace === "local" && changes.enableColumnSorting) {
    log("enableColumnSorting updated:", changes.enableColumnSorting.newValue);
    setSortingEnabled(changes.enableColumnSorting.newValue ?? true);
    // Re-render the table columns to add/remove sort indicators
    const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
    if (mainTable) {
      chrome.storage.local.get(["addedColumns"], function (result) {
        updateColumns(mainTable, result?.addedColumns || []);
        updateTableRows();
      });
    }
  }
});

export function initPortfolio() {
  setupScrollListener();
  startPortfolioTableInterval();
  logPortfolioReturns();
}

