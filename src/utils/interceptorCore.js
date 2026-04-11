/**
 * InterceptorCore
 * Centralizes the monkey-patching of fetch and XMLHttpRequest.
 * Provides a hook system for other MAIN world modules to intercept and modify traffic.
 */
window.interceptorCore = (function() {
    const requestHooks = [];
    const responseHooks = [];

    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    // --- Fetch Interception ---
    window.fetch = async function(...args) {
        let url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (args[0] instanceof URL) url = args[0].href;
        
        let options = args[1] || {};
        let method = (options.method || (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();

        // Run request hooks (allow modification of body/options)
        for (const hook of requestHooks) {
            try {
                const result = await hook({ url, method, options, args });
                if (result && result.newBody !== undefined) {
                    if (args[0] instanceof Request) {
                        args[0] = new Request(args[0], { body: result.newBody });
                    } else {
                        options.body = result.newBody;
                        args[1] = options;
                    }
                }
            } catch (e) {
                console.error('[InterceptorCore] Error in fetch request hook:', e);
            }
        }

        const response = await originalFetch.apply(this, args);

        // Run response hooks (listen only, clones the response to avoid consuming it)
        for (const hook of responseHooks) {
            try {
                // Return a fresh clone for each hook
                hook({ url, method, response: response.clone() });
            } catch (e) {
                console.error('[InterceptorCore] Error in fetch response hook:', e);
            }
        }

        return response;
    };

    // --- XHR Interception ---
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._method = method;
        originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const method = (this._method || 'GET').toUpperCase();
        const url = this._url;

        // Run request hooks
        for (const hook of requestHooks) {
            try {
                const result = hook({ url, method, body, xhr: this });
                if (result && result.newBody !== undefined) {
                    body = result.newBody;
                }
            } catch (e) {
                console.error('[InterceptorCore] Error in XHR request hook:', e);
            }
        }

        this.addEventListener('load', function() {
            if (this.status === 200) {
                for (const hook of responseHooks) {
                    try {
                        hook({ url, method, xhr: this });
                    } catch (e) {
                        console.error('[InterceptorCore] Error in XHR response hook:', e);
                    }
                }
            }
        });

        originalSend.call(this, body);
    };

    return {
        registerRequestHook: (hook) => requestHooks.push(hook),
        registerResponseHook: (hook) => responseHooks.push(hook)
    };
})();
