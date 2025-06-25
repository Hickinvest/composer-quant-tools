import { logPortfolioReturns } from "./utils/portfolioReturns.js";
import { startPortfolioTableInterval, updateTableRows, updateColumns, setupScrollListener, setExtraColumns } from "./utils/portfolioTable.js";
import { log } from "./utils/logger.js";

// Remove all table-specific logic from this file. Only keep portfolio orchestration and initialization.

chrome.storage.local.get(["addedColumns"], function (result) {
  if (result?.addedColumns?.length) {
    setExtraColumns(result?.addedColumns || []);
    log("extraColumns loaded:", result?.addedColumns || []);
  }
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace === "local" && changes.addedColumns) {
    log("extraColumns updated:", changes.addedColumns.newValue);
    setExtraColumns(changes.addedColumns.newValue);
    const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
    updateColumns(mainTable, changes.addedColumns.newValue);
    updateTableRows();
  }
});

export function initPortfolio() {
  setupScrollListener();
  startPortfolioTableInterval();
  logPortfolioReturns();
}

