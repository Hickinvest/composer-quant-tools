import { initTokenAndAccountUtil } from './utils/tokenAndAccountUtil.js';
import { initFactsheet } from './utils/factsheet.js';
import { initPortfolio } from './portfolio.js';

export function main() {
  // Listen for messages from the MAIN world
  window.addEventListener('message', function(event) {
    // Handle React props results
    if (event.data.type === 'REACT_PROPS_RESULT') {
      chrome.runtime.sendMessage({
        type: 'REACT_PROPS_RESULT',
        id: event.data.id,
        data: event.data.data,
        error: event.data.error
      });
    }
    
    // Handle storage requests from MAIN world
    else if (event.data.type === 'STORAGE_REQUEST') {
      const { operation, id, keys, items } = event.data;
      
      try {
        if (operation === 'get') {
          chrome.storage.local.get(keys, (result) => {
            const error = chrome.runtime.lastError;
            window.postMessage({
              type: 'STORAGE_RESULT',
              operation: 'get',
              id: id,
              data: result,
              error: error ? error.message : null
            }, '*');
          });
        }
        else if (operation === 'set') {
          chrome.storage.local.set(items, () => {
            const error = chrome.runtime.lastError;
            window.postMessage({
              type: 'STORAGE_RESULT',
              operation: 'set',
              id: id,
              success: !error,
              error: error ? error.message : null
            }, '*');
          });
        }
        else if (operation === 'remove') {
          chrome.storage.local.remove(keys, () => {
            const error = chrome.runtime.lastError;
            window.postMessage({
              type: 'STORAGE_RESULT',
              operation: 'remove',
              id: id,
              success: !error,
              error: error ? error.message : null
            }, '*');
          });
        }
      } catch (err) {
        window.postMessage({
          type: 'STORAGE_RESULT',
          operation: operation,
          id: id,
          success: false,
          error: err.message
        }, '*');
      }
    }
  });

  // Initialize all components
  initTokenAndAccountUtil();
  initFactsheet();
  initPortfolio();
  
  // Signal that init is ready
  window.postMessage({ type: 'INIT_READY' }, '*');
}