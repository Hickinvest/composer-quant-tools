// Table sorting utility for the portfolio page
// Note: Sorting by custom columns may cause issues with Composer's expandable
// "Holdings / History" pane. The pane position is based on row index, so sorting
// can cause the pane to appear in the wrong position or move to the bottom.

import { log } from "./logger.js";

// Helper to extract symphony ID from a row (handles various row states)
function getSymphonyIdFromRow(row) {
  // Primary: Try to get ID from the symphony link in first cell
  const primaryLink = row.querySelector("td:first-child a[href*='/symphony/']");
  if (primaryLink) {
    const match = primaryLink.href.match(/\/symphony\/([^\/]+)/);
    if (match) return match[1];
  }

  // Fallback: Look for any symphony link in the row
  const anyLink = row.querySelector("a[href*='/symphony/']");
  if (anyLink) {
    const match = anyLink.href.match(/\/symphony\/([^\/]+)/);
    if (match) return match[1];
  }

  return null;
}

// Track current sort state
let currentSortColumn = null;
let currentSortDirection = 'desc'; // 'asc' or 'desc'
let nativeColumnListenerAdded = false;
let originalRowOrder = []; // Store original row order to restore when switching to native sort
let sortingEnabled = true; // Can be toggled via settings

// Getter/setter for sorting enabled state
export function setSortingEnabled(enabled) {
  sortingEnabled = enabled;
  log('Table sorting ' + (enabled ? 'enabled' : 'disabled'));
}

export function isSortingEnabled() {
  return sortingEnabled;
}

// Getter/setter for current sort state (for external use)
export function getCurrentSortColumn() {
  return currentSortColumn;
}

export function getCurrentSortDirection() {
  return currentSortDirection;
}

export function resetSortState() {
  currentSortColumn = null;
  currentSortDirection = 'desc';
}

// Store the current row order (call this before any sorting)
export function captureOriginalRowOrder() {
  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  const tbody = mainTable.querySelector("tbody");
  if (!tbody) return;

  // Only capture if we haven't already or if order is empty
  if (originalRowOrder.length === 0) {
    originalRowOrder = Array.from(tbody.querySelectorAll("tr")).map(row => {
      return getSymphonyIdFromRow(row); // Use robust ID extraction
    }).filter(Boolean);
    log('Captured original row order:', originalRowOrder.length, 'rows');
  }
}

// Restore rows to original order (before native sort)
export function restoreOriginalRowOrder() {
  if (originalRowOrder.length === 0) return;

  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  const tbody = mainTable.querySelector("tbody");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  // Sort rows back to original order using robust ID extraction
  rows.sort((a, b) => {
    const idA = getSymphonyIdFromRow(a);
    const idB = getSymphonyIdFromRow(b);

    const indexA = originalRowOrder.indexOf(idA);
    const indexB = originalRowOrder.indexOf(idB);

    return indexA - indexB;
  });

  // Reorder in DOM
  rows.forEach(row => tbody.appendChild(row));
  log('Restored original row order');
}

// Clear captured row order (call when table is re-rendered)
export function clearOriginalRowOrder() {
  originalRowOrder = [];
}

// Reset our sort state and refresh data when native columns are sorted
export function setupNativeColumnListener(updateTableRowsCallback) {
  if (nativeColumnListenerAdded) return;

  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  const thead = mainTable.querySelector("thead");
  if (!thead) return;

  // Capture initial row order
  captureOriginalRowOrder();

  thead.addEventListener('click', (e) => {
    const clickedTh = e.target.closest('th');
    // If clicked on a native column (not our extra columns)
    if (clickedTh && !clickedTh.classList.contains('extra-column')) {
      log('Native column clicked, resetting sort state and refreshing data');

      // Restore original row order so Composer can sort correctly
      restoreOriginalRowOrder();

      // Reset our sort state
      currentSortColumn = null;
      currentSortDirection = 'desc';

      // Update arrow indicators to show inactive state
      updateAllColumnArrows();

      // Wait a moment for Composer to finish sorting, then refresh our data
      setTimeout(() => {
        // Capture the new order after Composer sorts
        originalRowOrder = [];
        captureOriginalRowOrder();
        if (updateTableRowsCallback) {
          updateTableRowsCallback();
        }
      }, 150);
    }
  });

  nativeColumnListenerAdded = true;
  log('Native column listener added');
}

// Sort table by a specific column
export function sortTableByColumn(columnKey, direction = 'desc') {
  if (!sortingEnabled) {
    log('Sorting is disabled');
    return;
  }

  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  const tbody = mainTable.querySelector("tbody");
  if (!tbody) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {
    const cellA = a.querySelector(`.extra-column[data-key="${columnKey}"]`);
    const cellB = b.querySelector(`.extra-column[data-key="${columnKey}"]`);

    let valueA = cellA?.textContent?.trim() || '';
    let valueB = cellB?.textContent?.trim() || '';

    // Parse percentage values (remove % sign)
    if (valueA.endsWith('%')) valueA = valueA.slice(0, -1);
    if (valueB.endsWith('%')) valueB = valueB.slice(0, -1);

    // Convert to numbers for numeric comparison
    const numA = parseFloat(valueA) || 0;
    const numB = parseFloat(valueB) || 0;

    if (direction === 'asc') {
      return numA - numB;
    } else {
      return numB - numA;
    }
  });

  // Reorder rows in the DOM
  rows.forEach(row => tbody.appendChild(row));

  // Update sort state
  currentSortColumn = columnKey;
  currentSortDirection = direction;

  // Update visual sort indicators on headers
  updateSortIndicators(columnKey, direction);

  log(`Sorted by ${columnKey} (${direction})`);
}

// Handle column header click for sorting
export function handleColumnSort(columnKey) {
  if (!sortingEnabled) return;

  // Toggle direction if clicking same column, otherwise default to desc
  if (currentSortColumn === columnKey) {
    currentSortDirection = currentSortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    currentSortDirection = 'desc';
  }
  currentSortColumn = columnKey;
  sortTableByColumn(columnKey, currentSortDirection);
}

// Update visual sort indicators on headers
export function updateSortIndicators(activeColumn, direction) {
  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  // Update all extra column arrows
  mainTable.querySelectorAll('thead .extra-column').forEach(th => {
    const columnKey = th.dataset.key;
    let indicator = th.querySelector('.sort-indicator');

    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.style.marginLeft = '4px';
      indicator.style.fontSize = '10px';
      th.appendChild(indicator);
    }

    if (columnKey === activeColumn) {
      // Active column - solid arrow
      indicator.textContent = direction === 'asc' ? '\u25B2' : '\u25BC';
      indicator.style.opacity = '1';
    } else {
      // Inactive column - faded arrow
      indicator.textContent = '\u25BC';
      indicator.style.opacity = '0.3';
    }
  });
}

// Show all arrows as faded (no active sort)
export function updateAllColumnArrows() {
  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  mainTable.querySelectorAll('thead .extra-column').forEach(th => {
    let indicator = th.querySelector('.sort-indicator');

    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.style.marginLeft = '4px';
      indicator.style.fontSize = '10px';
      th.appendChild(indicator);
    }

    // All faded
    indicator.textContent = '\u25BC';
    indicator.style.opacity = '0.3';
  });
}

// Add sort indicator to a column header element
export function addSortIndicatorToHeader(th, columnKey) {
  if (!sortingEnabled) return;

  const indicator = document.createElement('span');
  indicator.className = 'sort-indicator';
  indicator.style.marginLeft = '4px';
  indicator.style.fontSize = '10px';

  if (currentSortColumn === columnKey) {
    // Active column - solid arrow
    indicator.textContent = currentSortDirection === 'asc' ? '\u25B2' : '\u25BC';
    indicator.style.opacity = '1';
  } else {
    // Inactive column - faded arrow
    indicator.textContent = '\u25BC';
    indicator.style.opacity = '0.3';
  }
  th.appendChild(indicator);
}
