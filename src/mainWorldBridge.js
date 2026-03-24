// Bridge script that runs in the MAIN world to access React internals

// --- React Props Bridge ---
// Listens for GET_REACT_PROPS messages and returns React internal props
// from DOM elements back to the content script.
window.addEventListener('message', async function(event) {
    if (event.data.type !== 'GET_REACT_PROPS') return;

    const { element, propSelector, id } = event.data;
    const domElement = document.querySelector(element);

    if (!domElement) {
        window.postMessage({ type: 'REACT_PROPS_RESULT', id, error: 'Element not found' }, '*');
        return;
    }

    try {
        const reactPropsKey = Object.keys(domElement).find(key => key.startsWith('__reactProps'));
        if (!reactPropsKey) {
            window.postMessage({ type: 'REACT_PROPS_RESULT', id, error: 'No React props found' }, '*');
            return;
        }

        let props = domElement[reactPropsKey];

        if (propSelector) {
            for (const part of propSelector.split('.')) {
                props = props?.[part];
            }
        }

        window.postMessage({ type: 'REACT_PROPS_RESULT', id, data: props }, '*');
    } catch (error) {
        window.postMessage({ type: 'REACT_PROPS_RESULT', id, error: error.message }, '*');
    }
});

// --- Backtest Data Interceptor ---
// Monkey-patches fetch and XHR to intercept /backtest responses
// and forward them to the content script via BACKTEST_DATA_INTERCEPTED messages.
(function() {
    console.log('[composer-quant-tools] Initializing Main World Interceptor...');

    function handleInterception(data, url, source) {
        if (!data?.stats) return;

        const path = new URL(url).pathname;
        if (!path.endsWith('/backtest')) return;

        const symphonyId = path.split('/')[4];
        if (symphonyId) {
            console.log('[composer-quant-tools] Intercepted backtest data for symphony:', symphonyId);
        }

        window.postMessage({
            type: 'BACKTEST_DATA_INTERCEPTED',
            data,
            url,
            source,
            timestamp: Date.now()
        }, '*');
    }

    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const response = await originalFetch.apply(this, args);

        if (url.includes('/backtest') && response.status === 200) {
            response.clone().json()
                .then(data => handleInterception(data, url, 'fetch'))
                .catch(() => {});
        }

        return response;
    };

    // Intercept XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        originalOpen.apply(this, arguments);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (this.status === 200 && this._url?.includes('/backtest')) {
                try {
                    const data = JSON.parse(this.responseText);
                    handleInterception(data, this._url, 'XHR');
                } catch (e) {}
            }
        });
        originalSend.apply(this, arguments);
    };
})();
