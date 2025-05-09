/**
 * Utility to access chrome.storage.local from the MAIN world
 */

// Generate a unique ID for each request
let requestId = 0;

// Keep track of pending requests
const pendingRequests = {};

// Track if init.js is ready
let isInitReady = false;

// Queue for storing requests before init is ready
const requestQueue = [];

// Create a single handler for all storage operations
const createStorageOperation = (operation) => {
  return function(payload) {
    const id = requestId++;
    
    return new Promise((resolve, reject) => {
      // Store the promise callbacks
      pendingRequests[id] = { resolve, reject };
      
      const request = {
        type: 'STORAGE_REQUEST',
        operation,
        id,
        ...payload
      };
      
      // If init is not ready, queue the request
      if (!isInitReady) {
        requestQueue.push(request);
      } else {
        // Send the request to init.js
        window.postMessage(request, '*');
      }
      
      // Set a timeout to avoid hanging promises
      setTimeout(() => {
        if (pendingRequests[id]) {
          console.error(`Storage ${operation} request timed out for id:`, id);
          reject(new Error('Storage request timed out'));
          delete pendingRequests[id];
        }
      }, 5000);
    });
  };
};

// Initialize the storageAccess object
window.storageAccess = {
  get: function(keys) {
    return createStorageOperation('get')({ keys });
  },
  
  set: function(items) {
    return createStorageOperation('set')({ items });
  },
  
  remove: function(keys) {
    return createStorageOperation('remove')({ keys });
  }
};

// Process all queued requests when init becomes ready
function processQueue() {
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    window.postMessage(request, '*');
  }
}

// Listen for messages from init.js and handle storage results
window.addEventListener('message', (event) => {
  // Listen for init ready message
  if (event.data.type === 'INIT_READY') {
    isInitReady = true;
    processQueue();
  }
  
  // Handle storage results
  else if (event.data.type === 'STORAGE_RESULT') {
    const { id, operation, data, success, error } = event.data;
    
    // Find the pending request
    const request = pendingRequests[id];
    if (request) {
      if (error) {
        request.reject(new Error(error));
      } else if (operation === 'get') {
        request.resolve(data);
      } else {
        request.resolve(success);
      }
      
      // Clean up
      delete pendingRequests[id];
    }
  }
}); 