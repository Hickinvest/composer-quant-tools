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

// Stricter parent-row ID extraction: only considers the first cell link.
// This avoids false positives from symphony links inside nested tables (e.g. expanded detail pane).
function getPrimarySymphonyIdFromRow(row) {
  const primaryLink = row.querySelector(":scope > td:first-child a[href*='/symphony/']");
  if (primaryLink) {
    const match = primaryLink.href.match(/\/symphony\/([^\/]+)/);
    if (match) return match[1];
  }
  return null;
}

function isExpandableDetailRow(row) {
  // Composer's expandable "Holdings / History" pane row often has these classes,
  // but we keep this heuristic flexible to survive minor DOM changes.
  if (row.matches?.("tr.bg-white.border-b.w-full")) return true;

  // Detail rows often have a single cell spanning the full table width.
  const tdColspan = row.querySelector?.("td[colspan]");
  if (tdColspan) return true;

  return false;
}

function groupRowsByParent(tbody) {
  const rows = Array.from(tbody.querySelectorAll("tr"));

  /** @type {Array<{ id: string|null, row: HTMLTableRowElement }>} */
  const parents = [];
  /** @type {Map<string, HTMLTableRowElement[]>} */
  const childrenByParentId = new Map();
  /** @type {HTMLTableRowElement[]} */
  const orphanChildren = [];

  let currentParentId = null;

  for (const row of rows) {
    const id = getSymphonyIdFromRow(row);
    if (id) {
      // Mark the parent row with a stable id so we can tie detail rows to it.
      row.dataset.cqtSymphonyId = id;
      currentParentId = id;
      parents.push({ id, row });
      continue;
    }

    // Only treat certain "unknown" rows as expandable detail rows; otherwise leave as orphan.
    if (isExpandableDetailRow(row)) {
      const parentId = row.dataset.cqtParentSymphonyId || currentParentId;
      if (parentId) {
        row.dataset.cqtParentSymphonyId = parentId;
        const bucket = childrenByParentId.get(parentId) || [];
        bucket.push(row);
        childrenByParentId.set(parentId, bucket);
      } else {
        orphanChildren.push(row);
      }
      continue;
    }

    // Unknown/non-symphony rows (rare). Preserve them but don't sort them.
    orphanChildren.push(row);
  }

  return { parents, childrenByParentId, orphanChildren };
}

function escapeAttrValue(value) {
  return String(value).replaceAll('"', '\\"');
}

// Track current sort state
let currentSortColumn = null;
let currentSortDirection = 'desc'; // 'asc' or 'desc'
let nativeColumnListenerAdded = false;
let originalRowOrder = []; // Store original row order to restore when switching to native sort
let sortingEnabled = true; // Can be toggled via settings
let tableObserver = null; // MutationObserver to watch for Composer updates
let reapplySortTimeout = null; // Debounce timer for re-applying sort
let lastExpandClick = { symphonyId: null, at: 0 }; // Track last expand click to re-parent new detail rows
let suppressObserverReactions = false; // Prevent loops when we move rows ourselves
let lastCustomSortAppliedAt = 0; // Throttle observer-triggered resorting

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

  const { parents, childrenByParentId, orphanChildren } = groupRowsByParent(tbody);

  // Sort parent rows back to original order using robust ID extraction
  parents.sort((a, b) => {
    const indexA = originalRowOrder.indexOf(a.id);
    const indexB = originalRowOrder.indexOf(b.id);
    return indexA - indexB;
  });

  // Reorder in DOM: parent row + its detail rows (if any)
  suppressObserverReactions = true;
  try {
    for (const parent of parents) {
      tbody.appendChild(parent.row);
      const kids = childrenByParentId.get(parent.id);
      if (kids?.length) {
        kids.forEach(kid => tbody.appendChild(kid));
      }
    }

    // Preserve any orphan rows (non-symphony or unmatched detail rows)
    orphanChildren.forEach(row => tbody.appendChild(row));
  } finally {
    suppressObserverReactions = false;
  }
  log('Restored original row order');
}

// Clear captured row order (call when table is re-rendered)
export function clearOriginalRowOrder() {
  originalRowOrder = [];
}

// Set up observer to watch for Composer table updates and re-apply our sort
export function setupTableObserver() {
  if (tableObserver) return; // Already set up

  const mainTable = document.querySelector("main :not(.tv-lightweight-charts) > table");
  if (!mainTable) return;

  const tbody = mainTable.querySelector("tbody");
  if (!tbody) return;

  // Capture clicks inside the table body so we can associate newly inserted
  // expandable detail rows with the symphony row that triggered them.
  tbody.addEventListener('click', (e) => {
    // Only treat button clicks as "expand intent" to avoid capturing clicks inside
    // the expanded subtable (which can cause mis-association).
    const clickedButton = e.target?.closest?.('button,[role="button"]');
    if (!clickedButton) return;

    const clickedRow = e.target?.closest?.('tr');
    if (!clickedRow) return;
    const symphonyId = getSymphonyIdFromRow(clickedRow);
    if (!symphonyId) return;
    clickedRow.dataset.cqtSymphonyId = symphonyId;
    lastExpandClick = { symphonyId, at: Date.now() };
  }, true);

  tableObserver = new MutationObserver((mutations) => {
    if (suppressObserverReactions) return;

    // If Composer inserts an expandable detail row (often based on pre-sort index),
    // immediately move it under the most recently clicked symphony row.
    const addedDetailRows = [];
    let sawParentRowAddRemove = false;
    for (const m of mutations) {
      if (m.type !== 'childList' || m.target?.tagName !== 'TBODY') continue;
      for (const node of m.addedNodes || []) {
        if (node?.nodeType === 1 && node.tagName === 'TR') {
          if (isExpandableDetailRow(node)) {
            addedDetailRows.push(node);
          } else if (getPrimarySymphonyIdFromRow(node)) {
            sawParentRowAddRemove = true;
          }
        }
      }
      for (const node of m.removedNodes || []) {
        if (node?.nodeType === 1 && node.tagName === 'TR' && getPrimarySymphonyIdFromRow(node)) {
          sawParentRowAddRemove = true;
        }
      }
    }

    if (addedDetailRows.length && lastExpandClick.symphonyId) {
      // Only trust the click for a short window so we don't mis-associate unrelated inserts.
      const isRecentClick = (Date.now() - lastExpandClick.at) < 1500;
      if (isRecentClick) {
        const parentId = lastExpandClick.symphonyId;
        const parentRow =
          tbody.querySelector(`tr[data-cqt-symphony-id="${escapeAttrValue(parentId)}"]`) ||
          Array.from(tbody.querySelectorAll('tr')).find(r => getSymphonyIdFromRow(r) === parentId);

        if (parentRow) {
          suppressObserverReactions = true;
          try {
            for (const detailRow of addedDetailRows) {
              detailRow.dataset.cqtParentSymphonyId = parentId;
              parentRow.insertAdjacentElement('afterend', detailRow);
            }
          } finally {
            suppressObserverReactions = false;
          }
        }
      }
    }

    // Re-apply our sort only when Composer adds/removes whole parent rows
    // (not when cell text changes or expandable pane contents load).
    if (sawParentRowAddRemove && currentSortColumn && sortingEnabled) {
      // Hard throttle: Composer can be chatty; don't sort more than ~1x/sec.
      const now = Date.now();
      if (now - lastCustomSortAppliedAt < 1000) return;

      if (reapplySortTimeout) clearTimeout(reapplySortTimeout);
      reapplySortTimeout = setTimeout(() => {
        log('Composer updated table, re-applying sort');
        sortTableByColumn(currentSortColumn, currentSortDirection);
      }, 400);
    }
  });

  tableObserver.observe(tbody, {
    childList: true
  });

  log('Table observer set up for sort persistence');
}

// Clean up observer (call when navigating away)
export function cleanupTableObserver() {
  if (tableObserver) {
    tableObserver.disconnect();
    tableObserver = null;
  }
  if (reapplySortTimeout) {
    clearTimeout(reapplySortTimeout);
    reapplySortTimeout = null;
  }
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

  const { parents, childrenByParentId, orphanChildren } = groupRowsByParent(tbody);

  parents.sort((a, b) => {
    const cellA = a.row.querySelector(`.extra-column[data-key="${columnKey}"]`);
    const cellB = b.row.querySelector(`.extra-column[data-key="${columnKey}"]`);

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

  // Reorder in DOM: parent row + its detail rows (if any)
  suppressObserverReactions = true;
  try {
    for (const parent of parents) {
      tbody.appendChild(parent.row);
      const kids = childrenByParentId.get(parent.id);
      if (kids?.length) {
        kids.forEach(kid => tbody.appendChild(kid));
      }
    }

    // Preserve any orphan rows (non-symphony or unmatched detail rows)
    orphanChildren.forEach(row => tbody.appendChild(row));
  } finally {
    suppressObserverReactions = false;
  }
  lastCustomSortAppliedAt = Date.now();

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
