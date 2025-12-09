// Message handler for background.js

import { getQuantStats } from './quantStats.js';
import { getTearsheetHtml } from './tearsheet.js';
import { enqueueTask } from './taskQueue.js';
import { setCache, getCache } from './cacheManager.js';
import { generateReturnsArrayFromDepositAdjustedSeries } from './dataProcessing.js';
import { log } from './pyodide.js';

const YAHOO_FINANCE_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const BENCHMARK_CACHE_TIMEOUT = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Fetch benchmark data from Yahoo Finance (runs in background script to avoid CORS)
 */
async function fetchBenchmarkFromYahoo(ticker, range = '2y') {
  const url = `${YAHOO_FINANCE_BASE_URL}/${ticker}?range=${range}&interval=1d`;
  const cacheKey = `composerQuantTools-benchmark-${ticker}-${range}`;

  // Check cache first
  try {
    const cachedItem = await getCache(cacheKey);
    if (cachedItem && cachedItem.expiry > Date.now()) {
      console.log(`[composer-quant-tools] Returning cached benchmark data for ${ticker}`);
      return cachedItem.value;
    }
  } catch (e) {
    console.log(`[composer-quant-tools] Cache miss for ${ticker}:`, e);
  }

  // Fetch from Yahoo Finance
  console.log(`[composer-quant-tools] Fetching benchmark data for ${ticker} from Yahoo Finance`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status} for ${ticker}`);
  }

  const data = await response.json();

  if (!data?.chart?.result?.[0]) {
    throw new Error(`No data returned for ${ticker}`);
  }

  const result = data.chart.result[0];
  const timestamps = result.timestamp || [];
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ||
                   result.indicators?.quote?.[0]?.close || [];

  if (timestamps.length === 0 || adjClose.length === 0) {
    throw new Error(`Empty price data for ${ticker}`);
  }

  // Convert Unix timestamps (seconds) to milliseconds
  const dates = timestamps.map(ts => ts * 1000);

  // Filter out null/undefined prices and their corresponding dates
  const validData = dates.reduce((acc, date, i) => {
    if (adjClose[i] != null && !isNaN(adjClose[i])) {
      acc.dates.push(date);
      acc.prices.push(adjClose[i]);
    }
    return acc;
  }, { dates: [], prices: [] });

  // Calculate daily returns
  const returns = calculateDailyReturns(validData.prices);

  const benchmarkData = {
    ticker,
    dates: validData.dates,
    prices: validData.prices,
    returns,
  };

  // Cache the result
  try {
    const expiry = Date.now() + BENCHMARK_CACHE_TIMEOUT;
    await setCache(cacheKey, benchmarkData, expiry);
  } catch (cacheError) {
    console.log(`[composer-quant-tools] Failed to cache benchmark data for ${ticker}:`, cacheError);
  }

  return benchmarkData;
}

/**
 * Calculate daily returns from price array
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

// Set up message handlers
function setupMessageHandlers() {
  // External message handler (for receiving authentication tokens)
  chrome.runtime.onMessageExternal.addListener(
    (request, sender, sendResponse) => {
      if (request.action === "onToken") {
        const expiry = Date.now() + 10 * 60 * 1000;
        // save the token in session and refresh it every 10 minutes
        chrome.storage.local.set({ tokenInfo: { token: request.token, expiry } });
      }
    },
  );

  // Internal message handler
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Received message", request);

    const task = () => new Promise((resolve) => {
      if (request.action === "getQuantStats") {
        const symphony = request?.symphony;
        const benchmarkData = request?.benchmarkData || null;
        log("Getting QuantStats");
        log("sym", symphony);
        log("dc", symphony?.dailyChanges);

        // Include benchmark hash in cache key if benchmarks provided
        // v2: Using scipy linregress instead of qs.stats.greeks
        const benchmarkSuffix = benchmarkData ? '_withBenchmarks_v2' : '';
        const cacheKey = `quantstats_${symphony.id}${benchmarkSuffix}`;
        const cacheExpiry = Date.now() + 3 * 60 * 60 * 1000;

        getCache(cacheKey).then(cachedItem => {
          if (cachedItem && cachedItem.expiry > Date.now()) {
            console.log("Returning cached result");
            sendResponse(cachedItem.value);
          } else {
            getQuantStats(symphony, symphony?.dailyChanges, benchmarkData).then(quantStats => {
              setCache(cacheKey, quantStats, cacheExpiry).catch(error => {
                console.error("Error setting cache:", error);
              });
              sendResponse(quantStats);
            }).catch(error => {
              console.error("Error getting QuantStats:", error);
              sendResponse({ error: "An error occurred while processing the request" });
            });
          }
        }).catch(error => {
          console.error("Error getting cache:", error);
          getQuantStats(symphony, symphony?.dailyChanges, benchmarkData).then(quantStats => {
            sendResponse(quantStats);
          }).catch(error => {
            console.error("Error getting QuantStats:", error);
            sendResponse({ error: "An error occurred while processing the request" });
          });
        }).finally(resolve);
      } else if (request.action === "getTearsheet") {
        const symphony = request?.symphony;
        const backtestData = request?.backtestData;

        log("Getting TearsheetBlobUrl");
        log("sym", symphony);
        log("dc", symphony?.dailyChanges);

        getTearsheetHtml(
          symphony,
          symphony?.dailyChanges,
          request?.type,
          backtestData,
        ).then((TearsheetHtml) => {
          sendResponse(TearsheetHtml);
        }).catch((error) => {
          sendResponse({error});
        }).finally(resolve);
      } else if (request.action === "processSymphonies") {
        // Get the User Defined Upload Url from storage
        chrome.storage.local.get(['userDefinedUploadUrl'], function(result) {
          if (!result.userDefinedUploadUrl) {
            console.log("No User Defined Upload Url configured, skipping processSymphonies");
            sendResponse({ success: false, error: "No User Defined Upload Url configured" });
            resolve();
            return;
          }

          try {
            fetch(result.userDefinedUploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                // this is the structure needed by the API
                type: "live",
                symphonies: request?.performanceData?.symphonyStats?.symphonies?.map?.((symphony) => ({
                  symphony,
                  backtestData: request?.performanceData?.backtestData,
                  seriesData: {
                    ...symphony?.dailyChanges,
                    returns: generateReturnsArrayFromDepositAdjustedSeries(symphony?.dailyChanges?.deposit_adjusted_series),
                  }
                }))
              }),
            })
          } catch (error) {
            console.error("Error processing symphonies:", error);
            sendResponse({ success: false, error: error.message });
          }
          sendResponse({ success: true, message: 'data sent' });
          resolve();
        });
      } else if (request.action === "fetchBenchmarkData") {
        const { ticker, range } = request;
        console.log(`[composer-quant-tools] Fetching benchmark data for ${ticker}`);

        fetchBenchmarkFromYahoo(ticker, range || '2y')
          .then(benchmarkData => {
            sendResponse(benchmarkData);
          })
          .catch(error => {
            console.error(`[composer-quant-tools] Error fetching benchmark for ${ticker}:`, error);
            sendResponse({ error: error.message });
          })
          .finally(resolve);
      } else {
        sendResponse({ error: "Unknown action" });
        resolve();
      }
    });

    enqueueTask(task);

    return true; // Indicates we will send a response asynchronously
  });
}

export { setupMessageHandlers }; 