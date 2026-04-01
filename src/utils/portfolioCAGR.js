import { performanceData } from "../apiService.js";
import { log } from "./logger.js";

const CAGR_ADJUSTMENT_KEY = 'composer-returns-cagr-adjustment';

export function sumNetDeposits(transfers, upToDate = null, fromDate = null) {
  return transfers
    .filter(t => t.status === "COMPLETE")
    .filter(t => {
      const created = new Date(t.created_at);
      if (upToDate && created > upToDate) return false;
      if (fromDate && created < fromDate) return false;
      return true;
    })
    .reduce((sum, t) => {
      const amt = t.direction === "INCOMING" ? Math.abs(t.amount) : -Math.abs(t.amount);
      return sum + amt;
    }, 0);
}

function getStoredCagrAdjustment() {
  const val = localStorage.getItem(CAGR_ADJUSTMENT_KEY);
  return val !== null ? parseFloat(val) || 0 : 0;
}

function setStoredCagrAdjustment(val) {
  localStorage.setItem(CAGR_ADJUSTMENT_KEY, String(val));
}

export function findMetricBanner() {
  const selectors = [
    '.metric-banner',
    '[class*="metric"]',
    'header .grid',
    'main > div:first-child .grid',
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

  const allDivs = document.querySelectorAll('div');
  for (const div of allDivs) {
    if (div.textContent.includes('Portfolio Value') && div.querySelector('.grid')) {
      log('Found metric banner by content search');
      return div;
    }
  }

  return null;
}

function createCagrTooltip(stats, anchorRect, cagrValueElement) {
  const existing = document.getElementById('composer-cagr-tooltip');
  if (existing) existing.remove();

  const cagrAdjustment = getStoredCagrAdjustment();

  const currentNetDeposits = stats.achOnlyDeposits + cagrAdjustment;
  const currentTotalReturn = currentNetDeposits > 0 ? (stats.endValue - currentNetDeposits) / currentNetDeposits : 0;
  const currentCagr = currentNetDeposits > 0 ? Math.pow(1 + currentTotalReturn, 1 / stats.years) - 1 : 0;

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
      #composer-cagr-popup-values .composer-value input {
        width: 100px;
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

  const yearsFormatted = stats.years.toFixed(2);

  tooltip.innerHTML = `
    <div style="font-weight:bold; font-size: 16px;">Portfolio CAGR</div>
    <div style="padding-bottom:8px; margin-bottom:8px; font-size: 11px; opacity:0.6;">
      (Portfolio Value - Net Deposits) / Net Deposits, annualized
    </div>
    <div id="composer-cagr-popup-values">
      <div class="composer-label">CAGR:</div><div class="composer-value" id="composer-cagr-value">${(currentCagr * 100).toFixed(2)}%</div>
      <div class="composer-label">Total Return:</div><div class="composer-value" id="composer-cagr-total-return">${(currentTotalReturn * 100).toFixed(2)}%</div>
      <div class="composer-label">Years Invested:</div><div class="composer-value">${yearsFormatted}</div>
      <div class="composer-label">&nbsp;</div><div class="composer-value"></div>
      <div class="composer-label">Start Value:</div><div class="composer-value">$${stats.startValue.toFixed(2)}</div>
      <div class="composer-label">End Value:</div><div class="composer-value">$${stats.endValue.toFixed(2)}</div>
      <div class="composer-label">ACH Deposits:</div><div class="composer-value">$${stats.achOnlyDeposits.toFixed(2)}</div>
      <div class="composer-label">Net Deposits:</div><div class="composer-value" id="composer-cagr-net-deposits">$${currentNetDeposits.toFixed(2)}</div>
      <div class="composer-label">&nbsp;</div><div class="composer-value"></div>
      <div class="composer-label">Net Adjustments:</div><div class="composer-value"><input id="composer-cagr-adjust-input" type="number" step="any" value="${cagrAdjustment}" style="width:100px; font-size:15px; padding:2px 6px; border-radius:4px; border:1px solid #888; margin-left:4px; color:#222;" /></div>
    </div>
    <div style="margin-top:14px; font-size:11px; color:#b0b8c9; line-height:1.5; opacity:0.6;">
      <b>ACH Deposits</b> are automatically tracked. <b>Wire transfers and IRA rollovers</b> must be added manually as <b>"Net Adjustments"</b>.<br><br>
      Uses Composer's formula: (Portfolio Value - Net Deposits) / Net Deposits. After 1 year, CAGR equals Cumulative Return.
    </div>
  `;
  document.body.appendChild(tooltip);

  if (cagrValueElement && currentNetDeposits > 0) {
    cagrValueElement.textContent = `${(currentCagr * 100).toFixed(2)}%`;
  }

  setTimeout(() => {
    const cagrAdjInput = document.getElementById('composer-cagr-adjust-input');
    if (cagrAdjInput) {
      cagrAdjInput.addEventListener('input', () => {
        const adj = parseFloat(cagrAdjInput.value) || 0;
        setStoredCagrAdjustment(adj);

        const newNetDeposits = stats.achOnlyDeposits + adj;
        if (newNetDeposits > 0) {
          const newTotalReturn = (stats.endValue - newNetDeposits) / newNetDeposits;
          const newCagr = Math.pow(1 + newTotalReturn, 1 / stats.years) - 1;

          const netDepositsEl = document.getElementById('composer-cagr-net-deposits');
          const cagrEl = document.getElementById('composer-cagr-value');
          const totalReturnEl = document.getElementById('composer-cagr-total-return');

          if (netDepositsEl) netDepositsEl.textContent = `$${newNetDeposits.toFixed(2)}`;
          if (cagrEl) cagrEl.textContent = `${(newCagr * 100).toFixed(2)}%`;
          if (totalReturnEl) totalReturnEl.textContent = `${(newTotalReturn * 100).toFixed(2)}%`;

          if (cagrValueElement) cagrValueElement.textContent = `${(newCagr * 100).toFixed(2)}%`;
        }
      });
    }
  }, 0);

  if (anchorRect) {
    tooltip.style.left = `${anchorRect.right + 12}px`;
    tooltip.style.top = `${anchorRect.top - 8}px`;
  }

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

  setTimeout(() => { tooltip.style.opacity = '1'; }, 0);

  return tooltip;
}

let minRunningDaysForCagr = 0;

try {
  chrome.storage.local.get(['minActiveCagrDays'], (result) => {
    if (result.minActiveCagrDays !== undefined) {
      minRunningDaysForCagr = result.minActiveCagrDays;
    }
  });
} catch (e) { /* ignore if storage unavailable */ }

export function getMinCagrDays() {
  return minRunningDaysForCagr;
}

export function setMinCagrDays(days) {
  minRunningDaysForCagr = days;
  try {
    chrome.storage.local.set({ minActiveCagrDays: days });
  } catch (e) { /* ignore */ }
}

export function calculateActiveCagr(minDaysOverride) {
  const minDays = minDaysOverride !== undefined ? minDaysOverride : minRunningDaysForCagr;

  const symphonies = performanceData?.symphonyStats?.symphonies;
  if (!symphonies || symphonies.length === 0) {
    log('No symphony data available for Active CAGR calculation');
    return null;
  }

  const allValidSymphonies = symphonies.filter(s =>
    s.value > 0 &&
    s.addedStats &&
    s.addedStats["Running Days"] > 0
  );

  if (allValidSymphonies.length === 0) {
    log('No valid symphonies for Active CAGR calculation');
    return null;
  }

  const validSymphonies = minDays > 0
    ? allValidSymphonies.filter(s => s.addedStats["Running Days"] > minDays)
    : allValidSymphonies;

  const excludedCount = allValidSymphonies.length - validSymphonies.length;

  if (validSymphonies.length === 0) {
    log(`No symphonies meet minimum ${minDays} running days threshold`);
    return {
      activeCagr: null,
      simpleCagr: null,
      totalValue: allValidSymphonies.reduce((sum, s) => sum + s.value, 0),
      symphonyCount: 0,
      excludedCount,
      minDays,
      symphonyDetails: []
    };
  }

  const totalValue = validSymphonies.reduce((sum, s) => sum + s.value, 0);

  const symphonyDetails = validSymphonies.map(symphony => {
    const runningDays = symphony.addedStats["Running Days"];
    const yearsRunning = runningDays / 365.25;

    let symphonyCagr = 0;
    const cagrString = symphony.addedStats["CAGR% (Annual Return)"];
    if (cagrString) {
      const parsed = parseFloat(cagrString.replace('%', ''));
      if (!isNaN(parsed)) {
        symphonyCagr = parsed / 100;
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

  const activeCagr = symphonyDetails.reduce((sum, s) => sum + s.weightedCagr, 0);

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
    minDays,
    symphonyDetails
  };
}

function createActiveCagrTooltip(stats, anchorRect) {
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

  const symphonyRows = stats.symphonyDetails
    .sort((a, b) => b.weight - a.weight)
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
    <div style="margin-top:10px; padding: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; font-size: 11px; display: flex; align-items: center; gap: 8px;">
      <label style="color: #b0b8c9; white-space: nowrap;">Min trading days:</label>
      <input id="composer-min-cagr-days-input" type="number" min="0" step="1" value="${stats.minDays}"
        style="width: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #fff; padding: 3px 6px; font-size: 12px; text-align: center; outline: none;"
      />
      <span style="color: #b0b8c9; opacity: 0.7; font-size: 10px;">(0 = all)</span>
    </div>
    ${stats.excludedCount > 0 ? `
    <div style="margin-top:6px; padding: 6px 8px; background: rgba(251, 191, 36, 0.15); border-left: 3px solid #fbbf24; border-radius: 4px; font-size: 11px; color: #fbbf24;">
      ${stats.excludedCount} symphony${stats.excludedCount > 1 ? 'ies' : ''} excluded (≤${stats.minDays} trading days).
    </div>` : ''}
  `;
  document.body.appendChild(tooltip);

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

  const minDaysInput = tooltip.querySelector('#composer-min-cagr-days-input');
  if (minDaysInput) {
    minDaysInput.addEventListener('focus', () => { isOverTooltip = true; });
    minDaysInput.addEventListener('click', (e) => { e.stopPropagation(); });

    let debounceTimer = null;
    minDaysInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const newMin = Math.max(0, parseInt(minDaysInput.value, 10) || 0);
        setMinCagrDays(newMin);
        const newStats = calculateActiveCagr(newMin);
        if (newStats) {
          injectActiveCagrWithTooltip(newStats);
        }
      }, 600);
    });

    minDaysInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const newMin = Math.max(0, parseInt(minDaysInput.value, 10) || 0);
        setMinCagrDays(newMin);
        const newStats = calculateActiveCagr(newMin);
        if (newStats) {
          injectActiveCagrWithTooltip(newStats);
        }
      }
    });
  }

  if (anchorRect) {
    tooltip.style.left = `${anchorRect.right + 12}px`;
    tooltip.style.top = `${anchorRect.top - 8}px`;

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

  setTimeout(() => { tooltip.style.opacity = '1'; }, 0);

  return tooltip;
}

export function injectActiveCagrLoadingPlaceholder() {
  const banner = findMetricBanner();
  if (!banner) return;

  const grid = banner.classList.contains('grid') ? banner : banner.querySelector('.grid');
  if (!grid) return;

  if (grid.querySelector('.composer-active-cagr-stat')) return;

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

  grid.querySelectorAll('.composer-active-cagr-stat').forEach(el => el.remove());

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

  const existingCagr = grid.querySelector('.composer-cagr-stat');
  if (existingCagr && existingCagr.nextSibling) {
    grid.insertBefore(wrapper, existingCagr.nextSibling);
  } else if (existingCagr) {
    grid.appendChild(wrapper);
  } else {
    grid.appendChild(wrapper);
  }
}

export function injectCagrWithTooltip(stats) {
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

  grid.querySelectorAll('.composer-cagr-stat').forEach(el => el.remove());

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
    tooltip = createCagrTooltip(stats, wrapper.getBoundingClientRect(), valueDiv);
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

export function calculateCagrStats(history, allTransfers) {
  if (history.series.length <= 1) return null;

  try {
    const firstDate = new Date(history.epoch_ms[0]);
    const lastDate = new Date(history.epoch_ms[history.epoch_ms.length - 1]);
    const startValue = history.series[0];
    const endValue = history.series[history.series.length - 1];
    const achOnlyDeposits = sumNetDeposits(allTransfers);
    const cagrAdjustment = getStoredCagrAdjustment();
    const netDeposits = achOnlyDeposits + cagrAdjustment;

    const msInYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsInvested = (lastDate.getTime() - firstDate.getTime()) / msInYear;

    if (yearsInvested <= 0.01 || netDeposits <= 0) {
      log("Portfolio too new for CAGR calculation (less than 4 days)");
      return null;
    }

    const totalReturn = (endValue - netDeposits) / netDeposits;
    const cagr = Math.pow(1 + totalReturn, 1 / yearsInvested) - 1;

    log("");
    log("[All-Time CAGR]");
    log(`  Start Value: $${startValue.toFixed(2)} (${firstDate.toISOString().slice(0,10)})`);
    log(`  End Value:   $${endValue.toFixed(2)} (${lastDate.toISOString().slice(0,10)})`);
    log(`  ACH Deposits: $${achOnlyDeposits.toFixed(2)}`);
    log(`  CAGR Adjustment (wire/IRA): $${cagrAdjustment.toFixed(2)}`);
    log(`  Net Deposits (total): $${netDeposits.toFixed(2)}`);
    log(`  Years Invested: ${yearsInvested.toFixed(2)}`);
    log(`  Total Return (Composer formula): ${(totalReturn * 100).toFixed(2)}%`);
    log(`  CAGR: ${(cagr * 100).toFixed(2)}%`);

    return {
      cagr,
      totalReturn,
      years: yearsInvested,
      startValue,
      endValue,
      netDeposits,
      achOnlyDeposits,
      hasAdjustment: cagrAdjustment !== 0
    };
  } catch (error) {
    log("Error calculating CAGR:", error);
    return null;
  }
}
