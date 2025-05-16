// Message handler for background.js

import { getQuantStats } from './quantStats.js';
import { getTearsheetHtml } from './tearsheet.js';
import { enqueueTask } from './taskQueue.js';
import { setCache, getCache } from './cacheManager.js';
import { generateReturnsArrayFromDepositAdjustedSeries } from './dataProcessing.js';
import { log } from './pyodide.js';

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
        log("Getting QuantStats");
        log("sym", symphony);
        log("dc", symphony?.dailyChanges);

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