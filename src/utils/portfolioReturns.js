import { getTokenAndAccount, fetchPortfolioHistory, fetchAchTransfers, performanceData } from "../apiService.js";
import { log } from "./logger.js";

const YTD_ADJUSTMENT_KEY = 'composer-returns-ytd-adjustment';

// Helper to get all years between two dates (inclusive)
function getYearsBetween(startDate, endDate) {
  const years = [];
  let year = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  while (year <= endYear) {
    years.push(year);
    year++;
  }
  return years;
}

function sumNetDeposits(transfers, upToDate = null, fromDate = null) {
  return transfers
    .filter(t => t.status === "COMPLETE")
    .filter(t => {
      const created = new Date(t.created_at);
      if (upToDate && created > upToDate) return false;
      if (fromDate && created < fromDate) return false;
      return true;
    })
    .reduce((sum, t) => {
      // INCOMING is positive, OUTGOING is negative
      const amt = t.direction === "INCOMING" ? Math.abs(t.amount) : -Math.abs(t.amount);
      return sum + amt;
    }, 0);
}

function getStoredYtdAdjustment() {
  const val = localStorage.getItem(YTD_ADJUSTMENT_KEY);
  return val !== null ? parseFloat(val) || 0 : 0;
}

function setStoredYtdAdjustment(val) {
  localStorage.setItem(YTD_ADJUSTMENT_KEY, String(val));
}

function createYtdReturnsTooltip(stats, anchorRect, ytdReturnElement) {
  // Remove any existing tooltip
  const existing = document.getElementById('composer-returns-tooltip');
  if (existing) existing.remove();

  const ytdAdjustment = getStoredYtdAdjustment();

  const tooltip = document.createElement('div');
  tooltip.id = 'composer-returns-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.maxWidth = '270px';
  tooltip.style.background = 'rgba(30,32,40,0.98)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '14px 18px';
  tooltip.style.borderRadius = '8px';
  tooltip.style.boxShadow = '0 2px 12px rgba(0,0,0,0.18)';
  tooltip.style.zIndex = 9999;
  tooltip.style.fontSize = '14px';
  tooltip.style.transition = 'opacity 0.15s';
  tooltip.style.opacity = '0';

  // Inject grid style for stats if not already present
  if (!document.getElementById('composer-returns-tooltip-grid-style')) {
    const style = document.createElement('style');
    style.id = 'composer-returns-tooltip-grid-style';
    style.textContent = `
      #composer-returns-popup-values {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0 5px;
        margin-bottom: 0.5em;
        align-items: center;
      }
      #composer-returns-popup-values .composer-label {
        text-align: right;
        opacity: 0.85;
        padding-right: 2px;
      }
      #composer-returns-popup-values .composer-value {
        text-align: left;
        font-weight: bold;
        display: flex;
        align-items: center;
      }
      #composer-returns-popup-values .composer-value input {
        width: 90px;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #888;
        font-weight: normal;
        transform: translateX(-5px);
        height: 28px;
        box-sizing: border-box;
      }
    `;
    document.head.appendChild(style);
  }

  tooltip.innerHTML = `
    <div style="font-weight:bold; font-size: 16px;">YTD Portfolio Stats</div>
    <div style="padding-bottom:8px; margin-bottom:8px; font-size: 11px; opacity:0.6;">
      as of ${stats.ytdStartDate.toISOString().slice(0,10)}
    </div>
    <div id="composer-returns-popup-values">
      <div class="composer-label">Return:</div><div class="composer-value" id="composer-ytd-return">${(stats.ytdReturn * 100).toFixed(2)}%</div>
      <div class="composer-label">Net Deposits:</div><div class="composer-value" id="composer-ytd-net-deposits">$${(stats.netYtdDeposits + ytdAdjustment).toFixed(2)}</div>
      <div class="composer-label">Start Value:</div><div class="composer-value">$${stats.ytdStartValue.toFixed(2)}</div>
      <div class="composer-label">End Value:</div><div class="composer-value">$${stats.finalValue.toFixed(2)}</div>
      <div class="composer-label">&nbsp;</div><div class="composer-value"></div>
      <div class="composer-label">Net Adjustments:</div><div class="composer-value" id="composer-ytd-return"><input id="composer-returns-ytd-adjust-input" type="number" step="any" value="${ytdAdjustment}" style="width:90px; font-size:15px; padding:2px 6px; border-radius:4px; border:1px solid #888; margin-left:4px; color:#222;" /></div>
    </div>
    <div style="margin-top:14px; font-size:11px; color:#b0b8c9; line-height:1.5; opacity:0.6;">
      <b>Net deposits</b> includes ACH deposits and withdrawals, but it does not account for wire transfers or IRA rollovers.<br><br>
      <b>Wire transfers and IRA rollovers</b> can be added together and used as the <b>"Net Adjustments"</b> value.
    </div>
  `;
  document.body.appendChild(tooltip);

  setTimeout(() => {
    const ytdAdjInput = document.getElementById('composer-returns-ytd-adjust-input');
    if (ytdAdjInput && ytdReturnElement) {
      ytdAdjInput.addEventListener('input', () => {
        const ytdAdj = parseFloat(ytdAdjInput.value) || 0;
        setStoredYtdAdjustment(ytdAdj);
        const newNetYtdDeposits = stats.netYtdDeposits + ytdAdj;
        const newYtdReturn = (stats.finalValue - stats.ytdStartValue - newNetYtdDeposits) / ((stats.ytdStartValue + newNetYtdDeposits) || 1);
        document.getElementById('composer-ytd-net-deposits').textContent = `$${newNetYtdDeposits.toFixed(2)}`;
        ytdReturnElement.textContent = `${(newYtdReturn * 100).toFixed(2)}%`;
        document.getElementById('composer-ytd-return').textContent = `${(newYtdReturn * 100).toFixed(2)}%`;
      });
    }
  }, 0);

  // Position tooltip near the anchor
  if (anchorRect) {
    tooltip.style.left = `${anchorRect.right + 12}px`;
    tooltip.style.top = `${anchorRect.top - 8}px`;
  }

  // Tooltip mouse events for sticky hover
  let isOverTooltip = false;
  tooltip.addEventListener('mouseenter', () => {
    isOverTooltip = true;
    tooltip.style.opacity = '1';
  });
  tooltip.addEventListener('mouseleave', () => {
    isOverTooltip = false;
    tooltip.style.opacity = '0';
    setTimeout(() => {
      if (!isOverTooltip) tooltip.remove();
    }, 150);
  });

  // Show tooltip
  setTimeout(() => { tooltip.style.opacity = '1'; }, 0);

  return tooltip;
}

function createCagrTooltip(stats, anchorRect) {
  // Remove any existing CAGR tooltip
  const existing = document.getElementById('composer-cagr-tooltip');
  if (existing) existing.remove();

  const tooltip = document.createElement('div');
  tooltip.id = 'composer-cagr-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.maxWidth = '300px';
  tooltip.style.background = 'rgba(30,32,40,0.98)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '14px 18px';
  tooltip.style.borderRadius = '8px';
  tooltip.style.boxShadow = '0 2px 12px rgba(0,0,0,0.18)';
  tooltip.style.zIndex = 9999;
  tooltip.style.fontSize = '14px';
  tooltip.style.transition = 'opacity 0.15s';
  tooltip.style.opacity = '0';

  // Reuse existing grid style
  if (!document.getElementById('composer-returns-tooltip-grid-style')) {
    const style = document.createElement('style');
    style.id = 'composer-returns-tooltip-grid-style';
    style.textContent = `
      #composer-returns-popup-values, #composer-cagr-popup-values {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0 5px;
        margin-bottom: 0.5em;
        align-items: center;
      }
      #composer-returns-popup-values .composer-label, #composer-cagr-popup-values .composer-label {
        text-align: right;
        opacity: 0.85;
        padding-right: 2px;
      }
      #composer-returns-popup-values .composer-value, #composer-cagr-popup-values .composer-value {
        text-align: left;
        font-weight: bold;
        display: flex;
        align-items: center;
      }
    `;
    document.head.appendChild(style);
  }

  const yearsFormatted = stats.years.toFixed(2);
  const totalReturnFormatted = (stats.totalReturn * 100).toFixed(2);
  const cagrFormatted = (stats.cagr * 100).toFixed(2);

  tooltip.innerHTML = `
    <div style="font-weight:bold; font-size: 16px;">Portfolio CAGR</div>
    <div style="padding-bottom:8px; margin-bottom:8px; font-size: 11px; opacity:0.6;">
      (Portfolio Value - Net Deposits) / Net Deposits, annualized
    </div>
    <div id="composer-cagr-popup-values">
      <div class="composer-label">CAGR:</div><div class="composer-value">${cagrFormatted}%</div>
      <div class="composer-label">Total Return:</div><div class="composer-value">${totalReturnFormatted}%</div>
      <div class="composer-label">Years Invested:</div><div class="composer-value">${yearsFormatted}</div>
      <div class="composer-label">&nbsp;</div><div class="composer-value"></div>
      <div class="composer-label">Start Value:</div><div class="composer-value">$${stats.startValue.toFixed(2)}</div>
      <div class="composer-label">End Value:</div><div class="composer-value">$${stats.endValue.toFixed(2)}</div>
      <div class="composer-label">Net Deposits:</div><div class="composer-value">$${stats.netDeposits.toFixed(2)}${stats.hasAdjustment ? ' *' : ''}</div>
    </div>
    <div style="margin-top:14px; font-size:11px; color:#b0b8c9; line-height:1.5; opacity:0.6;">
      <b>Net deposits</b> includes ACH transfers${stats.hasAdjustment ? ' plus your manual adjustment (wire/IRA)' : '. Wire transfers and IRA rollovers require manual adjustment in YTD tooltip'}.<br><br>
      Uses Composer's formula: (Portfolio Value - Net Deposits) / Net Deposits. After 1 year, CAGR equals Cumulative Return.
    </div>
  `;
  document.body.appendChild(tooltip);

  // Position tooltip near the anchor
  if (anchorRect) {
    tooltip.style.left = `${anchorRect.right + 12}px`;
    tooltip.style.top = `${anchorRect.top - 8}px`;
  }

  // Tooltip mouse events for sticky hover
  let isOverTooltip = false;
  tooltip.addEventListener('mouseenter', () => {
    isOverTooltip = true;
    tooltip.style.opacity = '1';
  });
  tooltip.addEventListener('mouseleave', () => {
    isOverTooltip = false;
    tooltip.style.opacity = '0';
    setTimeout(() => {
      if (!isOverTooltip) tooltip.remove();
    }, 150);
  });

  // Show tooltip
  setTimeout(() => { tooltip.style.opacity = '1'; }, 0);

  return tooltip;
}

const MIN_RUNNING_DAYS_FOR_CAGR = 15; // Minimum trading days required for inclusion in Active CAGR

export function calculateActiveCagr() {
  const symphonies = performanceData?.symphonyStats?.symphonies;
  if (!symphonies || symphonies.length === 0) {
    log('No symphony data available for Active CAGR calculation');
    return null;
  }

  // Filter to only symphonies with valid data
  const allValidSymphonies = symphonies.filter(s =>
    s.value > 0 &&
    s.addedStats &&
    s.addedStats["Running Days"] > 0
  );

  if (allValidSymphonies.length === 0) {
    log('No valid symphonies for Active CAGR calculation');
    return null;
  }

  // Further filter to symphonies with minimum running days for CAGR calculation (>15 days)
  const validSymphonies = allValidSymphonies.filter(s =>
    s.addedStats["Running Days"] > MIN_RUNNING_DAYS_FOR_CAGR
  );

  const excludedCount = allValidSymphonies.length - validSymphonies.length;

  if (validSymphonies.length === 0) {
    log(`No symphonies meet minimum ${MIN_RUNNING_DAYS_FOR_CAGR} running days threshold`);
    return {
      activeCagr: null,
      simpleCagr: null,
      totalValue: allValidSymphonies.reduce((sum, s) => sum + s.value, 0),
      symphonyCount: 0,
      excludedCount,
      minDays: MIN_RUNNING_DAYS_FOR_CAGR,
      symphonyDetails: []
    };
  }

  // Calculate total portfolio value from current symphonies
  const totalValue = validSymphonies.reduce((sum, s) => sum + s.value, 0);

  // Calculate per-symphony CAGR and weight
  const symphonyDetails = validSymphonies.map(symphony => {
    const runningDays = symphony.addedStats["Running Days"];
    const yearsRunning = runningDays / 365.25;

    // Use the already-calculated CAGR from quantstats (stored as "CAGR% (Annual Return)")
    // The value is stored as a string like "224.73%" so we need to parse it
    let symphonyCagr = 0;
    const cagrString = symphony.addedStats["CAGR% (Annual Return)"];
    if (cagrString) {
      // Remove % sign and parse as float, then convert from percentage to decimal
      const parsed = parseFloat(cagrString.replace('%', ''));
      if (!isNaN(parsed)) {
        symphonyCagr = parsed / 100; // Convert from percentage (224.73) to decimal (2.2473)
      }
    }

    const weight = symphony.value / totalValue;

    return {
      id: symphony.id,
      name: symphony.name,
      currentValue: symphony.value,
      weight,
      runningDays,
      yearsRunning,
      cagr: symphonyCagr,
      weightedCagr: symphonyCagr * weight
    };
  });

  // Calculate weighted average CAGR
  const activeCagr = symphonyDetails.reduce((sum, s) => sum + s.weightedCagr, 0);

  // Also calculate simple average for comparison
  const validCagrs = symphonyDetails.filter(s => isFinite(s.cagr) && !isNaN(s.cagr));
  const simpleCagr = validCagrs.length > 0
    ? validCagrs.reduce((sum, s) => sum + s.cagr, 0) / validCagrs.length
    : 0;

  log('');
  log('[Active CAGR Calculation]');
  log(`  Total Portfolio Value: $${totalValue.toFixed(2)}`);
  log(`  Symphonies: ${validSymphonies.length}`);
  symphonyDetails.forEach(s => {
    log(`    ${s.name}: CAGR=${(s.cagr * 100).toFixed(2)}%, Weight=${(s.weight * 100).toFixed(1)}%, Contribution=${(s.weightedCagr * 100).toFixed(2)}%`);
  });
  log(`  Weighted Active CAGR: ${(activeCagr * 100).toFixed(2)}%`);
  log(`  Simple Average CAGR: ${(simpleCagr * 100).toFixed(2)}%`);

  return {
    activeCagr,
    simpleCagr,
    totalValue,
    symphonyCount: validSymphonies.length,
    excludedCount,
    minDays: MIN_RUNNING_DAYS_FOR_CAGR,
    symphonyDetails
  };
}

function createActiveCagrTooltip(stats, anchorRect) {
  // Remove any existing Active CAGR tooltip
  const existing = document.getElementById('composer-active-cagr-tooltip');
  if (existing) existing.remove();

  const tooltip = document.createElement('div');
  tooltip.id = 'composer-active-cagr-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.maxWidth = '400px';
  tooltip.style.background = 'rgba(30,32,40,0.98)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '14px 18px';
  tooltip.style.borderRadius = '8px';
  tooltip.style.boxShadow = '0 2px 12px rgba(0,0,0,0.18)';
  tooltip.style.zIndex = 9999;
  tooltip.style.fontSize = '14px';
  tooltip.style.transition = 'opacity 0.15s';
  tooltip.style.opacity = '0';
  tooltip.style.maxHeight = '80vh';
  tooltip.style.overflowY = 'auto';

  // Generate symphony breakdown rows
  const symphonyRows = stats.symphonyDetails
    .sort((a, b) => b.weight - a.weight) // Sort by weight descending
    .map(s => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
        <td style="padding: 4px 8px 4px 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${s.name}">${s.name}</td>
        <td style="padding: 4px 8px; text-align: right;">${(s.weight * 100).toFixed(1)}%</td>
        <td style="padding: 4px 8px; text-align: right; color: ${s.cagr >= 0 ? '#4ade80' : '#f87171'};">${(s.cagr * 100).toFixed(1)}%</td>
        <td style="padding: 4px 0 4px 8px; text-align: right; color: ${s.weightedCagr >= 0 ? '#4ade80' : '#f87171'};">${(s.weightedCagr * 100).toFixed(2)}%</td>
      </tr>
    `).join('');

  const activeCagrFormatted = (stats.activeCagr * 100).toFixed(2);
  const simpleCagrFormatted = (stats.simpleCagr * 100).toFixed(2);

  tooltip.innerHTML = `
    <div style="font-weight:bold; font-size: 16px;">Active CAGR</div>
    <div style="padding-bottom:8px; margin-bottom:8px; font-size: 11px; opacity:0.6;">
      Weighted average CAGR of current symphony allocations
    </div>
    <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin-bottom: 12px;">
      <div style="opacity: 0.85;">Active CAGR:</div>
      <div style="font-weight: bold; color: ${stats.activeCagr >= 0 ? '#4ade80' : '#f87171'};">${activeCagrFormatted}%</div>
      <div style="opacity: 0.85;">Simple Avg CAGR:</div>
      <div style="font-weight: bold; opacity: 0.7;">${simpleCagrFormatted}%</div>
      <div style="opacity: 0.85;">Symphonies:</div>
      <div style="font-weight: bold;">${stats.symphonyCount}${stats.excludedCount > 0 ? ` <span style="opacity: 0.6; font-weight: normal;">(${stats.excludedCount} excluded)</span>` : ''}</div>
      <div style="opacity: 0.85;">Total Value:</div>
      <div style="font-weight: bold;">$${stats.totalValue.toFixed(2)}</div>
    </div>
    <div style="font-size: 12px; font-weight: bold; margin-bottom: 8px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px;">Per-Symphony Breakdown</div>
    <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
      <thead>
        <tr style="opacity: 0.7; border-bottom: 1px solid rgba(255,255,255,0.2);">
          <th style="padding: 4px 8px 4px 0; text-align: left;">Symphony</th>
          <th style="padding: 4px 8px; text-align: right;">Weight</th>
          <th style="padding: 4px 8px; text-align: right;">CAGR</th>
          <th style="padding: 4px 0 4px 8px; text-align: right;">Contrib.</th>
        </tr>
      </thead>
      <tbody>
        ${symphonyRows}
      </tbody>
    </table>
    <div style="margin-top:14px; font-size:11px; color:#b0b8c9; line-height:1.5; opacity:0.6;">
      <b>Active CAGR</b> = Σ(Symphony CAGR × Weight)<br>
      Shows the "forward-looking power" of your current allocation based on each symphony's historical performance.
    </div>
    <div style="margin-top:10px; padding: 8px; background: rgba(251, 191, 36, 0.15); border-left: 3px solid #fbbf24; border-radius: 4px; font-size: 11px; color: #fbbf24;">
      <b>Note:</b> Only symphonies with >${stats.minDays} trading days are included.${stats.excludedCount > 0 ? ` ${stats.excludedCount} symphony${stats.excludedCount > 1 ? 'ies' : ''} excluded due to insufficient data.` : ''}
    </div>
  `;
  document.body.appendChild(tooltip);

  // Position tooltip near the anchor
  if (anchorRect) {
    tooltip.style.left = `${anchorRect.right + 12}px`;
    tooltip.style.top = `${anchorRect.top - 8}px`;

    // Adjust if tooltip goes off screen
    setTimeout(() => {
      const tooltipRect = tooltip.getBoundingClientRect();
      if (tooltipRect.right > window.innerWidth - 10) {
        tooltip.style.left = `${anchorRect.left - tooltipRect.width - 12}px`;
      }
      if (tooltipRect.bottom > window.innerHeight - 10) {
        tooltip.style.top = `${window.innerHeight - tooltipRect.height - 10}px`;
      }
    }, 0);
  }

  // Tooltip mouse events for sticky hover
  let isOverTooltip = false;
  tooltip.addEventListener('mouseenter', () => {
    isOverTooltip = true;
    tooltip.style.opacity = '1';
  });
  tooltip.addEventListener('mouseleave', () => {
    isOverTooltip = false;
    tooltip.style.opacity = '0';
    setTimeout(() => {
      if (!isOverTooltip) tooltip.remove();
    }, 150);
  });

  // Show tooltip
  setTimeout(() => { tooltip.style.opacity = '1'; }, 0);

  return tooltip;
}

export function injectActiveCagrLoadingPlaceholder() {
  const banner = findMetricBanner();
  if (!banner) return;

  const grid = banner.classList.contains('grid') ? banner : banner.querySelector('.grid');
  if (!grid) return;

  // Don't add if already exists
  if (grid.querySelector('.composer-active-cagr-stat')) return;

  // Create the loading placeholder
  const wrapper = document.createElement('div');
  wrapper.className = 'md:first:pl-2 composer-active-cagr-stat composer-returns-stat';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'flex text-xs text-light-soft mb-1 gap-x-1 items-center';
  labelDiv.textContent = 'Active CAGR';
  const valueDiv = document.createElement('div');
  valueDiv.className = 'text-white text-2xl leading-none';
  valueDiv.style.opacity = '0.5';
  valueDiv.textContent = 'Loading...';
  wrapper.appendChild(labelDiv);
  wrapper.appendChild(valueDiv);

  // Insert after existing Portfolio CAGR
  const existingCagr = grid.querySelector('.composer-cagr-stat');
  if (existingCagr && existingCagr.nextSibling) {
    grid.insertBefore(wrapper, existingCagr.nextSibling);
  } else if (existingCagr) {
    grid.appendChild(wrapper);
  } else {
    grid.appendChild(wrapper);
  }
}

export function injectActiveCagrWithTooltip(stats) {
  if (stats === null) return;

  // Handle case where no symphonies meet minimum days threshold
  const hasValidCagr = stats.activeCagr !== null && stats.activeCagr !== undefined;

  const banner = findMetricBanner();
  if (!banner) {
    log('Could not find metric banner for Active CAGR injection');
    return;
  }
  const grid = banner.classList.contains('grid') ? banner : banner.querySelector('.grid');
  if (!grid) {
    log('Could not find grid in metric banner for Active CAGR');
    return;
  }

  // Remove previous Active CAGR stat (including loading placeholder)
  grid.querySelectorAll('.composer-active-cagr-stat').forEach(el => el.remove());

  // Create the Active CAGR metric
  const wrapper = document.createElement('div');
  wrapper.className = 'md:first:pl-2 composer-active-cagr-stat composer-returns-stat';
  wrapper.style.cursor = 'pointer';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'flex text-xs text-light-soft mb-1 gap-x-1 items-center';
  labelDiv.textContent = 'Active CAGR';
  const valueDiv = document.createElement('div');
  valueDiv.className = 'text-white text-2xl leading-none';

  if (hasValidCagr) {
    const cagrValue = stats.activeCagr * 100;
    valueDiv.textContent = `${cagrValue.toFixed(2)}%`;
    // Color code: green for positive, red for negative
    if (cagrValue >= 0) {
      valueDiv.style.color = '#4ade80';
    } else {
      valueDiv.style.color = '#f87171';
    }
  } else {
    valueDiv.textContent = 'N/A';
    valueDiv.style.opacity = '0.5';
    valueDiv.title = `No symphonies with >${stats.minDays} trading days`;
  }

  wrapper.appendChild(labelDiv);
  wrapper.appendChild(valueDiv);

  let isOverActiveCagr = false;
  let tooltip = null;
  let closeTimeout = null;

  function openTooltip() {
    if (tooltip) tooltip.remove();
    if (!hasValidCagr) {
      // Show a simple tooltip explaining why N/A
      tooltip = document.createElement('div');
      tooltip.id = 'composer-active-cagr-tooltip';
      tooltip.style.cssText = 'position:fixed;background:rgba(30,32,40,0.98);color:#fff;padding:14px 18px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.18);z-index:9999;font-size:14px;';
      tooltip.innerHTML = `
        <div style="font-weight:bold; font-size: 16px;">Active CAGR</div>
        <div style="margin-top:8px;">No symphonies have been running for more than ${stats.minDays} trading days yet.</div>
        <div style="margin-top:8px; opacity:0.7;">${stats.excludedCount} symphonies excluded due to insufficient data.</div>
      `;
      document.body.appendChild(tooltip);
      const rect = wrapper.getBoundingClientRect();
      tooltip.style.left = `${rect.right + 12}px`;
      tooltip.style.top = `${rect.top - 8}px`;
      return;
    }
    tooltip = createActiveCagrTooltip(stats, wrapper.getBoundingClientRect());
    tooltip.addEventListener('mouseenter', () => {
      isOverActiveCagr = false;
      clearTimeout(closeTimeout);
    });
    tooltip.addEventListener('mouseleave', () => {
      closeTooltip();
    });
  }

  function closeTooltip() {
    if (tooltip) {
      tooltip.style.opacity = '0';
      setTimeout(() => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
        }
      }, 150);
    }
  }

  wrapper.addEventListener('mouseenter', () => {
    isOverActiveCagr = true;
    openTooltip();
  });
  wrapper.addEventListener('mouseleave', () => {
    isOverActiveCagr = false;
    closeTimeout = setTimeout(() => {
      if (!isOverActiveCagr) closeTooltip();
    }, 150);
  });

  // Insert after existing CAGR
  const existingCagr = grid.querySelector('.composer-cagr-stat');
  if (existingCagr && existingCagr.nextSibling) {
    grid.insertBefore(wrapper, existingCagr.nextSibling);
  } else if (existingCagr) {
    grid.appendChild(wrapper);
  } else {
    // No existing CAGR, just append
    grid.appendChild(wrapper);
  }
}

function findMetricBanner() {
  // Try multiple selectors for the header metrics area
  const selectors = [
    '.metric-banner',
    '[class*="metric"]',
    'header .grid',
    'main > div:first-child .grid',
    // Look for the container with Portfolio Value, YTD Return, etc.
    '.grid:has([class*="text-2xl"])',
  ];

  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        log(`Found metric banner with selector: ${selector}`);
        return el;
      }
    } catch (e) {
      // :has() might not be supported in older browsers
    }
  }

  // Fallback: find by content - look for element containing "Portfolio Value" or "YTD Return"
  const allDivs = document.querySelectorAll('div');
  for (const div of allDivs) {
    if (div.textContent.includes('Portfolio Value') && div.querySelector('.grid')) {
      log('Found metric banner by content search');
      return div;
    }
  }

  return null;
}

function injectCagrWithTooltip(stats) {
  if (stats.cagr === undefined) return;

  const banner = findMetricBanner();
  if (!banner) {
    log('Could not find metric banner for CAGR injection');
    return;
  }
  const grid = banner.classList.contains('grid') ? banner : banner.querySelector('.grid');
  if (!grid) {
    log('Could not find grid in metric banner');
    return;
  }

  // Remove previous CAGR stat if any
  grid.querySelectorAll('.composer-cagr-stat').forEach(el => el.remove());

  // Create the Portfolio CAGR metric
  const wrapper = document.createElement('div');
  wrapper.className = 'md:first:pl-2 composer-cagr-stat composer-returns-stat';
  wrapper.style.cursor = 'pointer';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'flex text-xs text-light-soft mb-1 gap-x-1 items-center';
  labelDiv.textContent = 'Portfolio CAGR';
  const valueDiv = document.createElement('div');
  valueDiv.className = 'text-white text-2xl leading-none';
  valueDiv.textContent = `${(stats.cagr * 100).toFixed(2)}%`;
  wrapper.appendChild(labelDiv);
  wrapper.appendChild(valueDiv);

  let isOverCagr = false;
  let tooltip = null;
  let closeTimeout = null;

  function openTooltip() {
    if (tooltip) tooltip.remove();
    tooltip = createCagrTooltip(stats, wrapper.getBoundingClientRect());
    tooltip.addEventListener('mouseenter', () => {
      isOverCagr = false;
      clearTimeout(closeTimeout);
    });
    tooltip.addEventListener('mouseleave', () => {
      closeTooltip();
    });
  }

  function closeTooltip() {
    if (tooltip) {
      tooltip.style.opacity = '0';
      setTimeout(() => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
        }
      }, 150);
    }
  }

  wrapper.addEventListener('mouseenter', () => {
    isOverCagr = true;
    openTooltip();
  });
  wrapper.addEventListener('mouseleave', () => {
    isOverCagr = false;
    closeTimeout = setTimeout(() => {
      if (!isOverCagr) closeTooltip();
    }, 150);
  });

  grid.appendChild(wrapper);
}

function getLastNativeElement(grid) {
  // Find the last child element that's not one of our injected stats
  const children = Array.from(grid.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (!children[i].classList.contains('composer-returns-stat')) {
      return children[i];
    }
  }
  return null;
}

function injectYtdReturnWithTooltip({
  ytdReturn,
  ...stats
}) {
  if (ytdReturn === undefined) return;

  const banner = findMetricBanner();
  if (!banner) {
    log('Could not find metric banner for YTD injection');
    return;
  }
  const grid = banner.classList.contains('grid') ? banner : banner.querySelector('.grid');
  if (!grid) {
    log('Could not find grid in metric banner for YTD');
    return;
  }

  // Remove previous injected YTD stats if any (but not CAGR)
  grid.querySelectorAll('.composer-returns-stat:not(.composer-cagr-stat)').forEach(el => el.remove());

  // Create the YTD Return metric
  const wrapper = document.createElement('div');
  wrapper.className = 'md:first:pl-2 composer-returns-stat';
  wrapper.style.cursor = 'pointer';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'flex text-xs text-light-soft mb-1 gap-x-1 items-center';
  labelDiv.textContent = 'YTD Return';
  const valueDiv = document.createElement('div');
  valueDiv.className = 'text-white text-2xl leading-none';
  valueDiv.textContent = `${(ytdReturn * 100).toFixed(2)}%`;
  wrapper.appendChild(labelDiv);
  wrapper.appendChild(valueDiv);

  let isOverYtd = false;
  let tooltip = null;
  let closeTimeout = null;

  function openTooltip() {
    if (tooltip) tooltip.remove();
    tooltip = createYtdReturnsTooltip({ ytdReturn, ...stats }, wrapper.getBoundingClientRect(), valueDiv);
    tooltip.addEventListener('mouseenter', () => {
      isOverYtd = false;
      clearTimeout(closeTimeout);
    });
    tooltip.addEventListener('mouseleave', () => {
      closeTooltip();
    });
  }

  function closeTooltip() {
    if (tooltip) {
      tooltip.style.opacity = '0';
      setTimeout(() => {
        if (tooltip) {
          tooltip.remove();
          tooltip = null;
        }
      }, 150);
    }
  }

  wrapper.addEventListener('mouseenter', () => {
    isOverYtd = true;
    openTooltip();
  });
  wrapper.addEventListener('mouseleave', () => {
    isOverYtd = false;
    closeTimeout = setTimeout(() => {
      if (!isOverYtd) closeTooltip();
    }, 150);
  });

  // Insert after the last native element (before any existing CAGR)
  const lastNative = getLastNativeElement(grid);
  const existingCagr = grid.querySelector('.composer-cagr-stat');
  if (existingCagr) {
    // Insert before CAGR so YTD comes first
    grid.insertBefore(wrapper, existingCagr);
  } else if (lastNative && lastNative.nextSibling) {
    grid.insertBefore(wrapper, lastNative.nextSibling);
  } else {
    grid.appendChild(wrapper);
  }
}

async function waitForMetricBannerAndInject(ytdStats, cagrStats, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    function check() {
      const banner = findMetricBanner();
      const grid = banner ? (banner.classList.contains('grid') ? banner : banner.querySelector('.grid')) : null;
      // Wait for Cumulative Return to be rendered (it's the last native metric)
      const hasCumulativeReturn = grid && Array.from(grid.children).some(
        child => child.textContent.includes('Cumulative Return')
      );
      if (banner && grid && hasCumulativeReturn) {
        // Small delay to ensure DOM is stable
        setTimeout(() => {
          // Inject YTD first (appears after Composer's native Cumulative Return)
          if (ytdStats) {
            injectYtdReturnWithTooltip(ytdStats);
          }
          // Then inject CAGR (appears after YTD)
          if (cagrStats) {
            injectCagrWithTooltip(cagrStats);
          }
          resolve(true);
        }, 100);
      } else if (Date.now() - start < timeoutMs) {
        setTimeout(check, 100);
      } else {
        log('Warning: metric banner or grid not found after waiting. Check findMetricBanner() selectors.');
        resolve(false);
      }
    }
    check();
  });
}

export async function logPortfolioReturns() {
  log('logPortfolioReturns() called - starting portfolio returns calculation');

  // Check if YTD returns are enabled
  const result = await chrome.storage.local.get(['enableYtdReturns']);
  const enableYtdReturns = result?.enableYtdReturns ?? true;

  const { token, account } = await getTokenAndAccount();
  const history = await fetchPortfolioHistory(account, token);
  if (!history || !history.epoch_ms || !history.series) {
    log("No portfolio history found");
    return;
  }
  // Find all years needed for ACH transfers
  const firstDate = new Date(history.epoch_ms[0]);
  const lastDate = new Date(history.epoch_ms[history.epoch_ms.length - 1]);
  const years = getYearsBetween(firstDate, lastDate);
  const allTransfers = [];
  for (const year of years) {
    const transfers = await fetchAchTransfers(account, token, year);
    allTransfers.push(...(Array.isArray(transfers) ? transfers : []));
  }

  let ytdStats = null;
  if (enableYtdReturns) {
    // --- YTD Return ---
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    // Find the first trading day of the year in history
    let ytdStartIdx = history.epoch_ms.findIndex(ts => ts >= yearStart.getTime());
    if (ytdStartIdx === -1) ytdStartIdx = 0; // fallback
    const ytdStartValue = history.series[ytdStartIdx];
    const ytdStartDate = new Date(history.epoch_ms[ytdStartIdx]);
    const netYtdDeposits = sumNetDeposits(allTransfers, lastDate, ytdStartDate);
    const ytdAdjustment = getStoredYtdAdjustment();
    const adjustedNetYtdDeposits = netYtdDeposits + ytdAdjustment;
    const finalValue = history.series[history.series.length - 1];
    const ytdReturn = (finalValue - ytdStartValue - adjustedNetYtdDeposits) / ((ytdStartValue + adjustedNetYtdDeposits) || 1);

    log("");
    log("[Year-to-Date]");
    log(`  Start Value (first trading day): $${ytdStartValue.toFixed(2)} (${ytdStartDate.toISOString().slice(0,10)})`);
    log(`  End Value:   $${finalValue.toFixed(2)}`);
    log(`  Net Deposits (YTD): $${netYtdDeposits.toFixed(2)}`);
    log(`  YTD Return: ${(ytdReturn * 100).toFixed(2)}%`);

    ytdStats = {
      ytdStartValue,
      ytdStartDate,
      netYtdDeposits,
      ytdReturn,
      finalValue
    };
  }
  log("------------------------------------");

  // --- All-Time CAGR (using ACH transfers for net deposits) ---
  let cagrStats = null;
  try {
    if (history.series.length > 1) {
      const startValue = history.series[0];
      const endValue = history.series[history.series.length - 1];
      // Use total ACH deposits (note: doesn't include wires/IRA rollovers)
      const ytdAdjustment = getStoredYtdAdjustment();
      const netDeposits = sumNetDeposits(allTransfers) + ytdAdjustment;

      // Calculate years invested
      const msInYear = 365.25 * 24 * 60 * 60 * 1000;
      const yearsInvested = (lastDate.getTime() - firstDate.getTime()) / msInYear;

      if (yearsInvested > 0.01 && netDeposits > 0) { // At least ~4 days and some deposits
        // Match Composer's simple return formula: (Portfolio Value - Net Deposits) / Net Deposits
        // This ensures CAGR after 1 year equals cumulative return
        const totalReturn = (endValue - netDeposits) / netDeposits;

        // CAGR = (1 + total_return)^(1/years) - 1
        const cagr = Math.pow(1 + totalReturn, 1 / yearsInvested) - 1;

        cagrStats = {
          cagr,
          totalReturn,
          years: yearsInvested,
          startValue,
          endValue,
          netDeposits,
          hasAdjustment: ytdAdjustment !== 0
        };

        log("");
        log("[All-Time CAGR]");
        log(`  Start Value: $${startValue.toFixed(2)} (${firstDate.toISOString().slice(0,10)})`);
        log(`  End Value:   $${endValue.toFixed(2)} (${lastDate.toISOString().slice(0,10)})`);
        log(`  Net Deposits (ACH + adjustment): $${netDeposits.toFixed(2)}`);
        log(`  Years Invested: ${yearsInvested.toFixed(2)}`);
        log(`  Total Return (Composer formula): ${(totalReturn * 100).toFixed(2)}%`);
        log(`  CAGR: ${(cagr * 100).toFixed(2)}%`);
      } else {
        log("Portfolio too new for CAGR calculation (less than 4 days)");
      }
    }
  } catch (error) {
    log("Error calculating CAGR:", error);
  }

  // Wait for metric banner and inject into UI
  if (ytdStats || cagrStats) {
    await waitForMetricBannerAndInject(ytdStats, cagrStats);
  }
} 