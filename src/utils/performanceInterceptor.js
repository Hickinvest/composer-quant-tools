/**
 * PerformanceInterceptor
 * Captures backtest and quotes data from network responses and forwards them to the content script.
 */
(function() {
    function handleInterception(data, url, source) {
        if (!data || !data.stats) return;

        const path = new URL(url).pathname;
        if (!path.endsWith('/backtest')) return;

        // Send to Content Script
        window.postMessage({
            type: 'BACKTEST_DATA_INTERCEPTED',
            data: data,
            url: url,
            source: source,
            timestamp: Date.now()
        }, '*');
    }

    function handleQuotesInterception(data, url, source) {
        if (!data || typeof data !== 'object') return;

        // Send to Content Script
        window.postMessage({
            type: 'QUOTES_DATA_INTERCEPTED',
            data: data,
            url: url,
            source: source,
            timestamp: Date.now()
        }, '*');
    }

    if (window.interceptorCore) {
        // Register a response hook to listen for data
        window.interceptorCore.registerResponseHook(async ({ url, method, response, xhr }) => {
            const isBacktest = url.includes('/backtest');
            const isQuotes = url.includes('/public/quotes');

            if (isBacktest || isQuotes) {
                try {
                    let data;
                    if (response) {
                        // response is already a clone from interceptorCore
                        data = await response.json();
                    } else if (xhr) {
                        data = JSON.parse(xhr.responseText);
                    }

                    if (data) {
                        if (isBacktest && data.stats) {
                            handleInterception(data, url, response ? 'fetch' : 'XHR');
                        }
                        if (isQuotes) {
                            handleQuotesInterception(data, url, response ? 'fetch' : 'XHR');
                        }
                    }
                } catch (e) {
                    // JSON parsing might fail or response might not be JSON
                }
            }
        });
    }
})();
