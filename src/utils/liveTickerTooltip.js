// This utility script is used to show a tooltip with the full name of 
// an equity when hovering over its ticker symbol.

(()=>{
  const API_URL = 'https://stagehand-api.composer.trade/api/v1/public/quotes';
  const tickerParentSelectors = [
    '.table-fixed tr td:first-child', // table cells (portfolio page)
    'table tr td:first-child', // table cells (Symphony Tools extension's table)
    '.table-auto tr td:first-child', // table cells
    '.table-auto tr th', // backtest historical allocations table
    '.blk--subsym', // symphony details and edit page group title
    '.blk--function', // symphony details and edit page rule block if/else functions
    '.blk--asset', // symphony details and edit page rule block assets
    '.table-cell .bg-base-dark.rounded', // dark ticker labels - holdings, history, trade previews
  ];

  // invalid tickers that may be picked up by the regex
  const ignoredTickers = [
    'IF',
    'ELSE',
    'THEN',
    'WEIGHT',
    'U.S',
    'ETF',
  ];

  let enableTooltips = true;
  let enableCmdClick = true;

  //----------------------------------------------

  let tickerCache = {};
  try {
    tickerCache = JSON.parse(localStorage.getItem('tickerCache')) || {};
  } catch (e) {
    log('Error parsing ticker cache', e);
  }

  function eq(obj1, obj2) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  function createOrGetTooltip(event) {
    let tooltip = document.querySelector('.liveTickerTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'liveTickerTooltip';
      document.body.appendChild(tooltip);

      function positionTooltip(event) {
        window.requestAnimationFrame(()=>{
          const tooltipWidth = tooltip.offsetWidth;
          const tooltipHeight = tooltip.offsetHeight;
        
          // Calculate the new position
          let left = event.clientX + 10;
          let top = event.clientY + 10;
        
          // Check for viewport boundaries
          if (left + tooltipWidth + 10 > window.innerWidth) {
            left = window.innerWidth - tooltipWidth - 10; // 10px padding from the right
          }
          if (top + tooltipHeight + 10 > window.innerHeight) {
            top = window.innerHeight - tooltipHeight - 10; // 10px padding from the bottom
          }

          // Set the tooltip position
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        })
      }
      document.addEventListener('mousemove', positionTooltip);
      positionTooltip(event); // initial position
    }

    return tooltip;
  }

  function setToolTipVisible(isVisible = true) {
    const tooltip = document.querySelector('.liveTickerTooltip');
    if (tooltip) {
      if (isVisible) {
        tooltip.classList.remove('hidden');
      } else {
        tooltip.classList.add('hidden');
      }
    }
  }

  let lastTickersFromElement = null;
  function getTickersFromElement(tickerElement) {
    let matches;

    const TICKER_REGEX = /\b[A-Z][A-Z0-9\.\/]{1,6}\b/g; // do we need to include numbers?
    const ignoredTextContents = [
      'Cash Remainder',
      'US Dollar',
    ];

    const parentElement = tickerElement?.closest(tickerParentSelectors.join(', '));
    if (parentElement) {
      const isIgnored = ignoredTextContents.some(
        text => tickerElement?.innerText?.match(text, 'gi')
      );
      if (!isIgnored) {
        matches = tickerElement?.innerText?.match(TICKER_REGEX);
      }
    }
    const tickers = matches ? matches?.map(match => match.trim().toUpperCase()) : [];
    const filteredTickers = tickers.filter(ticker => !ignoredTickers.includes(ticker));
    const uniqueTickers = Array.from(new Set(filteredTickers));
    return uniqueTickers;
  }

  function showTooltip(tickers, event) {
    if (!tickers?.length) {
      setToolTipVisible(false);
      return;
    }

    // Create and position the new tooltip
    const tooltip = createOrGetTooltip(event);
    setToolTipVisible(true);
    tooltip.innerHTML = '<div class="spinner"></div>'; // Spinner while loading

    let dataPromises = [];
    tickers.forEach(ticker => {
      const isCached = (
        tickerCache[ticker] && 
        Date.now() < tickerCache[ticker].expires
      );
      if (isCached) {
        const resolvedData = tickerCache[ticker];
        dataPromises.push(Promise.resolve(resolvedData));
      } else {
        tickerCache[ticker] = [{name: 'Loading...'}]; // prevent multiple requests
        dataPromises.push(fetch(API_URL, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            tickers: [`EQUITIES::${ticker}//USD`]
          })
        }).then(
          response => response.json()
        ).then(result=>{
          // normalize the data
          const filteredData = Object.entries(result).filter(([key, value]) => {
            return (ticker === 'USD' && key === '$USD') || key !== `$USD` // for some reason USD is included in every response
          }).reduce((data, [key, value]) => {
            return {...data, ...value, key}; // flatten the object
          }, {});

          const expires = Date.now() + 1000 * 60 * 60 * 24; // cache for 24 hours
          return {data: filteredData, ticker, expires};
        }));
      }
    });

    Promise.all(dataPromises).then(results => {
      // Update the cache
      results.forEach((item, index) => {
        const {ticker} = item;
        tickerCache[ticker] = item;
      });
      localStorage.setItem('tickerCache', JSON.stringify(tickerCache));

      if (!lastTickersFromElement?.length) { // are we still hovering an item?
        setToolTipVisible(false);
      } else if(eq(tickers, lastTickersFromElement)) {
        let html = '<div class="tooltip-content grid-2-col">';
        tickers.forEach(ticker => {
          const {data} = tickerCache[ticker];
          if (data) {
            html += `
              <div class="grid-item-label">
                ${ticker}:
              </div>
              <div class="grid-item-value">
                ${data?.name || 'No data'}
              </div>
            `;
          }
        });
        html += '</div>';

        tooltip.innerHTML = html;
      }
    }).catch(error => {
      tooltip.innerHTML = `<div class="tooltip-content"><strong>${tickers}:</strong> Error loading info</div>`;
    });
  }
  const debouncedShowTooltip = _.debounce(showTooltip, 500); // should be long enough for content to load so that cache can be used

  function checkTicker(event) {
    // Check settings before proceeding
    if (!enableTooltips) {
        setToolTipVisible(false);
        lastTickersFromElement = null;
        return; // Don't process if tooltips are disabled
    }

    const elementFromPoint = document.elementFromPoint(event.clientX, event.clientY);
    const tickers = getTickersFromElement(elementFromPoint);
    if (tickers?.length) {
      if (event.type === 'click') {
        // Check setting before handling click
        if (event.metaKey && enableCmdClick) {
          event.preventDefault();
          event.stopPropagation();
          tickers.forEach((ticker, index) => {
            setTimeout(()=>{
              window.open(`https://finance.yahoo.com/quote/${ticker}/profile/`, '_blank');
            }, index * 1000);
          });
        }
      } else if (eq(tickers, lastTickersFromElement)) {
        debouncedShowTooltip(tickers, event);
      } else {
        showTooltip(tickers, event);
      }
      lastTickersFromElement = tickers;
    } else {
      setToolTipVisible(false);
      lastTickersFromElement = null;
    }
  }
  const debouncedCheckTicker = _.debounce(checkTicker, 10);

    // Function to wait for storageAccess to be available
  async function waitForStorageAccess(retries = 5) {
    if (window.storageAccess) { return true; }
    await new Promise(resolve => setTimeout(resolve, 1000));
    return waitForStorageAccess(--retries);
  }

  async function loadSettings() {
    // load settings from storage
    await waitForStorageAccess();
    try {
      // Wait for storageAccess to be available
      const settings = await window.storageAccess.get(['enableTooltips', 'enableCmdClick']);
      enableTooltips = settings.enableTooltips ?? true;
      enableCmdClick = settings.enableCmdClick ?? true;
    } catch (error) {
      console.error('Error loading tooltip settings:', error);
    }
  }

  // Initialize the script
  async function initLiveTickerTooltip() {
    await loadSettings();
    // Listen for postMessage events instead of chrome.runtime.onMessage
    window.addEventListener('message', function(event) {
      // Make sure the message is from our extension
      if (
          event.data?.source === 'composer-quant-tools-extension' &&
          event.data?.type === 'SETTINGS_UPDATED'
      ) {
        loadSettings();
      }
    });
    // Handle mousemove events to check for ticker text and show tooltips
    document.addEventListener('mousemove', debouncedCheckTicker);
    // Handle mouse click events to open the details page
    document.addEventListener('click', debouncedCheckTicker);
    // Handle keydown events to close the tooltip
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setToolTipVisible(false);
      }
    });
  }

  initLiveTickerTooltip();
})()
