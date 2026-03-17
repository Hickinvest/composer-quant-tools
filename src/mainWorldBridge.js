// Bridge script that runs in the MAIN world to access React internals
window.addEventListener('message', async function(event) {
    // Only handle messages requesting React props
    if (event.data.type === 'GET_REACT_PROPS') {
        const element = event.data.element;
        const propSelector = event.data.propSelector; // e.g. "children.props"
        
        // Find the DOM element
        const domElement = document.querySelector(element);
        
        if (!domElement) {
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                error: 'Element not found'
            }, '*');
            return;
        }

        try {
            // Extract React props using the special key pattern
            const reactPropsKey = Object.keys(domElement).find(key => key.startsWith('__reactProps'));
            if (!reactPropsKey) {
                window.postMessage({
                    type: 'REACT_PROPS_RESULT',
                    id: event.data.id,
                    error: 'No React props found'
                }, '*');
                return;
            }

            // Get the initial props object
            let props = domElement[reactPropsKey];
            
            // Navigate through the prop selector if provided
            if (propSelector) {
                const parts = propSelector.split('.');
                for (const part of parts) {
                    props = props?.[part];
                }
            }
            
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                data: props
            }, '*');
        } catch (error) {
            window.postMessage({
                type: 'REACT_PROPS_RESULT',
                id: event.data.id,
                error: error.message
            }, '*');
        }
    }
});

// Backtest Interceptor (runs in MAIN world)
(function() {
    console.log("[composer-quant-tools] Initializing Main World Interceptor...");

    // 1. Intercept Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const response = await originalFetch.apply(this, args);

        const isBacktest = url.includes('/backtest');

        if (isBacktest && response.status === 200) {
            const clonedResponse = response.clone();
            clonedResponse.json().then(data => {
                if (data?.stats) {
                    handleInterception(data, url, 'fetch');
                }
            }).catch(() => {});
        }

        return response;
    };

    // 2. Intercept XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        originalOpen.apply(this, arguments);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            const isBacktest = this._url?.includes('/backtest');
            if (this.status === 200 && isBacktest) {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data?.stats) {
                        handleInterception(data, this._url, 'XHR');
                    }
                } catch (e) {}
            }
        });
        originalSend.apply(this, arguments);
    };

    function handleInterception(data, url, type) {
        if (!data || !data.stats) return;

        const path = new URL(url).pathname;
        if (!path.endsWith('/backtest')) {
            return;
        }

        const symphonyId = path.split('/')[4];
        if (symphonyId) {
            console.log('Intercepted backtest data for symphony:', symphonyId);
        }

        // Send to Content Script
        window.postMessage({
            type: 'BACKTEST_DATA_INTERCEPTED',
            data: data,
            url: url,
            source: type,
            timestamp: Date.now()
        }, '*');
    }
})();
