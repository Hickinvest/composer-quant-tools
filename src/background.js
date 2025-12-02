// Main background script - orchestrates the extension background functionality
// This file has been refactored to use modular architecture

// Import modules
import { setupCacheCleanup } from './modules/cacheManager.js';
import { setupMessageHandlers } from './modules/messageHandler.js';
import { initKeepAlive } from './modules/keepAlive.js';

// Initialize the extension
async function init() {
  console.log('Initializing Composer Quant Tools background script');
  
  // Setup keep-alive alarm
  await initKeepAlive();
  
  // Setup cache cleanup
  setupCacheCleanup();
  
  // Setup message handlers
  setupMessageHandlers();
}

// Start initialization
init();
