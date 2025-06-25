/**
 * API utilities for making rate-limited API calls
 */

import apiQueue from './apiQueue.js';
import { log } from './logger.js';
import { setCache, getCache } from '../modules/cacheManager.js';

/**
 * Make an API call with rate limiting and retries
 * @param {string} url - The URL to call
 * @param {Object} options - Fetch options
 * @param {string} requestDescription - Description for logging
 * @returns {Promise<Object>} - The response data
 */
export async function makeApiCall(url, options = {}, requestDescription = '') {
  try {
    // Use the queue to make the fetch request
    const response = await apiQueue.fetch(url, options);
    
    try {
      // Parse the JSON response
      const data = await response.json();
      return data;
    } catch (jsonError) {
      // Handle JSON parsing errors
      log(`JSON parsing error for ${requestDescription}:`, jsonError);
      throw new Error(`Failed to parse JSON response for ${requestDescription}: ${jsonError.message}`);
    }
  } catch (error) {
    // Add more context to the error
    const enhancedError = new Error(`API call failed: ${requestDescription} - ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.url = url;
    
    log(`API call failed: ${requestDescription}`, error);
    throw enhancedError;
  }
}

/**
 * Make an API call with caching
 * @param {string} url - The URL to call
 * @param {Object} options - Fetch options
 * @param {Object} cacheOptions - Cache options
 * @param {string} cacheOptions.cacheKey - The key to use for caching
 * @param {number} cacheOptions.cacheTimeout - The cache timeout in ms
 * @param {string} requestDescription - Description for logging
 * @returns {Promise<Object>} - The response data
 */
export async function makeApiCallWithCache(url, options = {}, cacheOptions = {}, requestDescription = '') {
  const { cacheKey, cacheTimeout = 0 } = cacheOptions;
  
  // Check cache first if cacheKey is provided
  if (cacheKey) {
    try {
      const cachedItem = await getCache(cacheKey);
      if (cachedItem && cachedItem.expiry > Date.now()) {
        return cachedItem.value;
      }
    } catch (e) {
      // Invalid cache data or IndexedDB error, continue with API call
      log(`Cache error for ${cacheKey}:`, e);
    }
  }
  
  try {
    // Make the API call
    const data = await makeApiCall(url, options, requestDescription);
    
    // Cache the result if cacheKey is provided
    if (cacheKey && data) {
      try {
        const expiry = Date.now() + cacheTimeout;
        await setCache(cacheKey, data, expiry);
      } catch (cacheError) {
        // Handle IndexedDB errors (e.g., quota exceeded)
        log(`Failed to cache data for ${cacheKey}:`, cacheError);
        // Continue without caching
      }
    }
    
    return data;
  } catch (error) {
    // Log the error with more context
    log(`API call with cache failed: ${requestDescription} for URL ${url}`, error);
    throw error;
  }
} 