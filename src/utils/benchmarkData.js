/**
 * Utility for fetching benchmark data (SPY, QQQ, BIL) for alpha/beta calculations
 *
 * NOTE: Yahoo Finance requests must go through the background script due to CORS.
 * Content scripts in MAIN world cannot make cross-origin requests to Yahoo Finance.
 */

import { log } from './logger.js';

// Supported benchmarks
export const BENCHMARKS = {
  SPY: 'SPY',   // S&P 500
  QQQ: 'QQQ',   // Nasdaq 100
  BIL: 'BIL',   // Risk-free rate proxy (1-3 Month T-Bill ETF)
};

/**
 * Fetch historical price data from Yahoo Finance via background script
 * @param {string} ticker - The ticker symbol (SPY, QQQ, BIL)
 * @param {string} range - Time range (1y, 2y, 5y, max)
 * @returns {Promise<{dates: number[], prices: number[], returns: number[]}>}
 */
export async function fetchBenchmarkPrices(ticker, range = '2y') {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'fetchBenchmarkData', ticker, range },
      (response) => {
        if (chrome.runtime.lastError) {
          log(`Error fetching benchmark data for ${ticker}:`, chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          log(`Error fetching benchmark data for ${ticker}:`, response.error);
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

/**
 * Calculate daily returns from price array
 * @param {number[]} prices - Array of prices
 * @returns {number[]} - Array of daily returns (first element is 0)
 */
function calculateDailyReturns(prices) {
  if (prices.length < 2) return [0];

  const returns = [0]; // First day has no return
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    const currPrice = prices[i];
    const dailyReturn = prevPrice !== 0 ? (currPrice - prevPrice) / prevPrice : 0;
    returns.push(dailyReturn);
  }
  return returns;
}

/**
 * Fetch all benchmark data (SPY, QQQ, BIL) in parallel
 * @param {string} range - Time range
 * @returns {Promise<{SPY: Object, QQQ: Object, BIL: Object}>}
 */
export async function fetchAllBenchmarks(range = '2y') {
  try {
    const [spy, qqq, bil] = await Promise.all([
      fetchBenchmarkPrices(BENCHMARKS.SPY, range),
      fetchBenchmarkPrices(BENCHMARKS.QQQ, range),
      fetchBenchmarkPrices(BENCHMARKS.BIL, range),
    ]);

    return { SPY: spy, QQQ: qqq, BIL: bil };
  } catch (error) {
    log('Error fetching all benchmarks:', error);
    throw error;
  }
}

/**
 * Align benchmark returns with symphony dates
 * Returns benchmark data that matches the symphony's date range
 * @param {Object} benchmarkData - Benchmark data from fetchBenchmarkPrices
 * @param {number[]} symphonyEpochMs - Symphony dates in epoch milliseconds
 * @returns {{dates: number[], returns: number[]}} - Aligned benchmark data
 */
export function alignBenchmarkWithSymphony(benchmarkData, symphonyEpochMs) {
  if (!benchmarkData?.dates?.length || !symphonyEpochMs?.length) {
    return { dates: [], returns: [] };
  }

  // Create a map of benchmark data by date string for fast lookup
  const benchmarkByDate = new Map();
  benchmarkData.dates.forEach((date, i) => {
    const dateStr = new Date(date).toDateString();
    benchmarkByDate.set(dateStr, {
      date,
      return: benchmarkData.returns[i],
    });
  });

  // Align with symphony dates
  const alignedDates = [];
  const alignedReturns = [];

  symphonyEpochMs.forEach(epochMs => {
    const dateStr = new Date(epochMs).toDateString();
    const benchmarkPoint = benchmarkByDate.get(dateStr);

    if (benchmarkPoint) {
      alignedDates.push(epochMs);
      alignedReturns.push(benchmarkPoint.return);
    } else {
      // If no exact match, use 0 return (market was likely closed)
      alignedDates.push(epochMs);
      alignedReturns.push(0);
    }
  });

  return {
    dates: alignedDates,
    returns: alignedReturns,
  };
}

/**
 * Get aligned benchmark returns for a symphony
 * Convenience function that fetches and aligns in one call
 * @param {string} ticker - Benchmark ticker (SPY, QQQ, BIL)
 * @param {number[]} symphonyEpochMs - Symphony dates
 * @returns {Promise<number[]>} - Aligned returns array
 */
export async function getAlignedBenchmarkReturns(ticker, symphonyEpochMs) {
  const benchmarkData = await fetchBenchmarkPrices(ticker);
  const aligned = alignBenchmarkWithSymphony(benchmarkData, symphonyEpochMs);
  return aligned.returns;
}

// Store fetched benchmarks globally for reuse across symphonies
let cachedBenchmarks = null;
let cachedBenchmarksTimestamp = 0;

/**
 * Get or fetch all benchmarks (with in-memory caching for current session)
 * @returns {Promise<{SPY: Object, QQQ: Object, BIL: Object}>}
 */
export async function getBenchmarks() {
  const now = Date.now();
  const cacheAge = now - cachedBenchmarksTimestamp;

  // Use in-memory cache if less than 1 hour old
  if (cachedBenchmarks && cacheAge < 60 * 60 * 1000) {
    return cachedBenchmarks;
  }

  cachedBenchmarks = await fetchAllBenchmarks();
  cachedBenchmarksTimestamp = now;
  return cachedBenchmarks;
}

/**
 * Clear the in-memory benchmark cache
 */
export function clearBenchmarkCache() {
  cachedBenchmarks = null;
  cachedBenchmarksTimestamp = 0;
}
