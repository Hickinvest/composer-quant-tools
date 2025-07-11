import { getTokenAndAccount, fetchPortfolioHistory, fetchAchTransfers } from "../apiService.js";
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

function injectYtdReturnWithTooltip({
  ytdReturn,
  ...stats
}) {
  if (ytdReturn === undefined) return;

  const banner = document.querySelector('.metric-banner');
  if (!banner) return;
  const grid = banner.querySelector('.grid');
  if (!grid) return;

  // Remove previous injected stats if any
  grid.querySelectorAll('.composer-returns-stat').forEach(el => el.remove());

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

  grid.appendChild(wrapper);
}

async function waitForMetricBannerAndInject(stats, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    function check() {
      const banner = document.querySelector('.metric-banner');
      const grid = banner?.querySelector('.grid');
      if (banner && grid) {
        injectYtdReturnWithTooltip(stats);
        resolve(true);
      } else if (Date.now() - start < timeoutMs) {
        setTimeout(check, 100);
      } else {
        log('Warning: .metric-banner or .grid not found after waiting.');
        resolve(false);
      }
    }
    check();
  });
}

export async function logPortfolioReturns() {
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

  // Wait for metric banner and inject into UI
  if (ytdStats) {
    await waitForMetricBannerAndInject(ytdStats);
  }
} 