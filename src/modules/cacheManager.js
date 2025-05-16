// IndexedDB cache management functions

import { log } from './pyodide.js';

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

// Setup periodic cache cleanup
function setupCacheCleanup() {
  chrome.alarms.create('clearOldCache', { periodInMinutes: 1440 }); // Run once a day

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'clearOldCache') {
      clearOldCache().then(() => {
        log('Old cache items cleared');
      }).catch((error) => {
        console.error('Error clearing old cache items:', error);
      });
    }
  });
}

export { setCache, getCache, clearOldCache, setupCacheCleanup }; 