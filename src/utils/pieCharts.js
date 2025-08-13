// Pie chart utilities for Symphony asset allocation and holdings
// This runs in the MAIN world where Chart.js is available via manifest

// Create a pie chart container
function createPieChartContainer(id, title) {
  const container = document.createElement('div');
  container.id = id;
  container.className = 'pie-chart-container';
  container.style.cssText = `
    flex: 1;
    min-width: min(350px, calc(100vw - 40px));
    height: 300px;
    margin: 10px;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: white;
    box-sizing: border-box;
  `;
  
  const titleElement = document.createElement('h3');
  titleElement.textContent = title;
  titleElement.style.cssText = `
    margin: 0 0 10px 0;
    font-size: 14px;
    font-weight: bold;
    text-align: center;
  `;
  
  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = `
    position: relative;
    width: 100%;
    height: calc(100% - 40px);
    min-height: 240px;
    min-width: 360px;
    display: flex;
    align-items: center;
  `;
  
  const canvas = document.createElement('canvas');
  canvas.id = `${id}-canvas`;
  canvas.style.cssText = `
    width: 100% !important;
    height: 100% !important;
  `;
  
  canvasWrapper.appendChild(canvas);
  container.appendChild(titleElement);
  container.appendChild(canvasWrapper);
  
  return container;
}

// Extract symphony colors from the page DOM
function extractSymphonyColors() {
  const symphonyColors = new Map();
  
  try {
    // Select all symphony rows using the first cell of table rows
    const symphonyRows = document.querySelectorAll('tr td:first-child');
    
    for (const cell of symphonyRows) {
      // Find the 'a' tag inside the cell
      const linkElement = cell.querySelector('a');
      if (!linkElement) continue;
      
      // Get the symphony name from the link text
      const symphonyName = linkElement.textContent.trim();
      if (!symphonyName) continue;
      
      // Find the parent div of the 'a' tag
      const parentDiv = linkElement.parentElement;
      if (!parentDiv || parentDiv.tagName !== 'DIV') continue;
      
      // Find the sibling with class '.block'
      const blockElement = parentDiv.parentElement?.querySelector('.block');
      if (!blockElement) continue;
      
      // Extract the background color
      const computedStyle = window.getComputedStyle(blockElement);
      const backgroundColor = computedStyle.backgroundColor;
      
      if (backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
        symphonyColors.set(symphonyName, backgroundColor);
      }
    }
  } catch (error) {
    console.warn('Error extracting symphony colors:', error);
  }
  
  return symphonyColors;
}

// Generate colors for pie chart segments
function generateColors(count, symphonyNames = [], useExtractedColors = false) {
  const defaultColors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384'
  ];
  
  // If we should use extracted colors and have symphony names, try to get them from the page
  if (useExtractedColors && symphonyNames.length > 0) {
    const extractedColors = extractSymphonyColors();
    const colors = [];
    
    // Try to match each symphony name with extracted colors
    for (let i = 0; i < symphonyNames.length; i++) {
      const symphonyName = symphonyNames[i];
      
      // Try exact match first
      let color = extractedColors.get(symphonyName);
      
      // If no exact match, try partial matching (in case names differ slightly)
      if (!color) {
        for (const [extractedName, extractedColor] of extractedColors) {
          if (extractedName.includes(symphonyName) || symphonyName.includes(extractedName)) {
            color = extractedColor;
            break;
          }
        }
      }
      
      // Use extracted color or fall back to default
      colors.push(color || defaultColors[i % defaultColors.length]);
    }
    
    return colors;
  }
  
  // Default behavior: generate colors
  const colors = [...defaultColors];
  while (colors.length < count) {
    colors.push(`hsl(${Math.random() * 360}, 70%, 50%)`);
  }
  
  return colors.slice(0, count);
}

// Direct chart creation using Chart.js (available in MAIN world)
async function createChart(containerId, chartType, data, options = {}) {
  try {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with id '${containerId}' not found`);
    }
    
    const canvas = container.querySelector('canvas');
    if (!canvas) {
      throw new Error('Canvas element not found in container');
    }
    
    // Create the chart using Chart.js (available in MAIN world)
    const ctx = canvas.getContext('2d');
    
    // Handle common chart configurations
    const processedOptions = {
      responsive: true,
      maintainAspectRatio: true,
      ...options
    };
    
    // Add common chart-specific configurations
    processedOptions.plugins = processedOptions.plugins || {};
    
    // Handle custom legend formatting for charts with formatted labels
    if ((chartType === 'pie' || chartType === 'doughnut') && data.datasets?.[0]?.formattedLabels) {
      processedOptions.plugins.legend = processedOptions.plugins.legend || {};
      processedOptions.plugins.legend.labels = processedOptions.plugins.legend.labels || {};
      
      // Custom label generation to use formatted labels in legend
      processedOptions.plugins.legend.labels.generateLabels = function(chart) {
        const data = chart.data;
        const formattedLabels = data.datasets[0].formattedLabels;
        
        if (data.labels.length && data.datasets.length && formattedLabels) {
          return data.labels.map((label, i) => {
            const dataset = data.datasets[0];
            return {
              text: formattedLabels[i], // Use formatted label
              fillStyle: dataset.backgroundColor[i],
              strokeStyle: dataset.borderColor,
              lineWidth: dataset.borderWidth,
              pointStyle: 'circle',
              index: i
            };
          });
        }
        return [];
      };
    }
    
    // Pie and Doughnut chart tooltips with percentage
    if ((chartType === 'pie' || chartType === 'doughnut') && !options.plugins?.tooltip?.callbacks?.label) {
      processedOptions.plugins.tooltip = processedOptions.plugins.tooltip || {};
      processedOptions.plugins.tooltip.callbacks = {
        label: function(context) {
          const value = context.parsed;
          const total = context.dataset.data.reduce((a, b) => a + b, 0);
          const percentage = ((value / total) * 100).toFixed(1);
          
          // Check if we should format values as currency
          let formattedValue = value;
          if (options.plugins?.tooltip?.formatValues) {
            formattedValue = value.toLocaleString('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            });
          }
          
          return `${formattedValue} (${percentage}%)`;
        }
      };
    }
    
    // Bar and Line chart value formatting
    if ((chartType === 'bar' || chartType === 'line') && !options.plugins?.tooltip?.callbacks?.label) {
      processedOptions.plugins.tooltip = processedOptions.plugins.tooltip || {};
      processedOptions.plugins.tooltip.callbacks = {
        label: function(context) {
          const label = context.dataset.label || '';
          const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
          return `${label}: ${value}`;
        }
      };
    }
    
    const chart = new Chart(ctx, {
      type: chartType,
      data: data,
      options: processedOptions
    });
    
    const chartId = `chart_${Date.now()}_${Math.random()}`;
    
    // Store chart reference for cleanup (using same global as mainWorldBridge)
    window.composerQuantToolsCharts = window.composerQuantToolsCharts || {};
    window.composerQuantToolsCharts[chartId] = chart;
    
    return {
      id: chartId,
      chart,
      destroy: () => {
        if (window.composerQuantToolsCharts[chartId]) {
          window.composerQuantToolsCharts[chartId].destroy();
          delete window.composerQuantToolsCharts[chartId];
        }
      }
    };
    
  } catch (error) {
    console.error('Error creating chart:', error);
    throw error;
  }
}

// Create a doughnut chart via the MAIN world bridge
async function createPieChart(containerId, data, options = {}) {
  // Prepare clean labels without dollar amounts (for tooltips)
  const labels = data.map(item => item.label);
  const values = data.map(item => item.value);
  
  // Use extracted colors for symphony charts, or generate default colors
  const useExtractedColors = options.useExtractedColors || false;
  const colors = generateColors(data.length, labels, useExtractedColors);
  
  // Create formatted labels with dollar amounts for the legend
  const formattedLabels = data.map(item => {
    // truncate the label to 25 characters
    const truncatedLabel = item.label.length > 25 ? item.label.substring(0, 25) + '...' : item.label;
    return `${truncatedLabel}`;
  });
  
  const chartData = {
    labels: formattedLabels, // Use clean labels
    datasets: [{
      data: values,
      backgroundColor: colors,
      borderColor: '#fff',
      borderWidth: 2,
      // Store formatted labels for legend
      formattedLabels: formattedLabels
    }]
  };
  
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          padding: 8,
          usePointStyle: true,
          font: { size: 12 },
          boxWidth: 12,
          boxHeight: 12
        },
        align: 'center',
        fullSize: true
      },
      tooltip: {
        // Configuration for main world to handle tooltip formatting
        formatValues: true // Signal to format values as currency
      }
    },
    layout: {
      padding: 0
    },
    elements: {
      arc: {
        borderWidth: 2
      }
    },
    ...options
  };
  
  return createChart(containerId, 'doughnut', chartData, chartOptions);
}

// Render Symphony asset allocation pie chart
async function renderSymphonyAssetAllocation(symphonyAllocations, targetElement) {
  // Transform symphony data to pie chart format
  const pieData = symphonyAllocations?.map(allocation => ({
    label: allocation.asset || allocation.ticker || 'Unknown',
    value: allocation.value || allocation.weight || 0
  })) || [];
  
  if (pieData.length === 0) {
    return null;
  }
  
  const containerId = 'symphony-allocation-chart';
  const container = createPieChartContainer(containerId, 'Symphony Asset Allocation');
  
  // Insert into target element
  if (typeof targetElement === 'string') {
    const target = document.querySelector(targetElement);
    if (target) target.appendChild(container);
  } else if (targetElement) {
    targetElement.appendChild(container);
  } else {
    // Default to body if no target specified
    document.body.appendChild(container);
  }
  
  return await createPieChart(containerId, pieData, { useExtractedColors: true });
}

// Render holdings asset allocation pie chart
async function renderHoldingsAssetAllocation(holdingsData, targetElement) {
  // Transform holdings data to pie chart format
  const pieData = holdingsData.map(holding => ({
    label: holding.ticker || holding.name || 'Unknown',
    value: holding.value || holding.weight || 0
  }));
  
  if (pieData.length === 0) {
    return null;
  }
  
  const containerId = 'holdings-allocation-chart';
  const container = createPieChartContainer(containerId, 'Holdings Asset Allocation');
  
  // Insert into target element
  if (typeof targetElement === 'string') {
    const target = document.querySelector(targetElement);
    if (target) target.appendChild(container);
  } else if (targetElement) {
    targetElement.appendChild(container);
  } else {
    // Default to body if no target specified
    document.body.appendChild(container);
  }
  
  return await createPieChart(containerId, pieData);
}

// Render both charts side by side in an expandable/collapsible wrapper
async function renderAssetAllocationCharts(symphonyAllocations, holdingsData, targetElement) {
  // Create the main collapsible container
  const mainContainer = document.createElement('div');
  mainContainer.className = 'asset-allocation-container';
  mainContainer.style.cssText = `
    margin: 20px 0;
    border: 1px solid #ddd;
    border-radius: 8px;
    background: white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;
  
  // Create the header with toggle button
  const header = document.createElement('div');
  header.className = 'allocation-header';
  header.style.cssText = `
    padding: 15px 20px;
    background: #f8f9fa;
    border-bottom: 1px solid #ddd;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: bold;
    font-size: 16px;
    user-select: none;
  `;
  
  const headerTitle = document.createElement('span');
  headerTitle.textContent = 'Asset Allocation Charts';
  
  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'toggle-icon';
  toggleIcon.innerHTML = '▲';
  toggleIcon.style.cssText = `
    transition: transform 0.3s ease;
    font-size: 12px;
  `;
  
  header.appendChild(headerTitle);
  header.appendChild(toggleIcon);
  
  // Create the collapsible content area
  const content = document.createElement('div');
  content.className = 'allocation-content';
  content.style.cssText = `
    padding: 20px;
    overflow: hidden;
    transition: max-height 0.3s ease;
    max-height: 1000px;
  `;
  
  // Create the charts wrapper inside content
  const chartsWrapper = document.createElement('div');
  chartsWrapper.style.cssText = `
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-evenly;
    align-items: flex-start;
    width: 100%;
  `;
  
  content.appendChild(chartsWrapper);
  
  // Add toggle functionality with state persistence
  const STORAGE_KEY = 'assetAllocationChartsExpanded';
  
  // Load saved state from localStorage, default to true (expanded)
  let isExpanded = localStorage.getItem(STORAGE_KEY) !== 'false';
  
  // Function to update UI based on current state
  const updateUI = (expanded) => {
    if (expanded) {
      content.style.maxHeight = '1000px';
      content.style.padding = '20px';
      toggleIcon.style.transform = 'rotate(0deg)';
      toggleIcon.innerHTML = '▲';
    } else {
      content.style.maxHeight = '0';
      content.style.padding = '0 20px';
      toggleIcon.style.transform = 'rotate(90deg)';
      toggleIcon.innerHTML = '▶';
    }
  };
  
  // Apply initial state
  updateUI(isExpanded);
  
  header.addEventListener('click', () => {
    isExpanded = !isExpanded;
    
    // Save state to localStorage
    localStorage.setItem(STORAGE_KEY, isExpanded.toString());
    
    // Update UI
    updateUI(isExpanded);
  });
  
  // Assemble the container
  mainContainer.appendChild(header);
  mainContainer.appendChild(content);
  
  // Insert main container into target
  if (typeof targetElement === 'string') {
    const target = document.querySelector(targetElement);
    if (target) target.appendChild(mainContainer);
  } else if (targetElement) {
    targetElement.prepend(mainContainer);
  } else {
    document.body.prepend(mainContainer);
  }
  
  const charts = {};
  
  // Render Symphony chart
  if (symphonyAllocations) {
    charts.symphony = await renderSymphonyAssetAllocation(symphonyAllocations, chartsWrapper);
  }
  
  // Render Holdings chart
  if (holdingsData) {
    charts.holdings = await renderHoldingsAssetAllocation(holdingsData, chartsWrapper);
  }
  
  return charts;
}

// Clean up charts
function destroyCharts(charts) {
  if (charts) {
    Object.values(charts).forEach(chart => {
      if (chart && typeof chart.destroy === 'function') {
        chart.destroy();
      }
    });
  }
}

// Make functions available globally for other MAIN world scripts
window.renderAssetAllocationCharts = renderAssetAllocationCharts;
window.destroyCharts = destroyCharts;
window.createChart = createChart;
