import { getTokenAndAccount, fetchPortfolioHistory, fetchAchTransfers } from "../apiService.js";
import { log } from "./logger.js";

const ADJUSTMENT_KEY = 'composer-returns-adjustment';

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

function getStoredAdjustment() {
  const val = localStorage.getItem(ADJUSTMENT_KEY);
  return val !== null ? parseFloat(val) || 0 : 0;
}

function setStoredAdjustment(val) {
  localStorage.setItem(ADJUSTMENT_KEY, String(val));
}

function createReturnsTooltip(stats, anchorRect) {
  // Remove any existing tooltip
  const existing = document.getElementById('composer-returns-tooltip');
  if (existing) existing.remove();

  const adjustment = getStoredAdjustment();

  const tooltip = document.createElement('div');
  tooltip.id = 'composer-returns-tooltip';
  tooltip.style.position = 'fixed';
  tooltip.style.background = 'rgba(30,32,40,0.98)';
  tooltip.style.color = '#fff';
  tooltip.style.padding = '14px 18px';
  tooltip.style.borderRadius = '8px';
  tooltip.style.boxShadow = '0 2px 12px rgba(0,0,0,0.18)';
  tooltip.style.zIndex = 9999;
  tooltip.style.fontSize = '15px';
  tooltip.style.transition = 'opacity 0.15s';
  tooltip.style.opacity = '0';

  // Add input for adjustment
  tooltip.innerHTML = `
    <div style="font-weight:bold; margin-bottom:8px;">Portfolio Stats</div>
    <div style="margin-bottom:8px;">
      <label style="font-size:13px;">Adjust Net Deposits: </label>
      <input id="composer-returns-adjust-input" type="number" step="any" value="${adjustment}" style="width:90px; font-size:15px; padding:2px 6px; border-radius:4px; border:1px solid #888; margin-left:4px; color:#222;" />
    </div>
    <div id="composer-returns-popup-values">
      <div>Total Return: <b id="composer-total-return">${((stats.finalValue - (stats.netDeposits + adjustment)) / ((stats.netDeposits + adjustment) || 1) * 100).toFixed(2)}%</b></div>
      <div>Net Deposits: <b id="composer-net-deposits">$${(stats.netDeposits + adjustment).toFixed(2)}</b></div>
      <div>YTD Net Deposits: <b>$${stats.netYtdDeposits.toFixed(2)}</b></div>
      <div>Start Value: <b>$${stats.startValue.toFixed(2)}</b></div>
      <div>End Value: <b>$${stats.finalValue.toFixed(2)}</b></div>
      <div>YTD Start Value: <b>$${stats.ytdStartValue.toFixed(2)} (${stats.ytdStartDate.toISOString().slice(0,10)})</b></div>
    </div>
  `;
  document.body.appendChild(tooltip);

  // Add live update logic for adjustment
  setTimeout(() => {
    const input = document.getElementById('composer-returns-adjust-input');
    if (!input) return;
    input.addEventListener('input', () => {
      const adj = parseFloat(input.value) || 0;
      setStoredAdjustment(adj);
      const newNetDeposits = stats.netDeposits + adj;
      const newTotalReturn = (stats.finalValue - newNetDeposits) / (newNetDeposits || 1);
      document.getElementById('composer-net-deposits').textContent = `$${newNetDeposits.toFixed(2)}`;
      document.getElementById('composer-total-return').textContent = `${(newTotalReturn * 100).toFixed(2)}%`;
    });
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
    tooltip = createReturnsTooltip({ ytdReturn, ...stats }, wrapper.getBoundingClientRect());
    // Keep open if mouse enters tooltip
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

  // --- Total Return ---
  const startValue = history.series[0];
  const finalValue = history.series[history.series.length - 1];
  const netDeposits = sumNetDeposits(allTransfers, lastDate);
  const totalReturn = (finalValue - netDeposits) / (netDeposits || 1);

  // --- YTD Return ---
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  // Find the first trading day of the year in history
  let ytdStartIdx = history.epoch_ms.findIndex(ts => ts >= yearStart.getTime());
  if (ytdStartIdx === -1) ytdStartIdx = 0; // fallback
  const ytdStartValue = history.series[ytdStartIdx];
  const ytdStartDate = new Date(history.epoch_ms[ytdStartIdx]);
  const netYtdDeposits = sumNetDeposits(allTransfers, lastDate, ytdStartDate);
  const ytdReturn = (finalValue - ytdStartValue - netYtdDeposits) / ((ytdStartValue + netYtdDeposits) || 1);

  log("--- Portfolio Returns Breakdown ---");
  log("[Total Period]");
  log(`  Start Value: $${startValue.toFixed(2)}`);
  log(`  End Value:   $${finalValue.toFixed(2)}`);
  log(`  Net Deposits (all time): $${netDeposits.toFixed(2)}`);
  log(`  Total Return: ${(totalReturn * 100).toFixed(2)}%`);
  log("");
  log("[Year-to-Date]");
  log(`  Start Value (first trading day): $${ytdStartValue.toFixed(2)} (${ytdStartDate.toISOString().slice(0,10)})`);
  log(`  End Value:   $${finalValue.toFixed(2)}`);
  log(`  Net Deposits (YTD): $${netYtdDeposits.toFixed(2)}`);
  log(`  YTD Return: ${(ytdReturn * 100).toFixed(2)}%`);
  log("------------------------------------");

  // Wait for metric banner and inject into UI
  await waitForMetricBannerAndInject({
    startValue,
    finalValue,
    netDeposits,
    totalReturn,
    ytdStartValue,
    ytdStartDate,
    netYtdDeposits,
    ytdReturn
  });
} 