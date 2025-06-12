/**
 * API Queue utility for handling rate limiting
 * Manages a queue of API requests with concurrency control and retry logic
 */

import { log } from "./logger.js";
import { getTokenAndAccount } from "./tokenAndAccountUtil.js";

class ApiQueue {
  constructor(options = {}) {
    // Maximum number of concurrent requests
    this.maxConcurrent = options.maxConcurrent || 5;
    // Initial retry delay in ms
    this.initialRetryDelay = options.initialRetryDelay || 60000;
    // Maximum retry delay in ms
    this.maxRetryDelay = options.maxRetryDelay || 120000;
    // Maximum number of retries per request
    this.maxRetries = options.maxRetries || 5;
    // Backoff factor for exponential backoff
    this.backoffFactor = options.backoffFactor || 2;
    
    // Queue of pending requests
    this.queue = [];
    // Number of active requests
    this.activeRequests = 0;
    // Processing flag
    this.isProcessing = false;
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Function that returns a promise
   * @returns {Promise} - Promise that resolves with the request result
   */
  enqueue(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFn,
        resolve,
        reject,
        retries: 0
      });
      
      // Start processing the queue if not already processing
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the queue of requests
   */
  async processQueue() {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    while (this.queue.length > 0) {
      // If we've reached the maximum number of concurrent requests, wait
      if (this.activeRequests >= this.maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // Get the next request from the queue
      const request = this.queue.shift();
      this.activeRequests++;
      
      // Execute the request
      this.executeRequest(request)
        .catch(error => {
          log("Error executing request", error);
        })
        .finally(() => {
          this.activeRequests--;
          // Check if we need to continue processing the queue
          if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            this.processQueue();
          }
        });
    }
    
    this.isProcessing = false;
  }

  /**
   * Execute a request with retry logic
   * @param {Object} request - Request object
   */
  async executeRequest(request) {
    try {
      const result = await request.requestFn();
      request.resolve(result);
    } catch (error) {
      // Check if we should retry
      if (this.shouldRetry(error) && request.retries < this.maxRetries) {
        const retryDelay = this.calculateRetryDelay(request.retries);
        request.retries++;
        
        log(`API request failed, retrying in ${retryDelay}ms (attempt ${request.retries}/${this.maxRetries})`, error);
        
        // Wait for the retry delay
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        // Put the request back in the queue
        this.queue.unshift(request);
      } else {
        // Log additional information about the failure
        if (request.retries >= this.maxRetries) {
          log(`Maximum retries (${this.maxRetries}) reached for request, giving up`, error);
        } else {
          log(`Request failed with non-retryable error, giving up`, error);
        }
        // Max retries reached or non-retryable error
        request.reject(error);
      }
    }
  }

  /**
   * Calculate the retry delay using exponential backoff
   * @param {number} retryCount - Number of retries so far
   * @returns {number} - Delay in milliseconds
   */
  calculateRetryDelay(retryCount) {
    const delay = this.initialRetryDelay * Math.pow(this.backoffFactor, retryCount);
    // Add jitter to prevent thundering herd problem
    const jitter = Math.random() * 1000;
    return Math.min(delay + jitter, this.maxRetryDelay);
  }

  /**
   * Determine if a request should be retried based on the error
   * @param {Error} error - The error that occurred
   * @returns {boolean} - Whether the request should be retried
   */
  shouldRetry(error) {
    // Handle network errors (no response property)
    if (!error.response) {
      // For fetch API errors that don't have a response property
      return true;
    }
    
    const status = error.response?.status;
    // Retry on rate limit (429) or certain server errors (5xx)
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Wrap the standard fetch API with our queue
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise} - Promise that resolves with the fetch result
   */
  fetch(url, options = {}) {
    return this.enqueue(async () => {
      try {
        // refetch the token as it is possible to have an expired token
        if(options.headers?.Authorization?.includes('Bearer')) {
          const { token } = await getTokenAndAccount();
          options = {
            ...options,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${token}`,
            },
          };
        }

        const response = await fetch(url, options);
        
        // If response is not ok, throw an error with the response attached
        if (!response.ok) {
          const error = new Error(`HTTP error ${response.status}`);
          error.response = response;
          error.status = response.status;
          throw error;
        }
        
        return response;
      } catch (error) {
        // Handle network errors from fetch
        if (!error.response && !error.status) {
          // This is likely a network error
          const networkError = new Error(`Network error: ${error.message}`);
          networkError.originalError = error;
          throw networkError;
        }
        
        // Re-throw the original error
        throw error;
      }
    });
  }
}

// Create a singleton instance with optimized settings for the Composer API
const apiQueue = new ApiQueue({
  // Limit to 3 concurrent requests to avoid rate limits
  maxConcurrent: 3,
  // Start with a 10-second delay for first retry
  initialRetryDelay: 60000,
  // Maximum delay of 120 seconds
  maxRetryDelay: 120000,
  // Up to 5 retries per request
  maxRetries: 5,
  // More aggressive backoff for rate-limited APIs
  backoffFactor: 2.5
});

export default apiQueue; 