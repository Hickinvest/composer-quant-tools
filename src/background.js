let pyodideReadyPromise;
let queue = [];
let isProcessing = false;

function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const task = queue.shift();
  task().then(() => {
    isProcessing = false;
    processQueue();
  }).catch(error => {
    console.error("Error processing task:", error);
    isProcessing = false;
    processQueue();
  });
}

async function loadPyodideAndPackages() {
  importScripts(chrome.runtime.getURL("/lib/pyodide/pyodide.js"));
  self.pyodide = await loadPyodide({
    indexURL: chrome.runtime.getURL("/lib/pyodide/"),
  });
  await pyodide.loadPackage("pandas");
  await pyodide.loadPackage("micropip");
  await pyodide.loadPackage("ipython");
  await pyodide.loadPackage("openblas");
  await pyodide.loadPackage("/lib/pyodide/quantstats_lumi-0.3.3-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/tabulate-0.9.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/yfinance-0.2.48-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/seaborn-0.13.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/platformdirs-4.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/frozendict-2.4.6-py312-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/multitasking-0.0.11-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/matplotlib-3.5.2-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/cycler-0.12.1-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/fonttools-4.51.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pyparsing-3.1.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/matplotlib_pyodide-0.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/scipy-1.12.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/requests-2.31.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/charset_normalizer-3.3.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/idna-3.7-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/urllib3-2.2.1-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/certifi-2024.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/beautifulsoup4-4.12.3-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/soupsieve-2.5-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/peewee-3.17.3-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/cffi-1.16.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pycparser-2.22-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/lxml-5.2.1-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/html5lib-1.1-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/webencodings-0.5.1-py2.py3-none-any.whl");
  return pyodide;
}

pyodideReadyPromise = loadPyodideAndPackages();

async function getTearsheetHtml(symphony, series_data, type, backtestData) {
  // series_data is an object with the following structure
  // {
  //   "epoch_ms":[1711584000000],
  //   "series":[198.9],
  //   "deposit_adjusted_series":[200]
  // }

  if (type === "backtest") {
    series_data = { deposit_adjusted_series: [], epoch_ms: [] };
    Object.entries(backtestData.dvm_capital[symphony.id]).forEach(
      ([day, amount]) => {
        series_data.epoch_ms.push(day * 24 * 60 * 60 * 1000);
        series_data.deposit_adjusted_series.push(amount);
      },
    );
  } else if (type === "oos") {
    const oosStartDate = new Date(
      symphony.last_semantic_update_at.split("[")[0],
    ); // this is removing the timezone
    series_data = { deposit_adjusted_series: [], epoch_ms: [] };
    Object.entries(backtestData.dvm_capital[symphony.id]).forEach(
      ([day, amount]) => {
        if (oosStartDate >= new Date(day * 24 * 60 * 60 * 1000)) {
          return;
        }
        series_data.epoch_ms.push(day * 24 * 60 * 60 * 1000);
        series_data.deposit_adjusted_series.push(amount);
      },
    );
  }
  // if type is live then we don't need to do anything since the series_data is already in the correct format

  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate tearsheet report`,
    };
  }
  series_data.returns =  generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);

  pyodideReadyPromise = pyodideReadyPromise || loadPyodideAndPackages();
  let pyodide = await pyodideReadyPromise;
  try {
    let tearsheetHtml = await pyodide.runPythonAsync(`

        import quantstats_lumi as qs
        import pandas as pd
        import json
        import sys
        import matplotlib
        import tempfile
        import os
        import warnings

        # suppress warnings because they are very noisy
        warnings.filterwarnings("ignore")

        # Set matplotlib to use the Agg backend to avoid displaying plots this is necessary for running in a headless environment
        matplotlib.use('Agg')

        symphony_id = '${symphony.id.replace(/'/g, "\\'")}'
        symphony_name = '${symphony.name.replace(/'/g, "\\'")} ${type}'

        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()

        # Parse the JSON data
        data = json.loads('''${JSON.stringify(series_data)}''')


        # Create pandas Series for each field
        datetime_series = pd.to_datetime(data['epoch_ms'], unit='ms')
        # series_series = pd.Series(data['series'], index=datetime_series, name='series') # we are not using the series for now since it will include deposits and withdrawals skewing the results
        # deposit_adjusted_series = pd.Series(data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        returns_series = pd.Series(data['returns'], index=datetime_series, name='returns')

        # Generate HTML report to a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False)
        temp_file_path = temp_file.name
        temp_file.close()

        qs.reports.html(returns_series, title=symphony_name, output=temp_file_path)
        with open(temp_file_path, 'r', encoding='utf-8') as file:
            html_report_content = file.read()
        os.remove(temp_file_path)
        html_report_content

      `);

    return tearsheetHtml;
  } catch (err) {
    console.error(err);
    return { error: "An error occurred: " + err.message };
  }
}

async function getQuantStats(symphony, series_data) {
  // series_data is an object with the following structure
  // {
  //   "epoch_ms":[1711584000000],
  //   "series":[198.9],
  //   "deposit_adjusted_series":[200]
  // }
  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate QuantStats`,
    };
  }
  series_data.returns = generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);

  pyodideReadyPromise = pyodideReadyPromise || loadPyodideAndPackages();
  let pyodide = await pyodideReadyPromise;
  try {
    let output = await pyodide.runPythonAsync(`

        import quantstats_lumi as qs
        import pandas as pd
        import json
        import warnings

        # suppress warnings because they are very noisy
        warnings.filterwarnings("ignore")

        symphony_id = '${symphony.id.replace(/'/g, "\\'")}'
        symphony_name = '${symphony.name.replace(/'/g, "\\'")}'

        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()

        # Parse the JSON data
        data = json.loads('''${JSON.stringify(series_data)}''')


        # Create pandas Series for each field
        datetime_series = pd.to_datetime(data['epoch_ms'], unit='ms')
        # series_series = pd.Series(data['series'], index=datetime_series, name='series') # we are not using the series for now since it will include deposits and withdrawals skewing the results
        # deposit_adjusted_series = pd.Series(data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        returns_series = pd.Series(data['returns'], index=datetime_series, name='returns')

        quantstats_metrics = qs.reports.metrics(returns_series, title=symphony_name, mode='full', display = False, sep=True, prepare_returns=False, internal="True").to_dict()['Strategy']
        quantstats_months = qs.stats.monthly_returns(returns_series).to_dict()
        quantstats_drawdown_series = qs.stats.to_drawdown_series(returns_series)
        quantstats_drawdown_details = qs.stats.drawdown_details(quantstats_drawdown_series).sort_values(by='max drawdown', ascending=True)[:30].to_dict('records')
        # qs.reports.html(returns_series, title=symphony_id, output=f"/{symphony_id}.html") would love to get this working and maybe serve it as a blob

        json.dumps({'quantstats_metrics':quantstats_metrics, 'quantstats_months':quantstats_months, 'quantstats_drawdown_details': quantstats_drawdown_details})

      `);

    return output.replace(/NaN/g, '"NaN"');
  } catch (err) {
    console.error(err);
    return { error: "An error occurred: " + err.message };
  }
}

function generateReturnsArrayFromDepositAdjustedSeries(deposit_adjusted_series) {
  let previousValue = deposit_adjusted_series[0];
  return deposit_adjusted_series.map((point) => {
    const thisValue = (point - previousValue) / previousValue;
    previousValue = point;
    return thisValue;
  });

}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("QuantStatsCache", 1);
    request.onerror = reject;
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore("cache", { keyPath: "id" });
    };
  });
}

function setCache(key, value, expiry) {
  return new Promise((resolve, reject) => {
    openDB().then(db => {
      const transaction = db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      const request = store.put({ id: key, value, expiry });
      request.onerror = reject;
      request.onsuccess = () => resolve();
    }).catch(reject);
  });
}

function getCache(key) {
  return new Promise((resolve, reject) => {
    openDB().then(db => {
      const transaction = db.transaction(["cache"], "readonly");
      const store = transaction.objectStore("cache");
      const request = store.get(key);
      request.onerror = reject;
      request.onsuccess = () => resolve(request.result);
    }).catch(reject);
  });
}

async function clearOldCache() {
  const db = await openDB();
  const transaction = db.transaction(["cache"], "readwrite");
  const store = transaction.objectStore("cache");
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000; // One week ago

  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.expiry < oneWeekAgo) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = reject;
  });
}

// Use alarms API for periodic cache cleanup
chrome.alarms.create('clearOldCache', { periodInMinutes: 1440 }); // Run once a day

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'clearOldCache') {
    clearOldCache().then(() => {
      console.log('Old cache items cleared');
    }).catch((error) => {
      console.error('Error clearing old cache items:', error);
    });
  }
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    if (request.action === "onToken") {
      const expiry = Date.now() + 10 * 60 * 1000;
      // save the token in session and refresh it every 10 minutes
      chrome.storage.local.set({ tokenInfo: { token: request.token, expiry } });
    }
  },
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Received message", request);

  const task = () => new Promise((resolve) => {
    if (request.action === "getQuantStats") {
      const symphony = request?.symphony;
      console.log("Getting QuantStats");
      console.log("sym", symphony);
      console.log("dc", symphony?.dailyChanges);

      const cacheKey = `quantstats_${symphony.id}`;
      const cacheExpiry = Date.now() + 3 * 60 * 60 * 1000;

      getCache(cacheKey).then(cachedItem => {
        if (cachedItem && cachedItem.expiry > Date.now()) {
          console.log("Returning cached result");
          sendResponse(cachedItem.value);
        } else {
          getQuantStats(symphony, symphony?.dailyChanges).then(quantStats => {
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
        getQuantStats(symphony, symphony?.dailyChanges).then(quantStats => {
          sendResponse(quantStats);
        }).catch(error => {
          console.error("Error getting QuantStats:", error);
          sendResponse({ error: "An error occurred while processing the request" });
        });
      }).finally(resolve);
    } else if (request.action === "getTearsheet") {
      const symphony = request?.symphony;
      const backtestData = request?.backtestData;

      console.log("Getting TearsheetBlobUrl");
      console.log("sym", symphony);
      console.log("dc", symphony?.dailyChanges);

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
        // .then((response) => {
        //   if (response.ok) {
        //     response.json().then((data) => {
        //       sendResponse({ success: true, data });
        //     });
        //   } else {
        //     sendResponse({ success: false, error: "Response not ok" });
        //   }
        // }).catch((error) => {
        //   sendResponse({ success: false, error: error.message });
        // }).finally(resolve);
      });
    } else {
      sendResponse({ error: "Unknown action" });
      resolve();
    }
  });

  queue.push(task);
  processQueue();

  return true; // Indicates we will send a response asynchronously
});
