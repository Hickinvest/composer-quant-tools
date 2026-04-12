let cachedQuotes = {};
let currentSymphonyId = null;
let isUpdatingUI = false;
let currentSortDir = 'desc'; // 'asc' or 'desc'
let isSortingActive = false;

function getHoldingsTable() {
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) continue;
    
    const headerText = headerRow.textContent || '';
    if (headerText.includes('Current Price') && 
        headerText.includes('Quantity') && 
        headerText.includes('Market Value') &&
        headerText.includes('Current Allocation')) {
      return table;
    }
  }
  return null;
}

function getCurrentSymphonyId() {
  const url = window.location.href;
  const match = url.match(/\/symphony\/([^\/]+)/);
  return match ? match[1] : null;
}

function findTickerInRow(row) {
  const firstCell = row.querySelector('td:first-child');
  if (!firstCell) return null;
  
  const fontMediumDiv = firstCell.querySelector('div.font-medium');
  const text = fontMediumDiv ? fontMediumDiv.textContent.trim() : null;
  
  if (!text) return null;
  
  const tickerMatch = text.match(/^([A-Z][A-Z0-9]{1,6})$/);
  if (tickerMatch) {
    return tickerMatch[1].toUpperCase();
  }
  
  if (text.includes('Cash Remainder') || text.includes('US Dollar')) {
    return '$USD';
  }
  
  return null;
}

function formatTickerKey(ticker) {
  if (ticker === '$USD') return '$USD';
  return `EQUITIES::${ticker}//USD`;
}

function calculatePercentChange(currentPrice, previousPrice) {
  if (!currentPrice || !previousPrice || previousPrice === 0) return null;
  return ((currentPrice - previousPrice) / previousPrice) * 100;
}

function formatPercentChange(value) {
  if (value === null || value === undefined) return '-';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function updatePercentChangeColumn(holdingsTable) {
  if (!holdingsTable) return;
  
  const tbody = holdingsTable.querySelector('tbody');
  const thead = holdingsTable.querySelector('thead tr');
  if (!tbody || !thead) return;
  
  let th = thead.querySelector('th[data-column-id="Today\'s Change"]');
  if (!th) {
    th = document.createElement('th');
    th.className = 'py-2 text-left text-[12px] font-normal leading-4 tracking-[0.24px] text-black/70 whitespace-nowrap align-middle cursor-pointer select-none extra-column';
    th.dataset.columnId = "Today's Change";
    
    th.innerHTML = `
      <div class="flex items-center gap-1">
        <span>Today's Change</span>
        <span class="flex flex-col items-center justify-center gap-px pt-px sort-arrows">
          <span class="h-0 w-0 border-b-[4px] border-x-[3px] border-x-transparent arrow-up" style="border-bottom-color: rgba(0, 0, 0, 0.25);"></span>
          <span class="h-0 w-0 border-t-[4px] border-x-[3px] border-x-transparent arrow-down" style="border-top-color: rgba(0, 0, 0, 0.25);"></span>
        </span>
      </div>
    `;

    th.addEventListener('click', (e) => {
      e.stopPropagation();
      currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
      isSortingActive = true;
      
      // Clear native sort indicators in holdings table
      const thead = th.closest('thead');
      if (thead) {
        thead.querySelectorAll('th:not(.extra-column) span[style*="border"]').forEach(arrow => {
          arrow.style.borderBottomColor = 'rgba(0, 0, 0, 0.25)';
          arrow.style.borderTopColor = 'rgba(0, 0, 0, 0.25)';
        });
      }
      
      refreshTable();
    });

    // Listen for native column clicks to reset our state
    thead.addEventListener('click', (e) => {
      const clickedTh = e.target.closest('th');
      if (clickedTh && !clickedTh.classList.contains('extra-column')) {
        isSortingActive = false;
        refreshTable();
      }
    });
    
    const headers = Array.from(thead.querySelectorAll('th'));
    if (headers.length >= 5) {
      headers[4].after(th);
    } else if (headers.length > 0) {
      thead.insertBefore(th, headers[headers.length - 1]);
    } else {
      thead.appendChild(th);
    }
  }

  // Update arrows in header
  const up = th.querySelector('.arrow-up');
  const down = th.querySelector('.arrow-down');
  if (up && down) {
    if (isSortingActive) {
      up.style.borderBottomColor = currentSortDir === 'asc' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.25)';
      down.style.borderTopColor = currentSortDir === 'desc' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.25)';
    } else {
      up.style.borderBottomColor = 'rgba(0, 0, 0, 0.25)';
      down.style.borderTopColor = 'rgba(0, 0, 0, 0.25)';
    }
  }
  
  const rows = tbody.querySelectorAll('tr');
  rows.forEach(row => {
    let td = row.querySelector('td[data-column-id="Today\'s Change"]');
    if (!td) {
      const cells = Array.from(row.querySelectorAll('td'));
      td = document.createElement('td');
      td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column';
      td.dataset.columnId = "Today's Change";
      
      if (cells.length >= 5) {
        cells[4].after(td);
      } else if (cells.length > 0) {
        row.insertBefore(td, cells[cells.length - 1]);
      } else {
        row.appendChild(td);
      }
    }
    
    const ticker = findTickerInRow(row);
    if (!ticker) {
      td.textContent = '-';
      td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column';
      return;
    }
    
    const tickerKey = formatTickerKey(ticker);
    const quoteData = cachedQuotes[tickerKey];
    
    if (quoteData && quoteData.price !== undefined && quoteData.previous_price !== undefined) {
      const change = calculatePercentChange(quoteData.price, quoteData.previous_price);
      const formatted = formatPercentChange(change);
      
      if (td.textContent !== formatted) {
        td.textContent = formatted;
        
        if (change > 0) {
          td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column text-green-600';
        } else if (change < 0) {
          td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column text-red-600';
        } else {
          td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column';
        }
      }
    } else {
      td.textContent = '-';
      td.className = 'py-3 w-40 text-left border-b border-data-table-border extra-column';
    }
  });
}

function refreshTable() {
  if (isUpdatingUI) return;
  const table = getHoldingsTable();
  if (!table) return;
  
  isUpdatingUI = true;
  try {
    updatePercentChangeColumn(table);

    if (isSortingActive) {
      sortHoldingsRows(table);
    }
  } finally {
    setTimeout(() => {
      isUpdatingUI = false;
    }, 150);
  }
}

function sortHoldingsRows(table) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  rows.sort((a, b) => {
    const cellA = a.querySelector('td[data-column-id="Today\'s Change"]');
    const cellB = b.querySelector('td[data-column-id="Today\'s Change"]');
    
    const valA = cellA?.textContent?.trim() || "-";
    const valB = cellB?.textContent?.trim() || "-";
    
    if (valA === "-") return 1;
    if (valB === "-") return -1;
    
    const numA = parseFloat(valA.replace(/[^0-9.-]/g, ""));
    const numB = parseFloat(valB.replace(/[^0-9.-]/g, ""));
    
    if (isNaN(numA)) return 1;
    if (isNaN(numB)) return -1;
    
    return currentSortDir === 'asc' ? numA - numB : numB - numA;
  });
  
  rows.forEach(row => tbody.appendChild(row));
}

function initHoldingsTable() {
  const checkSymphonyChange = () => {
    const newSymphonyId = getCurrentSymphonyId();
    if (newSymphonyId && newSymphonyId !== currentSymphonyId) {
      currentSymphonyId = newSymphonyId;
      cachedQuotes = {};
    }
  };

  setInterval(checkSymphonyChange, 1000);
  
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'QUOTES_DATA_INTERCEPTED') {
      if (event.data.data && typeof event.data.data === 'object') {
        cachedQuotes = { ...cachedQuotes, ...event.data.data };
        refreshTable();
        setTimeout(refreshTable, 500);
      }
    }
  });
  
  const observer = new MutationObserver((mutations) => {
    if (isUpdatingUI) return;
    
    const hasMeaningfulChange = mutations.some(m => {
      const isOurElement = m.target.classList?.contains?.('extra-column') || 
                          m.target.parentElement?.classList?.contains?.('extra-column');
      if (isOurElement) return false;
      
      const isTablePart = m.target.nodeName === 'TABLE' || 
                         m.target.nodeName === 'TBODY' || 
                         m.target.nodeName === 'THEAD' ||
                         m.target.nodeName === 'TR' ||
                         m.target.closest?.('table');
                        
      return isTablePart && (m.type === 'childList' || m.type === 'characterData');
    });
    
    if (hasMeaningfulChange) {
      checkSymphonyChange();
      refreshTable();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  
  checkSymphonyChange();
  setTimeout(refreshTable, 1000);
  setTimeout(refreshTable, 2000);
  setTimeout(refreshTable, 3000);
}

export function initHoldingsTableModule() {
  initHoldingsTable();
}