// QuantStats generation logic using quantstats-js (JavaScript)

import { calculateComprehensiveMetrics } from '../lib/jslib/quantstats-js/src/reports.js';
import { drawdownDetails } from '../lib/jslib/quantstats-js/src/utils.js';

// Maps quantstats-js key names to the Python quantstats_lumi key names
// so that downstream consumers see the same keys they expect.
const KEY_MAP = {
  'Cumulative Return %': 'Total Return',
  'CAGR%': 'CAGR% (Annual Return)',
  'Volatility (ann.) %': 'Volatility (ann.)',
  'Max Drawdown %': 'Max Drawdown',
  'Avg. Drawdown %': 'Avg. Drawdown',
  'Prob. Sharpe Ratio %': 'Prob. Sharpe Ratio',
  'Risk-Free Rate %': 'Risk-Free Rate',
  'Time in Market %': 'Time in Market',
  'Expected Daily %': 'Expected Daily%',
  'Expected Monthly %': 'Expected Monthly%',
  'Expected Yearly %': 'Expected Yearly%',
  'Daily Value-at-Risk %': 'Daily Value-at-Risk',
  'Expected Shortfall (cVaR) %': 'Expected Shortfall (cVaR)',
  'MTD %': 'MTD',
  '3M %': '3M',
  '6M %': '6M',
  'YTD %': 'YTD',
  '1Y (ann.) %': '1Y',
  '3Y (ann.) %': '3Y (ann.)',
  '5Y (ann.) %': '5Y (ann.)',
  '10Y (ann.) %': '10Y (ann.)',
  'All-time (ann.) %': 'All-time (ann.)',
  'Best Day %': 'Best Day',
  'Worst Day %': 'Worst Day',
  'Best Month %': 'Best Month',
  'Worst Month %': 'Worst Month',
  'Best Year %': 'Best Year',
  'Worst Year %': 'Worst Year',
  'Win Days %': 'Win Days%',
  'Win Month %': 'Win Month%',
  'Win Quarter %': 'Win Quarter%',
  'Win Year %': 'Win Year%',
};

// Spacer keys added by the JS library for display formatting — drop them.
const SPACER_KEYS = new Set(['', ' ', '  ', '   ', '    ', '     ', 'R²']);

function remapMetrics(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SPACER_KEYS.has(key)) continue;
    const mapped = KEY_MAP[key] ?? key;
    out[mapped] = value;
  }
  return out;
}

function buildMonthlyDict(returns, dates) {
  // Build a Python-style monthly dict: {month: {year: returnValue, ...}, ...}
  const monthBuckets = new Map();
  for (let i = 0; i < returns.length; i++) {
    const d = dates[i];
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const key = `${year}-${month}`;
    if (!monthBuckets.has(key)) {
      monthBuckets.set(key, { year, month, rets: [] });
    }
    monthBuckets.get(key).rets.push(returns[i]);
  }

  const result = {};
  for (const { year, month, rets } of monthBuckets.values()) {
    const monthReturn = rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
    if (!result[month]) result[month] = {};
    result[month][year] = monthReturn;
  }
  return result;
}

function addExtraMetrics(metrics, returns, dates) {
  const n = returns.length;
  if (n === 0) return;

  const wins = returns.filter(r => r > 0).length;
  const losses = returns.filter(r => r <= 0).length;
  const sum = returns.reduce((a, b) => a + b, 0);
  const avg = sum / n;

  const sorted = [...returns].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  metrics['Running Days'] = n;
  metrics['Avg. Daily Return'] = (avg * 100).toFixed(2) + '%';
  metrics['Median Daily Return'] = (median * 100).toFixed(2) + '%';
  metrics['Win Days'] = wins;
  metrics['Loss Days'] = losses;
}

async function getQuantStats(symphony, series_data) {
  if (series_data.epoch_ms.length < 2) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate QuantStats`,
    };
  }

  const returns = symphony.dailyChanges.percentageReturns.map(d => d.percentChange);
  const epochMs = symphony.dailyChanges.percentageReturns.map(d => new Date(d.dateString).getTime());

  try {
    const dates = epochMs.map(ms => new Date(ms));
    const returnsWithDates = { values: returns, index: dates };

    let quantstats_metrics = {};
    try {
      const raw = calculateComprehensiveMetrics(returnsWithDates, 0, 'full');
      quantstats_metrics = remapMetrics(raw);
      addExtraMetrics(quantstats_metrics, returns, dates);
    } catch (e) {
      console.error('QuantStats metrics error:', e);
      quantstats_metrics = {};
    }

    let quantstats_months = {};
    try {
      quantstats_months = buildMonthlyDict(returns, dates);
    } catch (e) {
      console.error('QuantStats monthly returns error:', e);
    }

    let quantstats_drawdown_details = [];
    try {
      const allDetails = drawdownDetails(returns, dates);
      // Sort by max drawdown ascending (most negative first), take worst 30
      quantstats_drawdown_details = allDetails
        .sort((a, b) => a['max drawdown'] - b['max drawdown'])
        .slice(0, 30);
    } catch (e) {
      console.error('QuantStats drawdown details error:', e);
    }

    return JSON.stringify({ quantstats_metrics, quantstats_months, quantstats_drawdown_details });
  } catch (err) {
    console.error(err);
    return { error: 'An error occurred: ' + err.message };
  }
}

export { getQuantStats };
