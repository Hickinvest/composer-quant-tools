// Integration file for asset allocation pie charts
// Now runs in MAIN world - no imports needed, functions available globally

let currentCharts = null;

// Function to get full portfolio value from DOM or fallback to symphony total
function getFullPortfolioValue() {
  try {
    // Try to extract total portfolio value from the page DOM
    // Look for portfolio value display elements
    const portfolioValueSelectors = [
      '[data-testid="portfolio-value"]',
      '.portfolio-value',
      '[class*="portfolio"][class*="value"]'
    ];
    
    for (const selector of portfolioValueSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const value = parseFloat(text.replace(/[$,]/g, ''));
        if (!isNaN(value) && value > 0) {
          return value;
        }
      }
    }
    
    // Fallback: return null to skip "Other" category 
    // In the future, this could use messaging to get data from ISOLATED world
    return null;
  } catch (error) {
    return null;
  }
}

// Function to render charts when data is available
async function renderCharts(performanceData) {
  // Check if we're on the portfolio page
  if (window.location.pathname !== "/portfolio") {
    return;
  }

  // Find a suitable target element on the page
  const targetElement = findChartTargetElement();
  if (!targetElement) {
    return; // Target element not ready yet, wait for next interval
  }
  // Get Symphony data from passed performanceData
  const symphonyAllocations = await getSymphonyAllocations(performanceData);
  const holdingsData = await getHoldingsAllocations(performanceData);

  // Only render if we have data
  if (symphonyAllocations && holdingsData) {
    // Clean up existing charts
    if (currentCharts) {
      window.destroyCharts(currentCharts);
    }

    // Render the charts
    currentCharts = await window.renderAssetAllocationCharts(
      symphonyAllocations, 
      holdingsData, 
      targetElement
    );
  }
}

// Auto-initialize when script loads (no export needed since running in MAIN world)
(function initAssetAllocationCharts() {
  let hasRendered = false;
  
  // Listen for performance data updates from ISOLATED world
  window.addEventListener('message', (event) => {
    if (event.data.type === 'COMPOSER_QUANT_TOOLS_CHART_DATA' && event.data.source === 'composer-quant-tools-isolated') {
      const performanceData = event.data.data;
      const symphonyStats = performanceData?.symphonyStats;
      
      // Store in MAIN world for fallback access
      window.composerQuantToolsPerformanceData = performanceData;
      
      // Only render if we have symphony data and haven't rendered yet, or if data changed significantly
      if (symphonyStats?.symphonies?.length && (!hasRendered || shouldUpdateCharts(performanceData))) {
        renderCharts(performanceData);
        hasRendered = true;
      }
    }
  });
  
  // Fallback: Also create a timer-based check in case messages are missed
  const fallbackInterval = setInterval(() => {
    // Try to access performance data if it exists in MAIN world
    if (window.composerQuantToolsPerformanceData?.symphonyStats?.symphonies?.length && !hasRendered) {
      renderCharts(window.composerQuantToolsPerformanceData);
      hasRendered = true;
      clearInterval(fallbackInterval);
    }
  }, 2000);
  
  // Clean up on page unload
  window.addEventListener('unload', () => {
    try { clearInterval(fallbackInterval); } catch (e) { }
  });
  
  // Simple function to determine if charts should be updated
  function shouldUpdateCharts(newData) {
    // For now, always update. Could be made smarter in the future
    // to compare data changes and only re-render when necessary
    return false; // Only render once for now to avoid unnecessary re-renders
  }
})();

// Wait for the page to be fully loaded and rendered
async function waitForPageLoad() {
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', resolve);
    }
  });
}

// Find a suitable target element for the charts
function findChartTargetElement() {
  // Try to find the main portfolio container
  const selectors = [
    'main .bg-sheet'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  // Fallback to body
  return document.body;
}

// Get Symphony allocation data from passed performanceData
async function getSymphonyAllocations(performanceData) {
  if (!performanceData?.symphonyStats?.symphonies?.length) {
    return null;
  }

  // Calculate allocation percentage for each symphony based on their values
  const symphonies = performanceData.symphonyStats.symphonies;
  const totalSymphonyValue = symphonies.reduce((sum, symphony) => sum + (symphony.value || 0), 0);
  
  if (totalSymphonyValue === 0) {
    return null;
  }

  const symphonyAllocations = symphonies
    .filter(symphony => symphony.value > 0)
    .map(symphony => ({
      asset: symphony.name || symphony.id || 'Unknown Symphony',
      value: symphony.value,
      weight: symphony.value / totalSymphonyValue
    }))
    .sort((a, b) => b.weight - a.weight); // Sort by weight descending

  return symphonyAllocations;
}

// Get holdings allocation data from passed performanceData
function getHoldingsAllocations(performanceData) {
  if (!performanceData?.symphonyStats?.symphonies?.length) {
    return null;
  }

  // Aggregate holdings from all symphonies
  const allHoldings = [];
  const totalSymphonyValue = performanceData.symphonyStats.symphonies.reduce((sum, symphony) => sum + (symphony.value || 0), 0);
  
  performanceData.symphonyStats?.symphonies?.forEach(symphony => {
    // Check for holdings in different possible locations
    const holdings = symphony?.holdings || [];
    holdings.forEach(holding => {
      const ticker = holding?.ticker || holding?.name || 'Unknown';
      const value = holding?.value || 0;
      
      // Find existing holding for this ticker
      const existingHolding = allHoldings.find(h => h?.ticker === ticker);
      if (existingHolding) {
        existingHolding.value += value;
      } else {
        allHoldings.push({
          ticker: ticker,
          value: value
        });
      }
    });
  });

  // Try to get full portfolio value for "Other" category
  const fullPortfolioValue = getFullPortfolioValue();
  let totalValueForCalculation = totalSymphonyValue;

  // If we can get the full portfolio value, add "Other" category
  if (fullPortfolioValue && fullPortfolioValue > totalSymphonyValue) {
    const other = fullPortfolioValue - totalSymphonyValue;
    if (other > 0) {
      allHoldings.push({
        ticker: 'Other',
        value: other
      });
    }
    totalValueForCalculation = fullPortfolioValue;
  }

  // Filter out holdings with zero value and sort by value descending
  const validHoldings = allHoldings
    .filter(holding => holding.value > 0)
    .sort((a, b) => b.value - a.value);
  
  if (validHoldings.length === 0) {
    return null;
  }

  // Calculate the weight of each holding
  const holdingsAllocations = validHoldings.map(holding => ({
    ticker: holding.ticker,
    value: holding.value,
    weight: holding.value / totalValueForCalculation
  }));

  return holdingsAllocations;
}
