// Benchmark data fetching and processing

import { log } from './pyodide.js';
import { getCache, setCache } from './cacheManager.js';
import { getSeriesData } from './dataProcessing.js';

// Fetch benchmark data from Composer API
async function fetchBenchmarkData() {
  try {
    // First check if we have cached data
    const cachedData = await getBenchmarkFromCache();
    if (cachedData) {
      log('Using cached benchmark data');
      return cachedData;
    }
    
    log('Fetching SPY benchmark data...');
    
    const symphonyId = 'gP9YEyPpXRQj0hEDRHNp'; // The specific Symphony ID for a symphony that only holds SPY
    const response = await fetch(`https://backtest-api.composer.trade/api/v2/public/symphonies/${symphonyId}/backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        capital: 10000,
        apply_reg_fee: true,
        apply_taf_fee: true,
        apply_subscription: 'none',
        backtest_version: 'v2',
        slippage_percent: 0,
        spread_markup: 0,
        start_date: '1990-01-01',
        end_date: new Date().toISOString().split('T')[0],
        benchmark_symphonies: [],
      })
    });
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();

    log('Benchmark data fetched successfully');
    
    // Extract the relevant series data
    const benchmarkResponseData = data;
    if (!benchmarkResponseData || !benchmarkResponseData.dvm_capital) {
      throw new Error('Invalid benchmark data format');
    }
    
    const benchmark_series_data = getSeriesData('backtest', benchmarkResponseData, {id: symphonyId});
    
    // Cache the benchmark data
    saveBenchmarkToCache(benchmark_series_data);
    
    log(`Processed ${benchmark_series_data.deposit_adjusted_series.length} benchmark data points`);
    return benchmark_series_data;
  } catch (error) {
    log(`Error fetching benchmark data: ${error.message}`);
    console.error(`Failed to fetch benchmark data: ${error.message}`);
    
    // Return fallback data if API fails
    return null;
  }
}

// Save benchmark data to IndexedDB
function saveBenchmarkToCache(benchmarkData) {
  try {
    const cacheKey = 'spy_benchmark_data';
    const cacheExpiry = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
    
    // Store the data in IndexedDB
    setCache(cacheKey, benchmarkData, cacheExpiry)
      .then(() => log('Benchmark data saved to cache'))
      .catch(error => log(`Warning: Could not save benchmark to cache: ${error.message}`));
  } catch (error) {
    log(`Warning: Could not save benchmark to cache: ${error.message}`);
  }
}

// Get benchmark data from IndexedDB
function getBenchmarkFromCache() {
  return new Promise((resolve, reject) => {
    try {
      const cacheKey = 'spy_benchmark_data';
      
      getCache(cacheKey).then(cachedItem => {
        if (!cachedItem || cachedItem.expiry <= Date.now()) {
          log('Benchmark cache is missing or expired, will fetch fresh data');
          resolve(null);
          return;
        }
        
        log(`Retrieved benchmark data from cache (${cachedItem.value.deposit_adjusted_series.length} points)`);
        resolve(cachedItem.value);
      }).catch(error => {
        log(`Warning: Could not retrieve benchmark from cache: ${error.message}`);
        resolve(null);
      });
    } catch (error) {
      log(`Warning: Could not retrieve benchmark from cache: ${error.message}`);
      resolve(null);
    }
  });
}

// Align benchmark data with strategy data
function alignBenchmarkData(strategyData, benchmarkData) {
  log('Aligning benchmark data with strategy data...');
  
  if (!benchmarkData || !benchmarkData.epoch_ms || !benchmarkData.deposit_adjusted_series) {
    log('No benchmark data to align');
    return null;
  }
  
  const strategyDates = strategyData.epoch_ms;
  const benchmarkDates = benchmarkData.epoch_ms;
  const benchmarkValues = benchmarkData.deposit_adjusted_series;
  
  // Create a map of benchmark dates to values for quick lookup
  const benchmarkMap = {};
  for (let i = 0; i < benchmarkDates.length; i++) {
    benchmarkMap[benchmarkDates[i]] = benchmarkValues[i];
  }
  
  // Find the closest benchmark date for each strategy date
  const alignedBenchmarkSeries = [];
  for (const strategyDate of strategyDates) {
    // First check for exact match
    if (benchmarkMap[strategyDate] !== undefined) {
      alignedBenchmarkSeries.push(benchmarkMap[strategyDate]);
      continue;
    }
    
    // If no exact match, find the closest date before the strategy date
    let closestDate = null;
    let closestValue = null;
    
    for (let i = 0; i < benchmarkDates.length; i++) {
      const benchmarkDate = benchmarkDates[i];
      if (benchmarkDate <= strategyDate && (closestDate === null || benchmarkDate > closestDate)) {
        closestDate = benchmarkDate;
        closestValue = benchmarkValues[i];
      }
    }
    
    if (closestValue !== null) {
      alignedBenchmarkSeries.push(closestValue);
    } else {
      // If no earlier date found, use the earliest available
      alignedBenchmarkSeries.push(benchmarkValues[0]);
    }
  }
  
  log(`Aligned benchmark data: ${alignedBenchmarkSeries.length} points`);
  return alignedBenchmarkSeries;
}

export { fetchBenchmarkData, alignBenchmarkData }; 