// Main background script - orchestrates the extension background functionality
// This file has been refactored to use modular architecture

// Import modules
import { setupCacheCleanup } from './modules/cacheManager.js';
import { setupMessageHandlers } from './modules/messageHandler.js';

// Initialize the extension
function init() {
  console.log('Initializing Composer Quant Tools background script');
  
  // Setup cache cleanup
  setupCacheCleanup();
  
  // Setup message handlers
  setupMessageHandlers();
}

// Start initialization
init();
